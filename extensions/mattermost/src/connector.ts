/**
 * extensions/mattermost/src/connector.ts
 * Mattermost connector — WebSocket real-time events, chatmode, groupPolicy,
 * interactive buttons (HMAC-SHA256), reactions, native slash commands,
 * directory adapter, multi-account, env-var fallbacks.
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMode = 'oncall' | 'onmessage' | 'onchar';
export type DmPolicy = 'open' | 'allowlist' | 'pairing' | 'none';
export type GroupPolicy = 'open' | 'allowlist';

export interface CommandsConfig {
  /** Register native slash commands. Default: false ('auto' also disables). */
  native?: boolean | 'auto';
  /** Auto-register one command per skill. Default: false */
  nativeSkills?: boolean;
  /** Gateway path that receives command POSTs. */
  callbackPath?: string;
  /** Public URL for Mattermost to call back. Derived from gateway if omitted. */
  callbackUrl?: string;
}

export interface ActionsConfig {
  /** Enable reaction add/remove actions. Default: true */
  reactions?: boolean;
}

export interface InteractionsConfig {
  /** External base URL for button callbacks (when gateway is behind NAT/proxy). */
  callbackBaseUrl?: string;
}

export interface ButtonAction {
  text: string;
  callback_data: string;
  style?: 'default' | 'primary' | 'danger';
}

export interface MattermostAccountConfig {
  name?: string;
  botToken?: string;
  baseUrl?: string;
  /** Legacy aliases */
  token?: string;
  serverUrl?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  dangerouslyAllowNameMatching?: boolean;
  chatmode?: ChatMode;
  oncharPrefixes?: string[];
  requireMention?: boolean;
  commands?: CommandsConfig;
  capabilities?: string[];
  actions?: ActionsConfig;
  interactions?: InteractionsConfig;
}

export interface MattermostConfig extends MattermostAccountConfig {
  /** Multi-account map. 'default' is the implicit single-account config. */
  accounts?: Record<string, MattermostAccountConfig>;
  /** Internal pairing state — managed by connector */
  approvedPairings?: string[];
  pendingPairings?: Record<string, string>;
}

// Resolved (no optionals) single-account config used internally
interface ResolvedAccount {
  id: string;
  name: string;
  botToken: string;
  baseUrl: string;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: GroupPolicy;
  groupAllowFrom: string[];
  dangerouslyAllowNameMatching: boolean;
  chatmode: ChatMode;
  oncharPrefixes: string[];
  requireMention: boolean;
  commands: CommandsConfig;
  capabilities: string[];
  actions: ActionsConfig;
  interactions: InteractionsConfig;
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'mattermost-state.json');
const HMAC_INTERACTIONS_KEY = 'openclaw-mattermost-interactions';
const WS_RECONNECT_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers — REST API
// ---------------------------------------------------------------------------

async function mmApi(baseUrl: string, token: string, method: string, apiPath: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const base = baseUrl.replace(/\/$/, '');
    const fullPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const url = new URL(fullPath, base);
    const payload = body ? JSON.stringify(body) : null;
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (c: string) => (data += c));
      res.on('end', () => {
        try {
          const r = data ? JSON.parse(data) : {};
          const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
          if (ok) resolve(r);
          else reject(new Error(r.message || r.error || `HTTP ${res.statusCode}`));
        } catch (e: any) {
          reject(e || new Error('Parse error'));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers — HMAC for button interactions
// ---------------------------------------------------------------------------

function deriveInteractionSecret(botToken: string): string {
  return crypto.createHmac('sha256', HMAC_INTERACTIONS_KEY).update(botToken).digest('hex');
}

function signContext(ctx: Record<string, unknown>, secret: string): string {
  const sortedKeys = Object.keys(ctx).sort();
  const payload: Record<string, unknown> = {};
  for (const k of sortedKeys) payload[k] = ctx[k];
  const serialized = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
}

function verifyInteraction(context: Record<string, unknown>, secret: string): boolean {
  const token = context['_token'];
  if (typeof token !== 'string') return false;
  const { _token: _, ...rest } = context;
  return signContext(rest as Record<string, unknown>, secret) === token;
}

/** Sanitize action IDs to alphanumeric only (Mattermost routing requirement). */
function sanitizeActionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// buildButtonAttachments — public utility
// ---------------------------------------------------------------------------

export function buildButtonAttachments(
  rows: ButtonAction[][],
  botToken: string,
  callbackBaseUrl: string,
  accountId = 'default'
): object[] {
  const secret = deriveInteractionSecret(botToken);
  const actions = rows.flat().map((btn) => {
    const rawId = btn.callback_data;
    const id = sanitizeActionId(rawId);
    const ctx: Record<string, unknown> = { action_id: id, action: rawId };
    const _token = signContext(ctx, secret);
    return {
      id,
      type: 'button',
      name: btn.text,
      style: btn.style ?? 'default',
      integration: {
        url: `${callbackBaseUrl}/mattermost/interactions/${accountId}`,
        context: { ...ctx, _token }
      }
    };
  });
  return [{ actions }];
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveAccount(id: string, raw: MattermostAccountConfig, state: { approved: string[]; pending: Record<string, string> }): ResolvedAccount {
  const botToken = raw.botToken || raw.token || process.env['MATTERMOST_BOT_TOKEN'] || '';
  const baseUrl = raw.baseUrl || raw.serverUrl || process.env['MATTERMOST_URL'] || '';
  return {
    id,
    name: raw.name ?? id,
    botToken,
    baseUrl: baseUrl.replace(/\/$/, ''),
    dmPolicy: raw.dmPolicy ?? 'pairing',
    allowFrom: raw.allowFrom ?? [],
    groupPolicy: raw.groupPolicy ?? 'allowlist',
    groupAllowFrom: raw.groupAllowFrom ?? [],
    dangerouslyAllowNameMatching: raw.dangerouslyAllowNameMatching ?? false,
    chatmode: raw.chatmode ?? 'oncall',
    oncharPrefixes: raw.oncharPrefixes ?? ['>'],
    requireMention: raw.requireMention ?? true,
    commands: raw.commands ?? { native: false },
    capabilities: raw.capabilities ?? [],
    actions: { reactions: true, ...raw.actions },
    interactions: raw.interactions ?? {},
    approvedPairings: state.approved,
    pendingPairings: state.pending
  };
}

// ---------------------------------------------------------------------------
// SingleAccountConnector — manages one Mattermost account
// ---------------------------------------------------------------------------

class SingleAccountConnector extends EventEmitter {
  acc: ResolvedAccount;
  private ws: WebSocket | null = null;
  private wsSeq = 1;
  private reconnecting = false;
  private botUserId = '';

  constructor(acc: ResolvedAccount) {
    super();
    this.acc = acc;
  }

  // ---- connect / WS -------------------------------------------------------

  async connect(): Promise<void> {
    const me = await mmApi(this.acc.baseUrl, this.acc.botToken, 'GET', '/api/v4/users/me');
    this.botUserId = me.id;
    console.log(chalk.green(`  🦅 Mattermost[${this.acc.id}]: connected as @${me.username} → ${this.acc.baseUrl}`));
    this._startWebSocket();
    this.emit('connected', { accountId: this.acc.id, baseUrl: this.acc.baseUrl, botUserId: this.botUserId });
  }

  disconnect(): void {
    this.reconnecting = false;
    this.ws?.close();
    this.ws = null;
  }

  private _startWebSocket(): void {
    const wsUrl = this.acc.baseUrl.replace(/^http/, 'ws') + '/api/v4/websocket';
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.wsSeq = 1;
      ws.send(JSON.stringify({
        seq: this.wsSeq++,
        action: 'authentication_challenge',
        data: { token: this.acc.botToken }
      }));
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const ev = JSON.parse(raw.toString());
        if (ev.event === 'posted') this._onPostedEvent(ev);
        if (ev.event === 'reaction_added' || ev.event === 'reaction_removed') {
          this.emit('reaction', { accountId: this.acc.id, event: ev.event, data: ev.data });
        }
      } catch {}
    });

    ws.on('close', () => {
      if (!this.reconnecting) return;
      console.log(chalk.yellow(`  ⚠ Mattermost[${this.acc.id}]: WS closed, reconnecting...`));
      setTimeout(() => this._startWebSocket(), WS_RECONNECT_DELAY_MS);
    });

    ws.on('error', (err: Error) => {
      console.log(chalk.yellow(`  ⚠ Mattermost[${this.acc.id}]: WS error: ${err.message}`));
    });

    this.reconnecting = true;
  }

  // ---- WS posted event ----------------------------------------------------

  private _onPostedEvent(ev: any): void {
    let post: any;
    try { post = typeof ev.data?.post === 'string' ? JSON.parse(ev.data.post) : ev.data?.post; } catch { return; }
    if (!post) return;
    if (post.user_id === this.botUserId) return; // ignore own messages

    const channelType: string = ev.data?.channel_type ?? '';
    const isDM = channelType === 'D';
    const text: string = (post.message || '').trim();
    const from: string = post.user_id;
    const channelId: string = post.channel_id;
    const senderName: string = ev.data?.sender_name ?? '';

    if (!text) return;

    if (isDM) {
      this._routeDM(from, channelId, text, senderName, post.id);
    } else {
      this._routeChannel(from, channelId, text, senderName, post.id);
    }
  }

  // ---- DM routing ---------------------------------------------------------

  private async _routeDM(userId: string, channelId: string, text: string, senderName: string, postId: string): Promise<void> {
    const acc = this.acc;
    if (acc.dmPolicy === 'none') return;
    if (acc.dmPolicy === 'open') {
      this._emit(userId, channelId, text, senderName, postId, true);
      return;
    }
    if (acc.dmPolicy === 'allowlist') {
      if (!acc.allowFrom.includes(userId)) {
        console.log(chalk.gray(`  mattermost[${acc.id}]: drop DM from ${userId} (dmPolicy=allowlist)`));
        return;
      }
      this._emit(userId, channelId, text, senderName, postId, true);
      return;
    }
    if (acc.dmPolicy === 'pairing') {
      if (acc.approvedPairings.includes(userId)) {
        this._emit(userId, channelId, text, senderName, postId, true);
        return;
      }
      const upper = text.trim().toUpperCase();
      if (acc.pendingPairings[upper]) {
        acc.approvedPairings.push(userId);
        delete acc.pendingPairings[upper];
        await this._saveState();
        await this.sendMessage(channelId, '🦅 Paired!');
        this.emit('pairing:approved', { accountId: acc.id, userId, channelId });
        return;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      acc.pendingPairings[code] = userId;
      await this._saveState();
      await this.sendMessage(channelId, `🦅 Pairing code: \`${code}\`\nApprove: hyperclaw pairing approve mattermost ${code}`);
    }
  }

  // ---- Channel routing (chatmode + groupPolicy) ---------------------------

  private _routeChannel(userId: string, channelId: string, text: string, senderName: string, postId: string): void {
    const acc = this.acc;

    // Sender gate (groupPolicy)
    if (acc.groupPolicy === 'allowlist') {
      const combined = [...acc.groupAllowFrom, ...acc.allowFrom];
      if (combined.length > 0) {
        const match = combined.some(p => {
          if (p === '*') return true;
          if (acc.dangerouslyAllowNameMatching) {
            const name = senderName.replace(/^@/, '');
            return name === p || userId === p;
          }
          return userId === p;
        });
        if (!match) {
          console.log(chalk.gray(`  mattermost[${acc.id}]: drop group sender ${userId} (policy=allowlist)`));
          return;
        }
      }
    }

    // chatmode gate
    const botMentionPatterns = [`@${this.botUserId}`, `@hyperclaw`, `@${acc.name?.toLowerCase()}`];
    const isMentioned = botMentionPatterns.some(p => text.toLowerCase().includes(p.toLowerCase()));

    if (acc.chatmode === 'oncall' || (acc.chatmode !== 'onmessage' && acc.requireMention)) {
      if (!isMentioned) {
        console.log(chalk.gray(`  mattermost[${acc.id}]: drop channel ${channelId} (missing-mention, chatmode=oncall)`));
        return;
      }
    } else if (acc.chatmode === 'onchar') {
      const hasPrefix = acc.oncharPrefixes.some(p => text.startsWith(p));
      if (!hasPrefix && !isMentioned) {
        console.log(chalk.gray(`  mattermost[${acc.id}]: drop channel ${channelId} (no prefix/mention, chatmode=onchar)`));
        return;
      }
    }
    // onmessage: always pass through

    this._emit(userId, channelId, text, senderName, postId, false);
  }

  private _emit(from: string, chatId: string, text: string, senderName: string, postId: string, isDM: boolean): void {
    this.emit('message', {
      accountId: this.acc.id,
      id: postId,
      from,
      chatId,
      text,
      senderName,
      isDM,
      channelId: 'mattermost'
    });
  }

  // ---- Webhook (legacy outgoing webhook inbound) --------------------------

  async handleWebhook(body: string, webhookToken: string): Promise<void> {
    let params: Record<string, string> = {};
    const trimmed = (body || '').trim();
    if (trimmed.startsWith('{')) {
      try { params = JSON.parse(trimmed); } catch { return; }
    } else {
      for (const pair of body.split('&')) {
        const eq = pair.indexOf('=');
        const k = eq >= 0 ? decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' ')) : decodeURIComponent(pair.replace(/\+/g, ' '));
        const v = eq >= 0 ? decodeURIComponent((pair.slice(eq + 1) || '').replace(/\+/g, ' ')) : '';
        if (k) params[k] = v;
      }
    }
    if (params.token !== webhookToken) {
      console.log(chalk.yellow(`  ⚠ Mattermost[${this.acc.id}]: invalid webhook token`));
      return;
    }
    const channelId = params.channel_id;
    const userId = params.user_id;
    const senderName = params.user_name || '';
    let text = (params.text || '').trim();
    const triggerWord = params.trigger_word || '';
    if (triggerWord && text.startsWith(triggerWord)) text = text.slice(triggerWord.length).trim();
    if (!channelId || !userId || !text) return;
    // Route as channel message (not DM) via webhook
    this._routeChannel(userId, channelId, text, senderName, params.post_id || `${channelId}-${Date.now()}`);
  }

  // ---- Slash command callback ----------------------------------------------

  async handleSlashCommand(payload: Record<string, string>, expectedToken: string): Promise<string | null> {
    if (payload.token !== expectedToken) {
      console.log(chalk.yellow(`  ⚠ Mattermost[${this.acc.id}]: slash command token mismatch`));
      return null;
    }
    const text = (payload.text || '').trim();
    const userId = payload.user_id || '';
    const channelId = payload.channel_id || '';
    const commandName = payload.command || '';
    this.emit('slash_command', {
      accountId: this.acc.id,
      command: commandName,
      text,
      userId,
      channelId,
      senderName: payload.user_name || '',
      responseUrl: payload.response_url || ''
    });
    return null; // gateway handles the response
  }

  /** Register all native slash commands via Mattermost REST API. */
  async registerSlashCommands(teamId: string, commands: Array<{ trigger: string; description: string; token?: string }>): Promise<void> {
    const acc = this.acc;
    if (!acc.commands.native || acc.commands.native === 'auto') return;
    const callbackUrl = acc.commands.callbackUrl || `http://localhost:18789${acc.commands.callbackPath ?? '/api/channels/mattermost/command'}`;
    for (const cmd of commands) {
      try {
        await mmApi(acc.baseUrl, acc.botToken, 'POST', '/api/v4/commands', {
          team_id: teamId,
          trigger: cmd.trigger.replace(/^\//, ''),
          method: 'P',
          title: cmd.description,
          description: cmd.description,
          url: callbackUrl,
          username: acc.name ?? 'hyperclaw-bot',
          auto_complete: true,
          auto_complete_hint: '[prompt]',
          auto_complete_desc: cmd.description
        });
        console.log(chalk.gray(`  mattermost[${acc.id}]: registered /${cmd.trigger}`));
      } catch (e: any) {
        console.log(chalk.yellow(`  ⚠ mattermost[${acc.id}]: failed to register /${cmd.trigger}: ${e.message}`));
      }
    }
  }

  // ---- Button interaction handler -----------------------------------------

  handleInteraction(context: Record<string, unknown>): { ok: boolean; error?: string } {
    const secret = deriveInteractionSecret(this.acc.botToken);
    if (!verifyInteraction(context, secret)) {
      return { ok: false, error: 'invalid _token' };
    }
    if (!context['action_id']) return { ok: false, error: 'missing action_id in context' };
    this.emit('interaction', { accountId: this.acc.id, context });
    return { ok: true };
  }

  // ---- Reactions ----------------------------------------------------------

  async addReaction(postId: string, emoji: string): Promise<void> {
    if (!this.acc.actions.reactions) return;
    const name = emoji.replace(/:/g, '');
    await mmApi(this.acc.baseUrl, this.acc.botToken, 'POST', '/api/v4/reactions', {
      user_id: this.botUserId,
      post_id: postId,
      emoji_name: name
    });
  }

  async removeReaction(postId: string, emoji: string): Promise<void> {
    if (!this.acc.actions.reactions) return;
    const name = emoji.replace(/:/g, '');
    await mmApi(this.acc.baseUrl, this.acc.botToken, 'DELETE', `/api/v4/users/${this.botUserId}/posts/${postId}/reactions/${name}`);
  }

  // ---- Send ---------------------------------------------------------------

  async sendMessage(channelId: string, text: string, attachments?: object[]): Promise<any> {
    const chunks = text.match(/.{1,4000}/gs) || [text];
    let lastPost: any;
    for (let i = 0; i < chunks.length; i++) {
      const body: Record<string, unknown> = {
        channel_id: channelId,
        message: chunks[i].slice(0, 16383)
      };
      if (i === chunks.length - 1 && attachments?.length) {
        body.props = { attachments };
      }
      lastPost = await mmApi(this.acc.baseUrl, this.acc.botToken, 'POST', '/api/v4/posts', body);
    }
    return lastPost;
  }

  // ---- Directory adapter --------------------------------------------------

  async resolveTarget(target: string): Promise<{ type: 'channel' | 'dm'; id: string }> {
    if (target.startsWith('channel:')) return { type: 'channel', id: target.slice(8) };
    if (target.startsWith('user:')) {
      const ch = await this._getDmChannel(target.slice(5));
      return { type: 'dm', id: ch };
    }
    if (target.startsWith('@')) {
      const users = await mmApi(this.acc.baseUrl, this.acc.botToken, 'GET', `/api/v4/users?in_team=&per_page=200&page=0`);
      const username = target.slice(1).toLowerCase();
      const found = Array.isArray(users) ? users.find((u: any) => u.username?.toLowerCase() === username) : null;
      if (!found) throw new Error(`Mattermost: user ${target} not found`);
      const ch = await this._getDmChannel(found.id);
      return { type: 'dm', id: ch };
    }
    if (target.startsWith('#')) {
      const name = target.slice(1);
      const ch = await mmApi(this.acc.baseUrl, this.acc.botToken, 'GET', `/api/v4/channels/name/${name}`);
      return { type: 'channel', id: ch.id };
    }
    // bare ID treated as channel
    return { type: 'channel', id: target };
  }

  private async _getDmChannel(userId: string): Promise<string> {
    const ch = await mmApi(this.acc.baseUrl, this.acc.botToken, 'POST', '/api/v4/channels/direct', [this.botUserId, userId]);
    return ch.id;
  }

  // ---- Pairing management -------------------------------------------------

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.acc.pendingPairings[upper]) return false;
    this.acc.approvedPairings.push(this.acc.pendingPairings[upper]);
    delete this.acc.pendingPairings[upper];
    this._saveState();
    return true;
  }

  listPendingPairings(): Record<string, string> {
    return { ...this.acc.pendingPairings };
  }

  // ---- State persistence --------------------------------------------------

  private async _saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    let state: Record<string, any> = {};
    try { state = await fs.readJson(STATE_FILE); } catch {}
    state[this.acc.id] = {
      approvedPairings: this.acc.approvedPairings,
      pendingPairings: this.acc.pendingPairings
    };
    await fs.writeJson(STATE_FILE, state, { spaces: 2 });
  }

  async loadState(): Promise<void> {
    try {
      const state = await fs.readJson(STATE_FILE);
      const s = state[this.acc.id];
      if (s?.approvedPairings) this.acc.approvedPairings = s.approvedPairings;
      if (s?.pendingPairings) this.acc.pendingPairings = s.pendingPairings;
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// MattermostConnector — public facade (single or multi-account)
// ---------------------------------------------------------------------------

export class MattermostConnector extends EventEmitter {
  private accounts: Map<string, SingleAccountConnector> = new Map();
  private rawConfig: MattermostConfig;

  constructor(config: MattermostConfig) {
    super();
    this.rawConfig = config;
  }

  async connect(): Promise<void> {
    const cfg = this.rawConfig;

    // Build account map: explicit accounts{} OR fall back to top-level as 'default'
    const accountDefs: Record<string, MattermostAccountConfig> = cfg.accounts ?? { default: cfg };

    for (const [id, rawAcc] of Object.entries(accountDefs)) {
      // Per-account overrides top-level fields
      const merged: MattermostAccountConfig = { ...cfg, ...rawAcc };
      const state = {
        approved: cfg.approvedPairings ?? [],
        pending: cfg.pendingPairings ?? {}
      };
      const acc = resolveAccount(id, merged, state);
      if (!acc.botToken || !acc.baseUrl) {
        console.log(chalk.yellow(`  ⚠ Mattermost[${id}]: missing botToken or baseUrl — skipping`));
        continue;
      }
      const conn = new SingleAccountConnector(acc);
      await conn.loadState();

      // Forward events with accountId tag
      conn.on('message', (msg: any) => this.emit('message', msg));
      conn.on('connected', (info: any) => this.emit('connected', info));
      conn.on('pairing:approved', (info: any) => this.emit('pairing:approved', info));
      conn.on('interaction', (info: any) => this.emit('interaction', info));
      conn.on('reaction', (info: any) => this.emit('reaction', info));
      conn.on('slash_command', (info: any) => this.emit('slash_command', info));

      await conn.connect();
      this.accounts.set(id, conn);
    }
  }

  disconnect(): void {
    for (const conn of this.accounts.values()) conn.disconnect();
    this.accounts.clear();
  }

  // ---- Delegate to account ------------------------------------------------

  private _acc(accountId = 'default'): SingleAccountConnector {
    const conn = this.accounts.get(accountId);
    if (!conn) throw new Error(`Mattermost: account '${accountId}' not found`);
    return conn;
  }

  async sendMessage(channelId: string, text: string, attachments?: object[], accountId?: string): Promise<any> {
    return this._acc(accountId).sendMessage(channelId, text, attachments);
  }

  async addReaction(postId: string, emoji: string, accountId?: string): Promise<void> {
    return this._acc(accountId).addReaction(postId, emoji);
  }

  async removeReaction(postId: string, emoji: string, accountId?: string): Promise<void> {
    return this._acc(accountId).removeReaction(postId, emoji);
  }

  async resolveTarget(target: string, accountId?: string): Promise<{ type: 'channel' | 'dm'; id: string }> {
    return this._acc(accountId).resolveTarget(target);
  }

  handleInteraction(context: Record<string, unknown>, accountId?: string): { ok: boolean; error?: string } {
    return this._acc(accountId).handleInteraction(context);
  }

  async handleWebhook(body: string, webhookToken: string, accountId?: string): Promise<void> {
    return this._acc(accountId).handleWebhook(body, webhookToken);
  }

  async handleSlashCommand(payload: Record<string, string>, expectedToken: string, accountId?: string): Promise<string | null> {
    return this._acc(accountId).handleSlashCommand(payload, expectedToken);
  }

  approvePairing(code: string, accountId?: string): boolean {
    return this._acc(accountId).approvePairing(code);
  }

  listPendingPairings(accountId?: string): Record<string, string> {
    return this._acc(accountId).listPendingPairings();
  }

  getAccountIds(): string[] {
    return Array.from(this.accounts.keys());
  }

  isRunning(): boolean {
    return this.accounts.size > 0;
  }
}
