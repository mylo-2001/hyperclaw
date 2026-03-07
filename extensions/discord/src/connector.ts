/**
 * extensions/discord/src/connector.ts
 * REAL Discord connector — Discord Gateway WebSocket API v10.
 * No SDK. Uses native wss:// with heartbeat, identify, reconnect.
 * Handles: DMs, guild messages, slash commands, DM pairing.
 */

import https from 'https';
import { WebSocket } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_CDN = 'https://cdn.discordapp.com';
const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'discord-state.json');

// ─── Discord API types ────────────────────────────────────────────────────────

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  referenced_message?: DiscordMessage;
  mentions?: Array<{ id: string; username: string }>;
  attachments?: Array<{ id: string; url: string; filename: string }>;
}

export interface DiscordChannel {
  id: string;
  type: number; // 1 = DM, 0 = guild text
  name?: string;
  guild_id?: string;
}

// Discord Gateway opcodes
const OPC = {
  DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6,
  RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11
} as const;

// Intent bits
const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_CONTENT: 1 << 15,
  DIRECT_MESSAGES: 1 << 12,
  DIRECT_MESSAGE_CONTENT: 1 << 14, // requires privileged intent
} as const;

// ─── REST helper ──────────────────────────────────────────────────────────────

function discordRest(token: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${endpoint}`,
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'User-Agent': 'HyperClaw/5.0.0 (https://hyperclaw.ai)',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 204) return resolve(null);
        try {
          const r = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Discord API ${res.statusCode}: ${r.message || data}`));
          } else {
            resolve(r);
          }
        } catch { reject(new Error(`Invalid JSON (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface DiscordPairingBridge {
  isApproved(senderId: string): Promise<boolean>;
  createRequest(senderId: string): Promise<string | null>;
  verify(code: string, senderId: string): Promise<boolean>;
}

export interface DiscordConfig {
  token: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];          // Discord user IDs
  approvedPairings: string[];   // fallback when no pairingBridge
  pendingPairings: Record<string, string>; // legacy fallback
  listenGuildIds: string[];     // empty = listen all; when set, only these guilds
  requireMentionInGuild?: boolean; // when true, must @mention in guild channels
  commandPrefix: string;        // default: '!'
  pairingBridge?: DiscordPairingBridge; // use PairingStore when set
  slashCommands?: boolean;     // register /help, /status. default: true
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class DiscordConnector extends EventEmitter {
  private token: string;
  config: DiscordConfig;
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private running = false;
  botUser: DiscordUser | null = null;

  constructor(token: string, config?: Partial<DiscordConfig>) {
    super();
    this.token = token;
    this.config = {
      token, dmPolicy: 'allowlist', allowFrom: [],
      approvedPairings: [], pendingPairings: {},
      listenGuildIds: [], commandPrefix: '!',
      ...config
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    // Get gateway URL
    const gateway = await discordRest(this.token, 'GET', '/gateway/bot');
    const wsUrl = (gateway.url || 'wss://gateway.discord.gg') + '/?v=10&encoding=json';

    this.botUser = await discordRest(this.token, 'GET', '/users/@me');
    console.log(chalk.green(`  🦅 Discord: @${this.botUser?.username} connected`));

    await this.loadState();
    this.running = true;
    await this.openWebSocket(wsUrl);
  }

  async disconnect(): Promise<void> {
    this.running = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.ws?.close(1000);
    await this.saveState();
  }

  private async openWebSocket(url: string): Promise<void> {
    this.ws = new WebSocket(url, {
      headers: { 'User-Agent': 'HyperClaw/5.0.0' }
    });

    this.ws.on('message', async (data) => {
      const payload = JSON.parse(data.toString());
      await this.handlePayload(payload);
    });

    this.ws.on('close', (code) => {
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      if (!this.running) return;

      const resumable = ![1000, 4004, 4010, 4011, 4012, 4013, 4014].includes(code);
      console.log(chalk.yellow(`  ⚠  Discord WS closed (${code}) — ${resumable ? 'resuming' : 'reconnecting'} in 5s`));
      setTimeout(() => {
        if (this.running) {
          const url = resumable && this.resumeGatewayUrl
            ? this.resumeGatewayUrl + '/?v=10&encoding=json'
            : 'wss://gateway.discord.gg/?v=10&encoding=json';
          this.openWebSocket(url);
        }
      }, 5000);
    });

    this.ws.on('error', (e) => console.log(chalk.yellow(`  ⚠  Discord WS error: ${e.message}`)));
  }

  private async handlePayload(payload: any): Promise<void> {
    const { op, d, s, t } = payload;
    if (s !== null && s !== undefined) this.lastSequence = s;

    switch (op) {
      case OPC.HELLO:
        this.startHeartbeat(d.heartbeat_interval);
        if (this.sessionId && this.lastSequence) {
          this.resume();
        } else {
          this.identify();
        }
        break;

      case OPC.HEARTBEAT_ACK:
        break;

      case OPC.HEARTBEAT:
        this.sendWs({ op: OPC.HEARTBEAT, d: this.lastSequence });
        break;

      case OPC.RECONNECT:
        this.ws?.close(4000);
        break;

      case OPC.INVALID_SESSION:
        if (d) {
          setTimeout(() => this.resume(), 2000);
        } else {
          this.sessionId = null;
          this.lastSequence = null;
          setTimeout(() => this.identify(), 2000);
        }
        break;

      case OPC.DISPATCH:
        await this.handleEvent(t, d);
        break;
    }
  }

  private identify(): void {
    const intents =
      INTENTS.GUILDS |
      INTENTS.GUILD_MESSAGES |
      INTENTS.GUILD_MESSAGE_CONTENT |
      INTENTS.DIRECT_MESSAGES;

    this.sendWs({
      op: OPC.IDENTIFY,
      d: {
        token: this.token,
        intents,
        properties: { os: process.platform, browser: 'HyperClaw', device: 'HyperClaw' }
      }
    });
  }

  private resume(): void {
    this.sendWs({
      op: OPC.RESUME,
      d: { token: this.token, session_id: this.sessionId, seq: this.lastSequence }
    });
  }

  private startHeartbeat(interval: number): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      this.sendWs({ op: OPC.HEARTBEAT, d: this.lastSequence });
    }, interval);
  }

  private sendWs(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  // ─── Event handling ────────────────────────────────────────────────────────

  private async handleEvent(type: string, data: any): Promise<void> {
    switch (type) {
      case 'READY':
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        this.botUser = data.user;
        await this.saveState();
        if (this.config.slashCommands !== false) this.registerSlashCommands().catch(e => console.log(chalk.yellow(`  Discord slash commands: ${e.message}`)));
        this.emit('ready', data.user);
        break;

      case 'RESUMED':
        console.log(chalk.gray('  Discord session resumed'));
        break;

      case 'INTERACTION_CREATE':
        await this.handleInteraction(data);
        break;

      case 'MESSAGE_CREATE':
        await this.handleMessage(data);
        break;
    }
  }

  private async handleMessage(msg: DiscordMessage): Promise<void> {
    if (msg.author.id === this.botUser?.id) return;
    if (msg.author.bot) return;

    const isDM = !msg.channel_id.startsWith('0') && await this.isDirectMessage(msg.channel_id);
    const userId = msg.author.id;

    if (isDM) {
      const allowed = await this.checkDMPolicy(userId, msg.channel_id, msg.content);
      if (!allowed) return;
    } else {
      const guildAllowed = await this.checkGuildPolicy(msg);
      if (!guildAllowed) return;
    }

    this.emit('message', {
      id: msg.id,
      channelId: 'discord',
      from: userId,
      fromUsername: msg.author.global_name || msg.author.username,
      chatId: msg.channel_id,
      text: msg.content,
      timestamp: msg.timestamp,
      isDM
    });
  }

  private dmChannelCache = new Set<string>();

  private async isDirectMessage(channelId: string): Promise<boolean> {
    if (this.dmChannelCache.has(channelId)) return true;
    try {
      const channel = await discordRest(this.token, 'GET', `/channels/${channelId}`);
      if (channel.type === 1) { // DM type
        this.dmChannelCache.add(channelId);
        return true;
      }
    } catch {}
    return false;
  }

  // ─── Guild policy ──────────────────────────────────────────────────────────

  private async checkGuildPolicy(msg: DiscordMessage): Promise<boolean> {
    const channelId = msg.channel_id;
    let guildId: string | undefined;
    try {
      const ch = await discordRest(this.token, 'GET', `/channels/${channelId}`);
      guildId = ch.guild_id;
    } catch { return false; }
    if (!guildId) return false;

    if (this.config.listenGuildIds.length > 0 && !this.config.listenGuildIds.includes(guildId)) return false;

    if (this.config.requireMentionInGuild !== false) {
      const content = msg.content || '';
      const mentioned = msg.mentions?.some((m: any) => m.id === this.botUser?.id) ?? false;
      const botMention = this.botUser ? `<@${this.botUser.id}>` : '';
      if (!mentioned && !content.includes(botMention) && !msg.referenced_message?.author?.bot) return false;
    }
    return true;
  }

  // ─── DM Policy ─────────────────────────────────────────────────────────────

  private async checkDMPolicy(userId: string, channelId: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;

    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(userId)) return true;
      await this.sendMessage(channelId, '🦅 **HyperClaw**\n\nYou are not on the allowlist.');
      return false;
    }

    if (this.config.dmPolicy === 'pairing') {
      const bridge = this.config.pairingBridge;
      if (bridge) {
        if (await bridge.isApproved(userId)) return true;
        const upper = text.trim().toUpperCase().replace(/\s/g, '');
        if (upper.length >= 6 && upper.length <= 10) {
          const verified = await bridge.verify(upper, userId);
          if (verified) {
            await this.sendMessage(channelId, '🦅 **Paired!** You can now send messages.');
            this.emit('pairing:approved', { userId, channelId: 'discord' });
            return true;
          }
        }
        const code = await bridge.createRequest(userId);
        if (code) {
          await this.sendMessage(channelId,
            `🦅 **HyperClaw Pairing**\n\nSend the owner this code:\n\`${code}\`\n\nApprove with:\n\`hyperclaw pairing approve discord ${code}\``
          );
        } else {
          await this.sendMessage(channelId, '🦅 **HyperClaw Pairing**\n\nYou already have a pending request. Check with the owner to approve.');
        }
        return false;
      }
      if (this.config.approvedPairings.includes(userId)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(userId);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(channelId, '🦅 **Paired!** You can now send messages.');
        this.emit('pairing:approved', { userId, channelId: 'discord' });
        return true;
      }
      const code = this.generateCode();
      this.config.pendingPairings[code] = userId;
      await this.saveState();
      await this.sendMessage(channelId,
        `🦅 **HyperClaw Pairing**\n\nSend the owner this code:\n\`${code}\`\n\nApprove with:\n\`hyperclaw pairing approve discord ${code}\``
      );
      return false;
    }

    return false;
  }

  // ─── Slash commands ────────────────────────────────────────────────────────

  private async registerSlashCommands(): Promise<void> {
    const app = await discordRest(this.token, 'GET', '/oauth2/applications/@me');
    const appId = app.id;
    if (!appId) return;
    const commands = [
      { name: 'help', description: 'Show HyperClaw help and commands' },
      { name: 'status', description: 'Show gateway status' }
    ];
    await discordRest(this.token, 'PUT', `/applications/${appId}/commands`, commands);
  }

  private async handleInteraction(interaction: any): Promise<void> {
    const { id, token, type, data } = interaction;
    if (type !== 2 || !data?.name) return; // APPLICATION_COMMAND
    const name = data.name as string;
    let content = '';
    if (name === 'help') {
      content = '🦅 **HyperClaw** — AI agent on Discord.\n\n'
        + '**Commands:** `/help`, `/status`\n'
        + '**Chat:** Just send a message (DM or @mention in servers).\n'
        + '**Pairing:** DM the bot to get a pairing code, then run `hyperclaw pairing approve discord <CODE>` on the host.';
    } else if (name === 'status') {
      content = '🦅 **HyperClaw** — gateway connected. Send a message to chat with the agent.';
    } else return;
    const payload = { type: 4, data: { content, flags: 64 } }; // 64 = ephemeral
    await discordRest(this.token, 'POST', `/interactions/${id}/${token}/callback`, payload);
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  async sendMessage(channelId: string, content: string): Promise<DiscordMessage | null> {
    const chunks = content.match(/.{1,2000}/gs) || [content];
    let last = null;
    for (const chunk of chunks) {
      last = await discordRest(this.token, 'POST', `/channels/${channelId}/messages`, { content: chunk });
    }
    return last;
  }

  async sendTyping(channelId: string): Promise<void> {
    await discordRest(this.token, 'POST', `/channels/${channelId}/typing`).catch(() => {});
  }

  async createDMChannel(userId: string): Promise<string> {
    const ch = await discordRest(this.token, 'POST', '/users/@me/channels', { recipient_id: userId });
    return ch.id;
  }

  async sendDM(userId: string, content: string): Promise<void> {
    const channelId = await this.createDMChannel(userId);
    await this.sendMessage(channelId, content);
  }

  // ─── Pairing ───────────────────────────────────────────────────────────────

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
  }

  addToAllowlist(userId: string): void {
    if (!this.config.allowFrom.includes(userId)) { this.config.allowFrom.push(userId); this.saveState(); }
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      this.sessionId = s.sessionId || null;
      this.lastSequence = s.lastSequence || null;
      this.resumeGatewayUrl = s.resumeGatewayUrl || null;
      if (s.pendingPairings) this.config.pendingPairings = s.pendingPairings;
      if (s.approvedPairings) this.config.approvedPairings = s.approvedPairings;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      sessionId: this.sessionId, lastSequence: this.lastSequence,
      resumeGatewayUrl: this.resumeGatewayUrl,
      pendingPairings: this.config.pendingPairings,
      approvedPairings: this.config.approvedPairings
    }, { spaces: 2 });
  }

  isRunning() { return this.running; }
  getBotUser() { return this.botUser; }
}
