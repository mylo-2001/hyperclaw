/**
 * extensions/twitch/src/connector.ts
 * Twitch chat connector — Twitch IRC over WebSocket (TMI protocol).
 * No SDK. Raw WebSocket connection to irc-ws.chat.twitch.tv:443.
 * Supports channel chat, whispers, command prefix, and DM pairing.
 *
 * Auth: OAuth token from https://twitchapps.com/tmi/ or your own app.
 * Token format: "oauth:xxxxxxxxxxxxxx"
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'twitch-state.json');
const TWITCH_IRC_WS = 'wss://irc-ws.chat.twitch.tv:443';

export interface TwitchConfig {
  /** Twitch bot username (lowercase) */
  username: string;
  /** OAuth token, e.g. "oauth:xxxxxx" */
  oauthToken: string;
  /** Twitch channel(s) to join, e.g. ["mychannel"] */
  channels: string[];
  /** Only respond to messages that start with this prefix, e.g. "!" */
  commandPrefix?: string;
  /** Respond to whispers (DMs) */
  whispers?: boolean;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  /** Moderators and the broadcaster bypass allowlist */
  modsBypass?: boolean;
}

export class TwitchConnector extends EventEmitter {
  config: TwitchConfig;
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectDelay = 1000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<TwitchConfig> & { username: string; oauthToken: string; channels: string[] }) {
    super();
    this.config = {
      commandPrefix: '!',
      whispers: true,
      dmPolicy: 'pairing',
      allowFrom: [],
      approvedPairings: [],
      pendingPairings: {},
      modsBypass: true,
      ...config
    } as TwitchConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    await this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(TWITCH_IRC_WS);
      this.ws = ws;

      ws.once('open', () => {
        ws.send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands');
        ws.send(`PASS ${this.config.oauthToken}`);
        ws.send(`NICK ${this.config.username}`);
        for (const ch of this.config.channels) {
          ws.send(`JOIN #${ch.replace(/^#/, '').toLowerCase()}`);
        }
        this.running = true;
        this.reconnectDelay = 1000;
        this.pingInterval = setInterval(() => ws.send('PING :tmi.twitch.tv'), 60_000);
        console.log(chalk.green(`  🦅 Twitch: connected as ${this.config.username}, joined ${this.config.channels.join(', ')}`));
        this.emit('connected', { username: this.config.username });
        resolve();
      });

      ws.on('message', async (raw: Buffer) => {
        const lines = raw.toString().split('\r\n').filter(Boolean);
        for (const line of lines) {
          await this.handleLine(line);
        }
      });

      ws.on('close', () => {
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
        if (this.running) {
          console.log(chalk.yellow(`  ⚠  Twitch: disconnected, reconnecting in ${this.reconnectDelay}ms`));
          setTimeout(() => { this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000); this.doConnect(); }, this.reconnectDelay);
        }
      });

      ws.on('error', (err) => {
        console.log(chalk.yellow(`  ⚠  Twitch: ${err.message}`));
        if (!this.running) reject(err);
      });
    });
  }

  disconnect(): void {
    this.running = false;
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    this.ws?.close();
    this.ws = null;
  }

  private async handleLine(line: string): Promise<void> {
    // PING keepalive
    if (line === 'PING :tmi.twitch.tv') {
      this.ws?.send('PONG :tmi.twitch.tv');
      return;
    }

    // Parse TMI tags
    const tags = this.parseTags(line);
    const parsed = this.parseIRC(line);
    if (!parsed) return;

    const { command, prefix, params, trailing } = parsed;
    const username = prefix?.split('!')[0]?.toLowerCase() || '';

    // Skip own messages
    if (username === this.config.username.toLowerCase()) return;

    if (command === 'PRIVMSG') {
      const channel = params[0]; // e.g. #mychannel
      const text = trailing || '';
      const isWhisper = false;

      // Filter by command prefix in chat (not required for whispers)
      if (this.config.commandPrefix && !text.startsWith(this.config.commandPrefix) && !isWhisper) return;

      const body = this.config.commandPrefix ? text.slice(this.config.commandPrefix.length).trim() : text;
      if (!body) return;

      const isMod = tags['mod'] === '1' || tags['badges']?.includes('broadcaster');
      const allowed = await this.checkPolicy(username, channel, body, isMod);
      if (!allowed) return;

      this.emit('message', {
        id: tags['id'] || `twitch-${Date.now()}`,
        channelId: 'twitch',
        from: username,
        displayName: tags['display-name'] || username,
        chatId: channel,
        text: body,
        timestamp: tags['tmi-sent-ts'] ? new Date(Number(tags['tmi-sent-ts'])).toISOString() : new Date().toISOString(),
        isDM: false,
        isMod
      });
      return;
    }

    // Whisper (DM)
    if (command === 'WHISPER' && this.config.whispers) {
      const text = trailing || '';
      if (!text) return;
      const allowed = await this.checkPolicy(username, 'whisper', text, false);
      if (!allowed) return;

      this.emit('message', {
        id: `twitch-whisper-${Date.now()}`,
        channelId: 'twitch',
        from: username,
        displayName: tags['display-name'] || username,
        chatId: `whisper:${username}`,
        text,
        timestamp: new Date().toISOString(),
        isDM: true,
        isMod: false
      });
    }
  }

  private async checkPolicy(username: string, chatId: string, text: string, isMod: boolean): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.modsBypass && isMod) return true;

    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(username)) return true;
      await this.sendChat(chatId, `@${username} You are not on the allowlist.`);
      return false;
    }

    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(username)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(username);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendChat(chatId, `@${username} Paired! You can now talk to the assistant.`);
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = username;
      await this.saveState();
      await this.sendChat(chatId, `@${username} Pairing required. Code: ${code} — approve: hyperclaw pairing approve twitch ${code}`);
      return false;
    }

    return false;
  }

  async sendChat(channel: string, text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const ch = channel.startsWith('#') ? channel : `#${channel}`;
    // Twitch max message length is 500 chars
    const chunks = text.match(/.{1,490}/g) || [text];
    for (const chunk of chunks) {
      this.ws.send(`PRIVMSG ${ch} :${chunk}`);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async sendWhisper(username: string, text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const ch = `#${this.config.channels[0]?.replace(/^#/, '') || this.config.username}`;
    this.ws.send(`PRIVMSG ${ch} :/w ${username} ${text}`);
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
  }

  private parseTags(line: string): Record<string, string> {
    if (!line.startsWith('@')) return {};
    const tagStr = line.slice(1, line.indexOf(' '));
    const tags: Record<string, string> = {};
    for (const part of tagStr.split(';')) {
      const [k, v] = part.split('=');
      if (k) tags[k] = v || '';
    }
    return tags;
  }

  private parseIRC(line: string): { command: string; prefix?: string; params: string[]; trailing?: string } | null {
    // Strip tags
    let rest = line.startsWith('@') ? line.slice(line.indexOf(' ') + 1) : line;
    let prefix: string | undefined;
    if (rest.startsWith(':')) {
      const spaceIdx = rest.indexOf(' ');
      prefix = rest.slice(1, spaceIdx);
      rest = rest.slice(spaceIdx + 1);
    }
    const trailingIdx = rest.indexOf(' :');
    let trailing: string | undefined;
    if (trailingIdx !== -1) {
      trailing = rest.slice(trailingIdx + 2);
      rest = rest.slice(0, trailingIdx);
    }
    const parts = rest.trim().split(' ');
    const command = parts[0];
    const params = parts.slice(1).filter(Boolean);
    if (!command) return null;
    return { command, prefix, params, trailing };
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      p: this.config.pendingPairings,
      a: this.config.approvedPairings
    }, { spaces: 2 });
  }

  isRunning(): boolean { return this.running; }
}
