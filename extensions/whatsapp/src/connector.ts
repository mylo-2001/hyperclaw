/**
 * extensions/whatsapp/src/connector.ts
 * REAL WhatsApp Business Cloud API connector.
 * User provides: phone_number_id, access_token, verify_token (from Meta Developer Console)
 *
 * Setup (user does this):
 * 1. meta.com/developers → New App → Business
 * 2. Add WhatsApp product → get phone_number_id + temporary access token
 * 3. Set webhook URL: https://your-server/webhook/whatsapp
 *    Verify token: anything you choose (same as verifyToken below)
 * 4. Subscribe to: messages
 */

import https from 'https';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'whatsapp-state.json');
const GRAPH_API = 'graph.facebook.com';
const API_VERSION = 'v18.0';

export interface WhatsAppConfig {
  phoneNumberId: string;    // from Meta Developer Console
  accessToken: string;      // permanent system user token (or temp token)
  verifyToken: string;      // for webhook verification
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];      // phone numbers e.g. +30698...
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function graphReq(token: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: GRAPH_API,
      port: 443,
      path: `/${API_VERSION}${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.error) reject(new Error(`${r.error.code}: ${r.error.message}`));
          else resolve(r);
        } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class WhatsAppConnector extends EventEmitter {
  config: WhatsAppConfig;
  private running = false;

  constructor(config: Partial<WhatsAppConfig> & { phoneNumberId: string; accessToken: string; verifyToken: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as WhatsAppConfig;
  }

  async connect(): Promise<void> {
    // Verify credentials by fetching phone number info
    const info = await graphReq(this.config.accessToken, 'GET', `/${this.config.phoneNumberId}`);
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 WhatsApp: ${info.display_phone_number || this.config.phoneNumberId} connected`));
    this.emit('connected', { phoneNumberId: this.config.phoneNumberId, number: info.display_phone_number });
  }

  disconnect(): void { this.running = false; }

  // Webhook verification (GET)
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.config.verifyToken) return challenge;
    return null;
  }

  // Incoming webhook (POST)
  async handleWebhook(body: string): Promise<void> {
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }

    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value?.messages) return;

    for (const msg of value.messages) {
      if (msg.type !== 'text') continue;
      const from = msg.from; // phone number
      const text = msg.text?.body;
      if (!text) continue;

      // Mark as read
      await this.markRead(msg.id).catch(() => {});

      const allowed = await this.checkDMPolicy(from, text);
      if (!allowed) continue;

      this.emit('message', {
        id: msg.id,
        channelId: 'whatsapp',
        from,
        chatId: from,
        text,
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        isDM: true,
        name: value.contacts?.[0]?.profile?.name
      });
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
        await this.sendMessage(from, '🦅 *Paired!* You can now send messages.');
        this.emit('pairing:approved', { userId: from, channelId: 'whatsapp' });
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from;
      await this.saveState();
      await this.sendMessage(from, `🦅 HyperClaw Pairing\n\nCode: *${code}*\nAsk owner: hyperclaw pairing approve whatsapp ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    await graphReq(this.config.accessToken, 'POST', `/${this.config.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text.slice(0, 4096), preview_url: false }
    });
  }

  async markRead(messageId: string): Promise<void> {
    await graphReq(this.config.accessToken, 'POST', `/${this.config.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    }).catch(() => {});
  }

  async sendTemplate(to: string, templateName: string, languageCode = 'en_US'): Promise<void> {
    await graphReq(this.config.accessToken, 'POST', `/${this.config.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode } }
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

  private async loadState(): Promise<void> {
    try { const s = await fs.readJson(STATE_FILE); if (s.p) this.config.pendingPairings = s.p; if (s.a) this.config.approvedPairings = s.a; } catch {}
  }
  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, { p: this.config.pendingPairings, a: this.config.approvedPairings }, { spaces: 2 });
  }
  isRunning() { return this.running; }
}
