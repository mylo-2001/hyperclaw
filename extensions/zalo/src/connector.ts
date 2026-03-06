/**
 * extensions/zalo/src/connector.ts
 * REAL Zalo Official Account connector — Zalo API + webhook.
 * User provides: appId, appSecret, oaAccessToken (from developers.zalo.me)
 * Setup: developers.zalo.me → Create Official Account App
 *        Webhook: /webhook/zalo
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'zalo-state.json');

export interface ZaloConfig {
  appId: string;
  appSecret: string;
  oaAccessToken: string;  // Official Account access token
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function zaloReq(token: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'openapi.zalo.me', port: 443, path: `/v2.0/oa${endpoint}`, method,
      headers: { 'access_token': token, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { const r = JSON.parse(data); if (r.error) reject(new Error(r.message)); else resolve(r); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class ZaloConnector extends EventEmitter {
  config: ZaloConfig;
  private running = false;

  constructor(config: Partial<ZaloConfig> & { appId: string; appSecret: string; oaAccessToken: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as ZaloConfig;
  }

  async connect(): Promise<void> {
    const info = await zaloReq(this.config.oaAccessToken, 'GET', '/getoa');
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Zalo OA: ${info.data?.name || this.config.appId} connected`));
    this.emit('connected', { name: info.data?.name });
  }

  disconnect(): void { this.running = false; }

  verifyWebhook(data: string, mac: string): boolean {
    const expected = crypto.createHmac('sha256', this.config.appSecret).update(data).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)); } catch { return false; }
  }

  async handleWebhook(body: string): Promise<void> {
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }
    if (payload.event_name !== 'user_send_text') return;

    const from = payload.sender?.id;
    const text = payload.message?.text;
    if (!from || !text) return;

    const allowed = await this.checkDMPolicy(from, text);
    if (!allowed) return;

    this.emit('message', {
      id: payload.message?.msg_id, channelId: 'zalo', from,
      chatId: from, text, timestamp: new Date(payload.timestamp).toISOString(), isDM: true
    });
  }

  private async checkDMPolicy(from: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.sendMessage(from, '🦅 HyperClaw: Not on allowlist.'); return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from); delete this.config.pendingPairings[upper];
        await this.saveState(); await this.sendMessage(from, '🦅 Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'zalo' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendMessage(from, `🦅 Mã ghép đôi: ${code}\nXác nhận: hyperclaw pairing approve zalo ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    await zaloReq(this.config.oaAccessToken, 'POST', '/message/cs', {
      recipient: { user_id: userId },
      message: { text: text.slice(0, 2000) }
    });
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper]; this.saveState(); return true;
  }

  private async loadState(): Promise<void> { try { const s = await fs.readJson(STATE_FILE); if (s.p) this.config.pendingPairings = s.p; if (s.a) this.config.approvedPairings = s.a; } catch {} }
  private async saveState(): Promise<void> { await fs.ensureDir(path.dirname(STATE_FILE)); await fs.writeJson(STATE_FILE, { p: this.config.pendingPairings, a: this.config.approvedPairings }, { spaces: 2 }); }
  isRunning() { return this.running; }
}
