/**
 * extensions/slack/src/connector.ts
 * Slack connector — Socket Mode (default) + HTTP Events API.
 *
 * Socket Mode: connects via WebSocket to Slack's real-time event stream.
 *   Requires: botToken (xoxb-...) + appToken (xapp-...).
 *   App settings: enable Socket Mode, create App-Level Token with connections:write.
 *
 * HTTP mode: Events API webhook receiver.
 *   Requires: botToken + signingSecret.
 *   Webhook path registered on the gateway at /webhook/slack.
 *
 * Supports: DMs, channels, groups (MPIMs), threading, reactions,
 *           pairing, ack/typing reactions, text streaming (Agents API),
 *           slash commands, block actions, multi-account.
 */

import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_BASE = path.join(os.homedir(), '.hyperclaw');
const DEFAULT_CHUNK = 3000;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SlackDMConfig {
  enabled?: boolean;
  policy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  allowFrom?: string[];
  groupEnabled?: boolean;
  groupChannels?: string[];
  replyToMode?: 'off' | 'first' | 'all';
}

export interface SlackChannelConfig {
  requireMention?: boolean;
  users?: string[];
  allowFrom?: string[];
}

export interface SlackThreadConfig {
  historyScope?: 'thread' | 'channel';
  inheritParent?: boolean;
  initialHistoryLimit?: number;
}

export interface SlackActionsConfig {
  messages?: boolean;
  reactions?: boolean;
  pins?: boolean;
  memberInfo?: boolean;
  emojiList?: boolean;
}

export interface SlackCommandsConfig {
  native?: boolean;
}

export interface SlackSlashCommandConfig {
  enabled?: boolean;
  name?: string;
  sessionPrefix?: string;
  ephemeral?: boolean;
}

export interface SlackAccountConfig {
  name?: string;
  /** Socket Mode (default) or HTTP Events API */
  mode?: 'socket' | 'http';
  botToken?: string;
  /** App-Level Token (xapp-...) — required for Socket Mode */
  appToken?: string;
  signingSecret?: string;
  /** User token (xoxp-...) for read operations */
  userToken?: string;
  userTokenReadOnly?: boolean;
  webhookPath?: string;

  /** DM access policy (preferred flat field) */
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  /** Preferred allowFrom (legacy: dm.allowFrom) */
  allowFrom?: string[];
  dm?: SlackDMConfig;

  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  /** Per-channel config map keyed by channel ID */
  channels?: Record<string, SlackChannelConfig>;

  replyToMode?: 'off' | 'first' | 'all';
  replyToModeByChatType?: { direct?: string; group?: string; channel?: string };
  thread?: SlackThreadConfig;

  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
  mediaMaxMb?: number;

  /** Live preview streaming: off | partial | block | progress */
  streaming?: 'off' | 'partial' | 'block' | 'progress';
  /** Use Slack native streaming API (chat.startStream etc.) */
  nativeStreaming?: boolean;

  /** Emoji shortcode to react with on message receipt (no colons) */
  ackReaction?: string;
  /** Emoji shortcode to add while processing (removed after reply) */
  typingReaction?: string;

  actions?: SlackActionsConfig;
  commands?: SlackCommandsConfig;
  slashCommand?: SlackSlashCommandConfig;
  configWrites?: boolean;
}

export interface SlackConfig extends SlackAccountConfig {
  botToken: string;
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  accounts?: Record<string, SlackAccountConfig>;
}

// ─── Slack API ─────────────────────────────────────────────────────────────────

function slackApi(token: string, method: string, body: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'slack.com',
        port: 443,
        path: `/api/${method}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const r = JSON.parse(data);
            if (!r.ok) reject(new Error(r.error || 'Slack API error'));
            else resolve(r);
          } catch {
            reject(new Error('Slack: invalid JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Slack API timeout')); });
    req.write(payload);
    req.end();
  });
}

// ─── Text helpers ──────────────────────────────────────────────────────────────

function chunkText(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (mode === 'newline') {
    const paras = text.split(/\n\n+/);
    const chunks: string[] = [];
    let cur = '';
    for (const p of paras) {
      if ((cur + '\n\n' + p).length > limit && cur) {
        chunks.push(cur.trim());
        cur = p;
      } else {
        cur = cur ? cur + '\n\n' + p : p;
      }
    }
    if (cur) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks.length ? chunks : [''];
}

function generateCode(): string {
  return Array.from(
    { length: 6 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
  ).join('');
}

// ─── Single-account runner ─────────────────────────────────────────────────────

class SlackAccount extends EventEmitter {
  private cfg: Required<Pick<SlackAccountConfig, 'mode' | 'userTokenReadOnly' | 'textChunkLimit' | 'chunkMode' | 'streaming' | 'nativeStreaming'>> & SlackAccountConfig & {
    approvedPairings: string[];
    pendingPairings: Record<string, string>;
  };
  readonly accountId: string;
  botUserId = '';
  teamName = '';
  private running = false;
  private wsReconnectDelay = 1000;

  constructor(accountId: string, cfg: SlackAccountConfig & {
    approvedPairings: string[];
    pendingPairings: Record<string, string>;
  }) {
    super();
    this.accountId = accountId;
    this.cfg = {
      mode: 'socket',
      userTokenReadOnly: true,
      textChunkLimit: DEFAULT_CHUNK,
      chunkMode: 'length',
      streaming: 'partial',
      nativeStreaming: true,
      dmPolicy: 'pairing',
      allowFrom: [],
      groupPolicy: 'allowlist',
      channels: {},
      replyToMode: 'off',
      thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
      actions: { messages: true, reactions: true, pins: true, memberInfo: true, emojiList: true },
      ...cfg
    } as any;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  async authenticate(): Promise<void> {
    const token = this.cfg.botToken!;
    const auth = await slackApi(token, 'auth.test');
    this.botUserId = auth.user_id;
    this.teamName = auth.team;
    console.log(chalk.green(`  💼 Slack [${this.accountId}]: @${auth.user} in ${auth.team}`));
  }

  // ── Connect ───────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.loadState();
    await this.authenticate();
    this.running = true;
    this.emit('connected', { userId: this.botUserId, team: this.teamName, accountId: this.accountId });

    const mode = this.cfg.mode ?? 'socket';
    if (mode === 'socket') {
      void this.connectSocketMode();
    }
    // HTTP mode: events arrive via handleWebhook() — nothing to start here
  }

  disconnect(): void {
    this.running = false;
  }

  // ── Socket Mode ──────────────────────────────────────────────────────────────

  private async connectSocketMode(): Promise<void> {
    if (!this.cfg.appToken) {
      console.error(`[slack:${this.accountId}] Socket Mode requires appToken (xapp-...)`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let WebSocketImpl: any;
    try {
      WebSocketImpl = await import('ws');
    } catch {
      console.error(`[slack:${this.accountId}] ws package not found — install: npm i ws`);
      return;
    }

    while (this.running) {
      try {
        const resp = await slackApi(this.cfg.appToken, 'apps.connections.open');
        const wsUrl: string = resp.url;

        await new Promise<void>((resolve) => {
          const WS = WebSocketImpl.default ?? WebSocketImpl;
          const ws = new WS(wsUrl) as import('ws');

          ws.on('open', () => {
            this.wsReconnectDelay = 1000;
          });

          ws.on('message', (raw: Buffer) => {
            let envelope: any;
            try { envelope = JSON.parse(raw.toString()); } catch { return; }

            // Acknowledge immediately
            if (envelope.envelope_id) {
              ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
            }

            void this.handleSocketEnvelope(envelope);
          });

          ws.on('close', () => resolve());
          ws.on('error', () => resolve());
        });

        if (!this.running) break;
        await new Promise((r) => setTimeout(r, this.wsReconnectDelay));
        this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, 30000);
      } catch (e: any) {
        if (this.running) {
          console.log(chalk.yellow(`  ⚠  Slack [${this.accountId}] socket: ${e.message}`));
          await new Promise((r) => setTimeout(r, this.wsReconnectDelay));
          this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, 30000);
        }
      }
    }
  }

  private async handleSocketEnvelope(envelope: any): Promise<void> {
    const type: string = envelope.type || '';

    switch (type) {
      case 'hello':
        break;
      case 'disconnect':
        break;

      case 'events_api': {
        const payload = envelope.payload || {};
        if (payload.type === 'event_callback') {
          await this.handleEvent(payload.event, payload);
        }
        break;
      }

      case 'slash_commands': {
        const p = envelope.payload || {};
        if (p.command || p.user_id) {
          await this.handleSlashCommand(p);
        }
        break;
      }

      case 'block_actions':
      case 'interactive': {
        const p = envelope.payload || {};
        this.emit('interaction', {
          accountId: this.accountId,
          type,
          payload: p
        });
        break;
      }
    }
  }

  // ── HTTP Events API ──────────────────────────────────────────────────────────

  async handleWebhook(body: string, signature: string, timestamp: string): Promise<string | null> {
    if (!this.verifySignature(body, signature, timestamp)) {
      console.log(chalk.yellow(`  ⚠  Slack [${this.accountId}]: invalid signature`));
      return null;
    }

    let payload: any;
    try { payload = JSON.parse(body); } catch { return null; }

    if (payload.type === 'url_verification') return payload.challenge;

    if (payload.type === 'event_callback') {
      await this.handleEvent(payload.event, payload);
    }

    return null;
  }

  verifySignature(body: string, signature: string, timestamp: string): boolean {
    if (!this.cfg.signingSecret) return false;
    const ts = parseInt(timestamp);
    if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const baseString = `v0:${timestamp}:${body}`;
    const hash = 'v0=' + crypto.createHmac('sha256', this.cfg.signingSecret).update(baseString).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  // ── Event handler ────────────────────────────────────────────────────────────

  private async handleEvent(event: any, _outer?: any): Promise<void> {
    if (!event) return;
    if (event.bot_id || event.user === this.botUserId) return;

    const evType: string = event.type || '';

    // System events (reactions, member, pin, channel)
    if (['reaction_added', 'reaction_removed'].includes(evType)) {
      this.emit('system_event', { accountId: this.accountId, type: evType, event });
      return;
    }
    if (['member_joined_channel', 'member_left_channel', 'channel_rename',
      'pin_added', 'pin_removed'].includes(evType)) {
      this.emit('system_event', { accountId: this.accountId, type: evType, event });
      return;
    }

    // Message events
    if (evType !== 'message' && evType !== 'app_mention') return;
    if (!event.text || !event.user || !event.channel) return;
    if (event.subtype && event.subtype !== 'file_share') return;

    const channelType: string = event.channel_type || '';
    const isDM = channelType === 'im';
    const isGroup = channelType === 'mpim';
    const isChannel = !isDM && !isGroup;
    const isAppMention = evType === 'app_mention';
    const threadTs: string | undefined = event.thread_ts;
    const ts: string = event.ts || '';

    // Strip @bot mentions from text
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (isDM) {
      const dmEnabled = this.cfg.dm?.enabled !== false;
      if (!dmEnabled) return;
      const allowed = await this.checkDMPolicy(event.user, event.channel, text, ts);
      if (!allowed) return;
    } else if (isGroup) {
      const groupEnabled = this.cfg.dm?.groupEnabled === true;
      if (!groupEnabled) return;
      const groupChannels = this.cfg.dm?.groupChannels;
      if (groupChannels?.length && !groupChannels.includes(event.channel)) return;
    } else {
      // Public/private channel
      if (!this.checkChannelPolicy(event.channel, event.user, text, isAppMention)) return;
    }

    // Ack reaction
    void this.addReaction(this.resolveAckReaction(), event.channel, ts);

    const chatType = isDM ? 'direct' : isGroup ? 'group' : 'channel';
    const replyToMode = this.resolveReplyToMode(chatType);

    this.emit('message', {
      channelId: 'slack',
      accountId: this.accountId,
      chatId: event.channel,
      from: event.user,
      text,
      ts,
      threadTs,
      isDM,
      isGroup,
      isChannel,
      chatType,
      replyToMode
    });
  }

  // ── Slash commands ────────────────────────────────────────────────────────────

  private async handleSlashCommand(payload: any): Promise<void> {
    const text = [payload.command, payload.text].filter(Boolean).join(' ');
    const userId: string = payload.user_id || '';
    const channelId: string = payload.channel_id || '';
    if (!userId || !channelId) return;

    this.emit('message', {
      channelId: 'slack',
      accountId: this.accountId,
      chatId: channelId,
      from: userId,
      text,
      isDM: false,
      isSlashCommand: true,
      ephemeral: this.cfg.slashCommand?.ephemeral !== false
    });
  }

  // ── DM policy ─────────────────────────────────────────────────────────────────

  private async checkDMPolicy(userId: string, channelId: string, text: string, ts: string): Promise<boolean> {
    const policy = this.cfg.dm?.policy ?? this.cfg.dmPolicy ?? 'pairing';
    const allowFrom = this.cfg.allowFrom ?? this.cfg.dm?.allowFrom ?? [];

    switch (policy) {
      case 'disabled': return false;
      case 'open': return true;
      case 'allowlist':
        if (allowFrom.includes(userId) || allowFrom.includes('*')) return true;
        await this.sendMessage(channelId, 'HyperClaw: Not on allowlist.');
        return false;
      case 'pairing': {
        if (this.cfg.approvedPairings.includes(userId)) return true;
        const upper = text.trim().toUpperCase().match(/[A-Z0-9]{6}/)?.[0];
        if (upper && this.cfg.pendingPairings[upper]) {
          this.cfg.approvedPairings.push(userId);
          delete this.cfg.pendingPairings[upper];
          await this.saveState();
          await this.sendMessage(channelId, 'Paired! You can now send messages.');
          this.emit('pairing:approved', { userId, channelId: 'slack', accountId: this.accountId });
          return true;
        }
        const code = generateCode();
        this.cfg.pendingPairings[code] = userId;
        await this.saveState();
        await this.sendMessage(
          channelId,
          `*HyperClaw Pairing*\n\nCode: \`${code}\`\nApprove: \`hyperclaw pairing approve slack ${code}\``
        );
        return false;
      }
    }
    return false;
  }

  // ── Channel policy ────────────────────────────────────────────────────────────

  private checkChannelPolicy(channelId: string, userId: string, text: string, isAppMention: boolean): boolean {
    const policy = this.cfg.groupPolicy ?? 'allowlist';
    if (policy === 'disabled') return false;

    const chCfg = this.cfg.channels?.[channelId] || {};

    if (policy === 'open') {
      if (chCfg.allowFrom?.length && !chCfg.allowFrom.includes(userId)) return false;
      if (chCfg.users?.length && !chCfg.users.includes(userId)) return false;
      return true;
    }

    // allowlist — channel must be explicitly listed
    if (!this.cfg.channels?.[channelId]) return isAppMention;

    if (chCfg.allowFrom?.length && !chCfg.allowFrom.includes(userId)) return false;
    if (chCfg.users?.length && !chCfg.users.includes(userId)) return false;

    // Mention gating (default: required)
    if (chCfg.requireMention !== false && !isAppMention) return false;
    return true;
  }

  // ── Reactions ─────────────────────────────────────────────────────────────────

  private resolveAckReaction(): string {
    return this.cfg.ackReaction ?? '';
  }

  resolveTypingReaction(): string {
    return this.cfg.typingReaction ?? '';
  }

  resolveReplyToMode(chatType: string): string {
    const byType = this.cfg.replyToModeByChatType;
    if (byType) {
      if (chatType === 'direct' && byType.direct) return byType.direct;
      if (chatType === 'group' && byType.group) return byType.group;
      if (chatType === 'channel' && byType.channel) return byType.channel;
    }
    return this.cfg.replyToMode ?? 'off';
  }

  async addReaction(emoji: string, channel: string, timestamp: string): Promise<void> {
    if (!emoji || !channel || !timestamp) return;
    const name = emoji.replace(/:/g, '');
    await slackApi(this.cfg.botToken!, 'reactions.add', { channel, timestamp, name }).catch(() => {});
  }

  async removeReaction(emoji: string, channel: string, timestamp: string): Promise<void> {
    if (!emoji || !channel || !timestamp) return;
    const name = emoji.replace(/:/g, '');
    await slackApi(this.cfg.botToken!, 'reactions.remove', { channel, timestamp, name }).catch(() => {});
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  async sendMessage(
    channel: string,
    text: string,
    threadTs?: string,
    opts: { ephemeral?: boolean; userId?: string } = {}
  ): Promise<void> {
    const limit = this.cfg.textChunkLimit ?? DEFAULT_CHUNK;
    const mode = this.cfg.chunkMode ?? 'length';
    const chunks = chunkText(text, limit, mode);

    const replyThread = threadTs && this.resolveReplyToMode('channel') !== 'off';

    for (const chunk of chunks) {
      const payload: any = {
        channel,
        text: chunk,
        mrkdwn: true,
        ...(replyThread ? { thread_ts: threadTs } : {})
      };
      if (opts.ephemeral && opts.userId) {
        await slackApi(this.cfg.botToken!, 'chat.postEphemeral', { ...payload, user: opts.userId });
      } else {
        await slackApi(this.cfg.botToken!, 'chat.postMessage', payload);
      }
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    // Slack does not have a bot typing indicator; typingReaction is used instead
    void channelId;
  }

  // ── Streaming (Agents API) ────────────────────────────────────────────────────

  async startStream(channel: string, threadTs?: string): Promise<string | null> {
    if (this.cfg.streaming === 'off' || !this.cfg.nativeStreaming) return null;
    try {
      const r = await slackApi(this.cfg.botToken!, 'chat.startStream', {
        channel,
        ...(threadTs ? { thread_ts: threadTs } : {})
      });
      return r.stream_ts || null;
    } catch {
      return null;
    }
  }

  async appendStream(streamTs: string, text: string): Promise<void> {
    await slackApi(this.cfg.botToken!, 'chat.appendStream', { stream_ts: streamTs, text }).catch(() => {});
  }

  async stopStream(streamTs: string, text: string): Promise<void> {
    await slackApi(this.cfg.botToken!, 'chat.stopStream', { stream_ts: streamTs, text }).catch(() => {});
  }

  // ── Assistant typing status (Agents API) ──────────────────────────────────────

  async setAssistantStatus(channelId: string, threadTs: string, status: string): Promise<void> {
    await slackApi(this.cfg.botToken!, 'assistant.threads.setStatus', {
      channel_id: channelId,
      thread_ts: threadTs,
      status
    }).catch(() => {});
  }

  // ── Pairing ───────────────────────────────────────────────────────────────────

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.cfg.pendingPairings[upper]) return false;
    this.cfg.approvedPairings.push(this.cfg.pendingPairings[upper]);
    delete this.cfg.pendingPairings[upper];
    void this.saveState();
    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async openDM(userId: string): Promise<string> {
    const r = await slackApi(this.cfg.botToken!, 'conversations.open', { users: userId });
    return r.channel.id;
  }

  async sendDM(userId: string, text: string): Promise<void> {
    const channelId = await this.openDM(userId);
    await this.sendMessage(channelId, text);
  }

  // ── State ────────────────────────────────────────────────────────────────────

  private stateFile(): string {
    return path.join(STATE_BASE, `slack-state-${this.accountId}.json`);
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(this.stateFile());
      if (s.p) this.cfg.pendingPairings = s.p;
      if (s.a) this.cfg.approvedPairings = s.a;
    } catch {}
  }

  async saveState(): Promise<void> {
    await fs.ensureDir(STATE_BASE);
    await fs.writeJson(
      this.stateFile(),
      { p: this.cfg.pendingPairings, a: this.cfg.approvedPairings },
      { spaces: 2 }
    );
  }

  isRunning(): boolean { return this.running; }
}

// ─── Public connector (manages 1..N accounts) ─────────────────────────────────

export class SlackConnector extends EventEmitter {
  private config: SlackConfig;
  private accounts: SlackAccount[] = [];

  constructor(config: SlackConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const sharedState = {
      approvedPairings: this.config.approvedPairings ?? [],
      pendingPairings: this.config.pendingPairings ?? {}
    };

    const accountEntries = Object.entries(this.config.accounts || {});

    if (accountEntries.length === 0) {
      const acct = new SlackAccount('default', { ...this.config, ...sharedState });
      this.wire(acct);
      await acct.connect();
      this.accounts.push(acct);
    } else {
      for (const [id, acctCfg] of accountEntries) {
        const merged: any = {
          ...this.config,
          ...acctCfg,
          botToken: acctCfg.botToken || this.config.botToken,
          ...sharedState
        };
        if (!merged.botToken) {
          console.error(`[slack] Account "${id}" has no botToken — skipping`);
          continue;
        }
        const acct = new SlackAccount(id, merged);
        this.wire(acct);
        try {
          await acct.connect();
          this.accounts.push(acct);
        } catch (e: any) {
          console.error(`[slack] Account "${id}" failed: ${e.message}`);
        }
      }
    }
  }

  private wire(acct: SlackAccount): void {
    acct.on('message', (msg) => this.emit('message', msg));
    acct.on('connected', (info) => this.emit('connected', info));
    acct.on('pairing:approved', (info) => this.emit('pairing:approved', info));
    acct.on('system_event', (ev) => this.emit('system_event', ev));
    acct.on('interaction', (ev) => this.emit('interaction', ev));
  }

  async sendMessage(channel: string, text: string, threadTs?: string): Promise<void> {
    const acct = this.accounts[0];
    if (!acct) throw new Error('Slack: no connected account');
    await acct.sendMessage(channel, text, threadTs);
  }

  async sendTyping(channelId: string): Promise<void> {
    void channelId;
  }

  async handleWebhook(body: string, signature: string, timestamp: string): Promise<string | null> {
    for (const acct of this.accounts) {
      const r = await acct.handleWebhook(body, signature, timestamp);
      if (r != null) return r;
    }
    return null;
  }

  approvePairing(code: string): boolean {
    return this.accounts.some((a) => a.approvePairing(code));
  }

  disconnect(): void {
    for (const a of this.accounts) a.disconnect();
    this.accounts = [];
  }

  isRunning(): boolean {
    return this.accounts.some((a) => a.isRunning());
  }
}
