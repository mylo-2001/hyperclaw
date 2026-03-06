/**
 * extensions/nextcloud/src/connector.ts
 * Nextcloud Talk connector — Nextcloud OCS API v2 polling loop.
 * No SDK. Uses Basic Auth (username + app-password).
 *
 * Nextcloud Talk API: /ocs/v2.php/apps/spreed/api/v4/
 *   GET  /room                   — list rooms
 *   GET  /chat/{token}           — get messages (with lastKnownMessageId)
 *   POST /chat/{token}           — send message
 *
 * Auth: Basic Auth with username + Nextcloud App Password.
 * Generate: Nextcloud → Profile → Security → App passwords → Create new.
 */

import https from 'https';
import http from 'http';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'nextcloud-state.json');
const POLL_INTERVAL_MS = 3000;

export interface NextcloudConfig {
  /** Full URL of the Nextcloud instance, e.g. https://cloud.example.com */
  serverUrl: string;
  username: string;
  /** App password from Security → App passwords */
  password: string;
  /** Which room tokens to listen to — empty = all rooms the user is in */
  rooms?: string[];
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function ncReq(
  serverUrl: string, username: string, password: string,
  method: string, apiPath: string, body?: object
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${serverUrl}/ocs/v2.php/apps/spreed/api/v4${apiPath}`);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const payload = body ? JSON.stringify(body) : null;
    const req = (mod as any).request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'OCS-APIRequest': 'true',
        'Accept': 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res: any) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const ocs = parsed?.ocs;
          if (ocs?.meta?.statuscode >= 400) reject(new Error(ocs.meta.message || 'OCS error'));
          else resolve(ocs?.data ?? parsed);
        } catch { reject(new Error('Invalid JSON from Nextcloud')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class NextcloudConnector extends EventEmitter {
  config: NextcloudConfig;
  private running = false;
  private lastMessageIds: Record<string, number> = {};

  constructor(config: Partial<NextcloudConfig> & { serverUrl: string; username: string; password: string }) {
    super();
    this.config = {
      rooms: [],
      dmPolicy: 'pairing',
      allowFrom: [],
      approvedPairings: [],
      pendingPairings: {},
      ...config
    } as NextcloudConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    // Verify credentials
    const rooms = await ncReq(this.config.serverUrl, this.config.username, this.config.password, 'GET', '/room');
    this.running = true;
    console.log(chalk.green(`  🦅 Nextcloud Talk: connected as ${this.config.username}, ${(rooms as any[]).length} rooms`));
    this.emit('connected', { username: this.config.username, rooms: (rooms as any[]).length });
    this.pollLoop();
  }

  disconnect(): void { this.running = false; }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const rooms: any[] = await ncReq(
          this.config.serverUrl, this.config.username, this.config.password, 'GET', '/room'
        );
        for (const room of rooms) {
          const token: string = room.token;
          if (this.config.rooms?.length && !this.config.rooms.includes(token)) continue;
          await this.pollRoom(room);
        }
      } catch (e: any) {
        if (this.running) console.log(chalk.yellow(`  ⚠  Nextcloud: ${e.message}`));
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  private async pollRoom(room: any): Promise<void> {
    const token: string = room.token;
    const lastId = this.lastMessageIds[token] ?? 0;
    const params = lastId > 0 ? `?lastKnownMessageId=${lastId}&lookIntoFuture=1&limit=20` : '?limit=5';
    const messages: any[] = await ncReq(
      this.config.serverUrl, this.config.username, this.config.password, 'GET', `/chat/${token}${params}`
    );
    if (!Array.isArray(messages) || messages.length === 0) return;

    for (const msg of messages) {
      // Skip system messages, own messages, and already-seen
      if (msg.systemMessage) continue;
      if (msg.actorId === this.config.username) continue;
      if (msg.id <= lastId) continue;

      const text: string = msg.message || '';
      const author: string = msg.actorDisplayName || msg.actorId || 'unknown';
      if (!text) continue;

      const allowed = await this.checkPolicy(author, token, text);
      if (allowed) {
        this.emit('message', {
          id: `nc-${token}-${msg.id}`,
          channelId: 'nextcloud',
          from: author,
          chatId: token,
          chatName: room.displayName || token,
          text,
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          isDM: room.type === 1
        });
      }
    }
    const maxId = Math.max(...messages.map((m: any) => m.id as number));
    if (maxId > 0) {
      this.lastMessageIds[token] = maxId;
      await this.saveState();
    }
  }

  private async checkPolicy(author: string, chatId: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(author)) return true;
      await this.sendMessage(chatId, '🦅 You are not on the allowlist.');
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(author)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(author);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(chatId, '🦅 Paired! You can now talk to the assistant.');
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = author;
      await this.saveState();
      await this.sendMessage(chatId, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve nextcloud ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(token: string, text: string): Promise<void> {
    await ncReq(this.config.serverUrl, this.config.username, this.config.password, 'POST', `/chat/${token}`, { message: text });
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
      if (s.m) this.lastMessageIds = s.m;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      p: this.config.pendingPairings,
      a: this.config.approvedPairings,
      m: this.lastMessageIds
    }, { spaces: 2 });
  }

  isRunning(): boolean { return this.running; }
}
