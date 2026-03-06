/**
 * extensions/matrix/src/connector.ts
 * REAL Matrix connector — Matrix Client-Server API.
 * No SDK. Sync loop, room handling, DM pairing.
 */

import https from 'https';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'matrix-state.json');

export interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function matrixReq(homeserver: string, token: string, method: string, apiPath: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(homeserver);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = (mod as any).request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `/_matrix/client/r0${apiPath}?access_token=${token}`,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, (res: any) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
      res.on('end', () => {
        try { const r = JSON.parse(data); if (r.errcode) reject(new Error(r.error)); else resolve(r); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class MatrixConnector extends EventEmitter {
  config: MatrixConfig;
  private running = false;
  private nextBatch: string | null = null;

  constructor(config: Partial<MatrixConfig> & { homeserver: string; accessToken: string; userId: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as MatrixConfig;
  }

  async connect(): Promise<void> {
    const whoami = await matrixReq(this.config.homeserver, this.config.accessToken, 'GET', '/account/whoami');
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Matrix: ${whoami.user_id} connected`));
    this.emit('connected', { userId: whoami.user_id });
    this.syncLoop();
  }

  disconnect(): void { this.running = false; }

  private async syncLoop(): Promise<void> {
    while (this.running) {
      try {
        const since = this.nextBatch ? `&since=${this.nextBatch}&timeout=30000` : '';
        const sync = await matrixReq(this.config.homeserver, this.config.accessToken, 'GET', `/sync?${since}`);
        this.nextBatch = sync.next_batch;
        await this.saveState();
        const rooms = sync.rooms?.join || {};
        for (const [roomId, rd] of Object.entries(rooms) as any) {
          for (const event of (rd.timeline?.events || [])) {
            if (event.type === 'm.room.message' && event.sender !== this.config.userId) {
              await this.handleRoomEvent(roomId, event);
            }
          }
        }
        for (const [roomId] of Object.entries(sync.rooms?.invite || {})) {
          await matrixReq(this.config.homeserver, this.config.accessToken, 'POST', `/rooms/${roomId}/join`, {});
        }
      } catch (e: any) {
        if (this.running) { console.log(chalk.yellow(`  ⚠  Matrix: ${e.message}`)); await new Promise(r => setTimeout(r, 5000)); }
      }
    }
  }

  private async handleRoomEvent(roomId: string, event: any): Promise<void> {
    const text = event.content?.body;
    const sender = event.sender;
    if (!text || !sender) return;
    if (this.config.dmPolicy !== 'open') {
      const allowed = await this.checkPolicy(sender, roomId, text);
      if (!allowed) return;
    }
    this.emit('message', { id: event.event_id, channelId: 'matrix', from: sender, chatId: roomId, text, timestamp: new Date(event.origin_server_ts || Date.now()).toISOString(), isDM: true });
  }

  private async checkPolicy(sender: string, roomId: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(sender)) return true;
      await this.sendMessage(roomId, '🦅 Not on allowlist.');
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(sender)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(sender);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(roomId, '🦅 Paired!');
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = sender;
      await this.saveState();
      await this.sendMessage(roomId, `🦅 Pairing code: \`${code}\`\nApprove: hyperclaw pairing approve matrix ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(roomId: string, text: string): Promise<void> {
    await matrixReq(this.config.homeserver, this.config.accessToken, 'PUT',
      `/rooms/${roomId}/send/m.room.message/${Date.now()}`,
      { msgtype: 'm.text', body: text }
    );
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
    try { const s = await fs.readJson(STATE_FILE); this.nextBatch = s.nextBatch || null; if (s.p) this.config.pendingPairings = s.p; if (s.a) this.config.approvedPairings = s.a; } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, { nextBatch: this.nextBatch, p: this.config.pendingPairings, a: this.config.approvedPairings }, { spaces: 2 });
  }

  isRunning() { return this.running; }
}
