/**
 * extensions/twitter/src/connector.ts
 * REAL Twitter/X DM connector — X API v2 + OAuth 1.0a + CRC webhook.
 * User provides: apiKey, apiSecret, accessToken, accessTokenSecret
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'twitter-state.json');

export interface TwitterConfig {
  bearerToken: string;
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function oauthSign(method: string, url: string, config: TwitterConfig): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts = Math.floor(Date.now() / 1000).toString();
  const op: Record<string, string> = {
    oauth_consumer_key: config.apiKey, oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts,
    oauth_token: config.accessToken, oauth_version: '1.0'
  };
  const sorted = Object.keys(op).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(op[k])}`).join('&');
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const key = `${encodeURIComponent(config.apiSecret)}&${encodeURIComponent(config.accessTokenSecret)}`;
  op.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(op).sort().map(k => `${encodeURIComponent(k)}="${encodeURIComponent(op[k])}"`).join(', ');
}

function xReq(method: string, url: string, body: object | null, auth: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { 'Authorization': auth, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class TwitterConnector extends EventEmitter {
  config: TwitterConfig;
  private running = false;
  private myUserId = '';

  constructor(config: Partial<TwitterConfig> & { bearerToken: string; apiKey: string; apiSecret: string; accessToken: string; accessTokenSecret: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as TwitterConfig;
  }

  async connect(): Promise<void> {
    const url = 'https://api.twitter.com/2/users/me';
    const me = await xReq('GET', url, null, oauthSign('GET', url, this.config));
    this.myUserId = me.data?.id || '';
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Twitter/X: @${me.data?.username} connected`));
    this.emit('connected', { userId: me.data?.id, username: me.data?.username });
  }

  disconnect(): void { this.running = false; }

  handleCRC(crcToken: string): string {
    const hash = crypto.createHmac('sha256', this.config.apiSecret).update(crcToken).digest('base64');
    return JSON.stringify({ response_token: `sha256=${hash}` });
  }

  async handleWebhook(body: string): Promise<void> {
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }
    for (const event of (payload.direct_message_events || [])) {
      if (event.type !== 'message_create') continue;
      const senderId = event.message_create?.sender_id;
      if (senderId === this.myUserId) continue;
      const text = event.message_create?.message_data?.text;
      if (!text) continue;
      const allowed = await this.checkDMPolicy(senderId, text);
      if (!allowed) continue;
      this.emit('message', { id: event.id, channelId: 'twitter', from: senderId, chatId: senderId, text, timestamp: new Date(parseInt(event.created_timestamp)).toISOString(), isDM: true });
    }
  }

  private async checkDMPolicy(from: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.sendDM(from, '🦅 HyperClaw: Not on allowlist.');
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from); delete this.config.pendingPairings[upper];
        await this.saveState(); await this.sendDM(from, '🦅 Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'twitter' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendDM(from, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve twitter ${code}`);
      return false;
    }
    return false;
  }

  async sendDM(recipientId: string, text: string): Promise<void> {
    const url = `https://api.twitter.com/2/dm_conversations/with/${recipientId}/messages`;
    await xReq('POST', url, { text: text.slice(0, 10000) }, oauthSign('POST', url, this.config));
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
