/**
 * extensions/messenger/src/connector.ts
 * REAL Facebook Messenger connector — Meta Graph API + webhooks.
 * User provides: pageAccessToken, verifyToken, appSecret
 * Setup: meta.com/developers → App → Messenger product
 *        Webhook: /webhook/messenger, subscribe to: messages
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'messenger-state.json');

export interface MessengerConfig {
  pageAccessToken: string;
  verifyToken: string;
  appSecret: string;
  pageId: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function fbReq(token: string, endpoint: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'graph.facebook.com', port: 443, path: `/v18.0${endpoint}`, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { const r = JSON.parse(data); if (r.error) reject(new Error(r.error.message)); else resolve(r); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export class MessengerConnector extends EventEmitter {
  config: MessengerConfig;
  private running = false;
  private processedIds = new Set<string>();

  constructor(config: Partial<MessengerConfig> & { pageAccessToken: string; verifyToken: string; appSecret: string; pageId: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as MessengerConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Messenger: page ${this.config.pageId} connected`));
    this.emit('connected', { pageId: this.config.pageId });
  }

  disconnect(): void { this.running = false; }

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    return (mode === 'subscribe' && token === this.config.verifyToken) ? challenge : null;
  }

  verifySignature(body: string, signature: string): boolean {
    const expected = 'sha256=' + crypto.createHmac('sha256', this.config.appSecret).update(body).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
  }

  async handleWebhook(body: string, signature: string): Promise<void> {
    if (signature && !this.verifySignature(body, signature)) { console.log(chalk.yellow('  ⚠  Messenger: invalid signature')); return; }
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }

    for (const entry of (payload.entry || [])) {
      for (const messaging of (entry.messaging || [])) {
        if (!messaging.message || messaging.message.is_echo) continue;
        const msgId = messaging.message.mid;
        if (this.processedIds.has(msgId)) continue;
        this.processedIds.add(msgId);
        const senderId = messaging.sender.id;
        const text = messaging.message.text;
        if (!text) continue;

        const allowed = await this.checkDMPolicy(senderId, text);
        if (!allowed) continue;

        this.emit('message', {
          id: msgId, channelId: 'messenger', from: senderId, chatId: senderId, text,
          timestamp: new Date(messaging.timestamp).toISOString(), isDM: true
        });
      }
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
        this.emit('pairing:approved', { userId: from, channelId: 'messenger' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendMessage(from, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve messenger ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(recipientId: string, text: string): Promise<void> {
    await fbReq(this.config.pageAccessToken, '/me/messages', {
      recipient: { id: recipientId },
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
