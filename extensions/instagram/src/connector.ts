/**
 * extensions/instagram/src/connector.ts
 * REAL Instagram DM connector — Meta Graph API Webhooks.
 * User provides: page_access_token, instagram_business_account_id, verify_token
 *
 * Setup (user does this):
 * 1. meta.com/developers → App → Messenger + Instagram products
 * 2. Connect Instagram Business account
 * 3. Get Page Access Token (from Graph API Explorer)
 * 4. Set webhook: messages permission, URL: /webhook/instagram
 */

import https from 'https';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'instagram-state.json');

export interface InstagramConfig {
  pageAccessToken: string;
  instagramAccountId: string;
  verifyToken: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function igReq(token: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v18.0${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const r = JSON.parse(data); if (r.error) reject(new Error(r.error.message)); else resolve(r); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class InstagramConnector extends EventEmitter {
  config: InstagramConfig;
  private running = false;
  private processedIds = new Set<string>();

  constructor(config: Partial<InstagramConfig> & { pageAccessToken: string; instagramAccountId: string; verifyToken: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as InstagramConfig;
  }

  async connect(): Promise<void> {
    const info = await igReq(this.config.pageAccessToken, 'GET', `/${this.config.instagramAccountId}?fields=name,username`);
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Instagram: @${info.username || info.name} connected`));
    this.emit('connected', { accountId: this.config.instagramAccountId, username: info.username });
  }

  disconnect(): void { this.running = false; }

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    return (mode === 'subscribe' && token === this.config.verifyToken) ? challenge : null;
  }

  async handleWebhook(body: string): Promise<void> {
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
          id: msgId,
          channelId: 'instagram',
          from: senderId,
          chatId: senderId,
          text,
          timestamp: new Date(messaging.timestamp).toISOString(),
          isDM: true
        });
      }
    }
  }

  private async checkDMPolicy(from: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.sendMessage(from, '🦅 HyperClaw: You are not on the allowlist.');
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(from, '🦅 Paired! You can now send messages.');
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from;
      await this.saveState();
      await this.sendMessage(from, `🦅 HyperClaw Pairing\nCode: ${code}\nApprove: hyperclaw pairing approve instagram ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(recipientId: string, text: string): Promise<void> {
    await igReq(this.config.pageAccessToken, 'POST', `/${this.config.instagramAccountId}/messages`, {
      recipient: { id: recipientId },
      message: { text: text.slice(0, 2000) }
    });
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
  }

  private async loadState(): Promise<void> { try { const s = await fs.readJson(STATE_FILE); if (s.p) this.config.pendingPairings = s.p; if (s.a) this.config.approvedPairings = s.a; } catch {} }
  private async saveState(): Promise<void> { await fs.ensureDir(path.dirname(STATE_FILE)); await fs.writeJson(STATE_FILE, { p: this.config.pendingPairings, a: this.config.approvedPairings }, { spaces: 2 }); }
  isRunning() { return this.running; }
}
