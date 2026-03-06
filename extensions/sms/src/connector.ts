/**
 * extensions/sms/src/connector.ts
 * REAL SMS connector — Twilio REST API + webhook for incoming.
 * No SDK. Native https.
 *
 * Setup:
 * 1. Sign up at twilio.com (free trial = $15 credit)
 * 2. Get Account SID + Auth Token from console
 * 3. Buy a phone number (~$1/month)
 * 4. Set webhook URL: https://your-server/webhook/sms
 *    → Messaging → Phone Numbers → Configure → Webhooks
 *
 * Free alternative: use ngrok to expose local gateway
 *   ngrok http 18789
 *   → use the https URL as webhook
 */

import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'sms-state.json');

export interface SMSConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;      // your Twilio number, e.g. +15551234567
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];     // phone numbers e.g. +30698...
  approvedPairings: string[];
  pendingPairings: Record<string, string>; // code → phone number
}

// ─── Twilio REST helper ───────────────────────────────────────────────────────

function twilioRequest(accountSid: string, authToken: string, method: string, endpoint: string, body?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const payload = body
      ? Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : null;

    const req = https.request({
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${accountSid}${endpoint}.json`,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        ...(payload ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(r.message || `Twilio ${res.statusCode}`));
          } else {
            resolve(r);
          }
        } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class SMSConnector extends EventEmitter {
  config: SMSConfig;
  private running = false;

  constructor(config: Partial<SMSConfig> & { accountSid: string; authToken: string; fromNumber: string }) {
    super();
    this.config = {
      dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {},
      ...config
    } as SMSConfig;
  }

  async connect(): Promise<void> {
    // Verify credentials
    await twilioRequest(this.config.accountSid, this.config.authToken, 'GET', '');
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 SMS: ${this.config.fromNumber} connected via Twilio`));
    this.emit('connected', { number: this.config.fromNumber });
  }

  disconnect(): void {
    this.running = false;
  }

  // ─── Webhook (called by gateway on POST /webhook/sms) ─────────────────────

  async handleWebhook(body: string, twilioSignature: string, webhookUrl: string): Promise<void> {
    // Parse form-encoded Twilio payload
    const params = Object.fromEntries(
      body.split('&').map(p => {
        const [k, v] = p.split('=');
        return [decodeURIComponent(k), decodeURIComponent(v || '').replace(/\+/g, ' ')];
      })
    );

    const from = params.From;
    const text = params.Body;
    const messageSid = params.MessageSid;

    if (!from || !text) return;

    // Verify Twilio signature (prevent spoofing)
    if (twilioSignature && !this.verifySignature(body, twilioSignature, webhookUrl)) {
      console.log(chalk.yellow('  ⚠  SMS: invalid Twilio signature'));
      return;
    }

    const allowed = await this.checkDMPolicy(from, text);
    if (!allowed) return;

    this.emit('message', {
      id: messageSid,
      channelId: 'sms',
      from,
      chatId: from,
      text,
      timestamp: new Date().toISOString(),
      isDM: true
    });
  }

  verifySignature(body: string, signature: string, url: string): boolean {
    // Sort params alphabetically and compute HMAC
    const params = Object.fromEntries(
      body.split('&').map(p => {
        const [k, v] = p.split('=');
        return [decodeURIComponent(k), decodeURIComponent(v || '').replace(/\+/g, ' ')];
      })
    );
    const sortedParams = Object.keys(params).sort()
      .map(k => `${k}${params[k]}`).join('');
    const expected = crypto
      .createHmac('sha1', this.config.authToken)
      .update(url + sortedParams)
      .digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch { return false; }
  }

  // ─── DM policy ─────────────────────────────────────────────────────────────

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
        await this.sendMessage(from, '🦅 HyperClaw: Paired! You can now send messages.');
        this.emit('pairing:approved', { userId: from, channelId: 'sms' });
        return true;
      }
      const code = this.generateCode();
      this.config.pendingPairings[code] = from;
      await this.saveState();
      await this.sendMessage(from,
        `🦅 HyperClaw Pairing: send this code to the owner: ${code}\n` +
        `They can approve with: hyperclaw pairing approve sms ${code}`
      );
      return false;
    }
    return false;
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  async sendMessage(to: string, text: string): Promise<void> {
    // SMS max 160 chars per segment, Twilio auto-splits
    await twilioRequest(
      this.config.accountSid,
      this.config.authToken,
      'POST',
      '/Messages',
      { From: this.config.fromNumber, To: to, Body: text.slice(0, 1600) }
    );
  }

  // Check delivery status
  async getStatus(messageSid: string): Promise<string> {
    const r = await twilioRequest(this.config.accountSid, this.config.authToken, 'GET', `/Messages/${messageSid}`);
    return r.status; // queued, sent, delivered, failed
  }

  // ─── Outbound: send to a list of numbers ─────────────────────────────────

  async broadcast(numbers: string[], text: string): Promise<void> {
    for (const num of numbers) {
      await this.sendMessage(num, text).catch(e =>
        console.log(chalk.yellow(`  ⚠  SMS broadcast failed to ${num}: ${e.message}`))
      );
    }
  }

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

  addToAllowlist(number: string): void {
    if (!this.config.allowFrom.includes(number)) { this.config.allowFrom.push(number); this.saveState(); }
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      if (s.pendingPairings) this.config.pendingPairings = s.pendingPairings;
      if (s.approvedPairings) this.config.approvedPairings = s.approvedPairings;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      pendingPairings: this.config.pendingPairings,
      approvedPairings: this.config.approvedPairings
    }, { spaces: 2 });
  }

  isRunning() { return this.running; }
}
