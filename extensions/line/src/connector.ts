/**
 * extensions/line/src/connector.ts
 * REAL LINE Messaging API connector — webhook + reply API.
 * User provides: channelAccessToken, channelSecret
 * Setup: developers.line.biz → Create channel → Messaging API
 *        Webhook URL: /webhook/line
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'line-state.json');

export interface LINEConfig {
  channelAccessToken: string;
  channelSecret: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function lineReq(token: string, endpoint: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.line.me', port: 443, path: endpoint, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export class LINEConnector extends EventEmitter {
  config: LINEConfig;
  private running = false;

  constructor(config: Partial<LINEConfig> & { channelAccessToken: string; channelSecret: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as LINEConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 LINE: connected (webhook mode)`));
    this.emit('connected', {});
  }

  disconnect(): void { this.running = false; }

  verifySignature(body: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', this.config.channelSecret).update(body).digest('base64');
    try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
  }

  async handleWebhook(body: string, signature: string): Promise<void> {
    if (!this.verifySignature(body, signature)) { console.log(chalk.yellow('  ⚠  LINE: invalid signature')); return; }
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }

    for (const event of (payload.events || [])) {
      if (event.type !== 'message' || event.message?.type !== 'text') continue;
      const userId = event.source?.userId;
      const text = event.message.text;
      const replyToken = event.replyToken;
      if (!userId || !text) continue;

      const allowed = await this.checkDMPolicy(userId, text, replyToken);
      if (!allowed) continue;

      this.emit('message', {
        id: event.message.id, channelId: 'line', from: userId,
        chatId: userId, text, replyToken,
        timestamp: new Date(event.timestamp).toISOString(), isDM: true
      });
    }
  }

  private async checkDMPolicy(from: string, text: string, replyToken: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.replyMessage(replyToken, '🦅 HyperClaw: Not on allowlist.'); return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from); delete this.config.pendingPairings[upper];
        await this.saveState(); await this.replyMessage(replyToken, '🦅 Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'line' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.replyMessage(replyToken, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve line ${code}`);
      return false;
    }
    return false;
  }

  async replyMessage(replyToken: string, text: string): Promise<void> {
    await lineReq(this.config.channelAccessToken, '/v2/bot/message/reply', {
      replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }]
    });
  }

  async pushMessage(userId: string, text: string): Promise<void> {
    await lineReq(this.config.channelAccessToken, '/v2/bot/message/push', {
      to: userId, messages: [{ type: 'text', text: text.slice(0, 5000) }]
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
