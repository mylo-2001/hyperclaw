/**
 * extensions/viber/src/connector.ts
 * REAL Viber Business Messages connector — webhook based.
 * User provides: authToken (from partners.viber.com)
 * Webhook URL: /webhook/viber
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'viber-state.json');

export interface ViberConfig {
  authToken: string;
  botName: string;
  webhookUrl: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function viberReq(token: string, endpoint: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'chatapi.viber.com', port: 443, path: `/pa${endpoint}`, method: 'POST',
      headers: { 'X-Viber-Auth-Token': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { const r = JSON.parse(data); if (r.status !== 0) reject(new Error(r.status_message)); else resolve(r); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export class ViberConnector extends EventEmitter {
  config: ViberConfig;
  private running = false;

  constructor(config: Partial<ViberConfig> & { authToken: string; botName: string; webhookUrl: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as ViberConfig;
  }

  async connect(): Promise<void> {
    await viberReq(this.config.authToken, '/set_webhook', {
      url: this.config.webhookUrl,
      event_types: ['delivered', 'seen', 'failed', 'subscribed', 'unsubscribed', 'conversation_started'],
      send_name: true
    });
    const info = await viberReq(this.config.authToken, '/get_account_info', {});
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Viber: ${info.name || this.config.botName} connected`));
    this.emit('connected', { name: info.name });
  }

  disconnect(): void { this.running = false; }

  verifySignature(body: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', this.config.authToken).update(body).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
  }

  async handleWebhook(body: string, signature: string): Promise<void> {
    if (signature && !this.verifySignature(body, signature)) { console.log(chalk.yellow('  ⚠  Viber: invalid signature')); return; }
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }

    if (payload.event === 'message') {
      const userId = payload.sender?.id;
      const text = payload.message?.text;
      if (!userId || !text) return;

      const allowed = await this.checkDMPolicy(userId, text);
      if (!allowed) return;

      this.emit('message', {
        id: payload.message_token?.toString(), channelId: 'viber',
        from: userId, chatId: userId, text, senderName: payload.sender?.name,
        timestamp: new Date(payload.timestamp).toISOString(), isDM: true
      });
    }

    if (payload.event === 'conversation_started') {
      await this.sendMessage(payload.user?.id, `🦅 Hi ${payload.user?.name || 'there'}! I'm HyperClaw.`);
    }
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
        this.emit('pairing:approved', { userId: from, channelId: 'viber' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendMessage(from, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve viber ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    await viberReq(this.config.authToken, '/send_message', {
      receiver: userId, type: 'text', sender: { name: this.config.botName },
      text: text.slice(0, 7000)
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
