/**
 * extensions/feishu/src/connector.ts
 * REAL Feishu (Lark) connector — Feishu Open Platform webhook + Bot API.
 * User provides: appId, appSecret (from open.feishu.cn)
 * Setup: open.feishu.cn → Create App → Add bot → Event subscriptions
 *        Webhook: /webhook/feishu, subscribe to: im.message.receive_v1
 */
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'feishu-state.json');

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;  // for encrypted webhooks (optional)
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

let feishuToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  if (feishuToken && feishuToken.expiresAt > Date.now() + 60000) return feishuToken.token;
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ app_id: appId, app_secret: appSecret });
    const req = https.request({
      hostname: 'open.feishu.cn', port: 443,
      path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          feishuToken = { token: r.tenant_access_token, expiresAt: Date.now() + (r.expire * 1000) };
          resolve(r.tenant_access_token);
        } catch { reject(new Error('Token error')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function feishuReq(token: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'open.feishu.cn', port: 443, path: `/open-apis${endpoint}`, method,
      headers: { 'Authorization': `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { const r = JSON.parse(data); if (r.code !== 0) reject(new Error(r.msg)); else resolve(r); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class FeishuConnector extends EventEmitter {
  config: FeishuConfig;
  private running = false;
  private botOpenId = '';

  constructor(config: Partial<FeishuConfig> & { appId: string; appSecret: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as FeishuConfig;
  }

  async connect(): Promise<void> {
    const token = await getAccessToken(this.config.appId, this.config.appSecret);
    const botInfo = await feishuReq(token, 'GET', '/bot/v3/info');
    this.botOpenId = botInfo.bot?.open_id || '';
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Feishu: ${botInfo.bot?.app_name || this.config.appId} connected`));
    this.emit('connected', { openId: this.botOpenId });
  }

  disconnect(): void { this.running = false; }

  // Webhook URL verification (GET with challenge)
  handleChallenge(body: string): string | null {
    try {
      const r = JSON.parse(body);
      if (r.type === 'url_verification') return JSON.stringify({ challenge: r.challenge });
    } catch {}
    return null;
  }

  async handleWebhook(body: string): Promise<void> {
    let payload: any;
    try { payload = JSON.parse(body); } catch { return; }

    const event = payload.event;
    if (!event || payload.header?.event_type !== 'im.message.receive_v1') return;

    const senderId = event.sender?.sender_id?.open_id;
    const msgType = event.message?.message_type;
    if (msgType !== 'text' || !senderId) return;

    let text = '';
    try { text = JSON.parse(event.message.content).text; } catch { return; }
    if (!text) return;

    const chatId = event.message?.chat_id || senderId;
    const allowed = await this.checkDMPolicy(senderId, text, chatId);
    if (!allowed) return;

    this.emit('message', {
      id: event.message?.message_id, channelId: 'feishu', from: senderId,
      chatId, text, timestamp: new Date().toISOString(), isDM: true
    });
  }

  private async checkDMPolicy(from: string, text: string, chatId: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.sendMessage(chatId, '🦅 HyperClaw: Not on allowlist.'); return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from); delete this.config.pendingPairings[upper];
        await this.saveState(); await this.sendMessage(chatId, '🦅 Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'feishu' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendMessage(chatId, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve feishu ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const token = await getAccessToken(this.config.appId, this.config.appSecret);
    await feishuReq(token, 'POST', '/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId, msg_type: 'text',
      content: JSON.stringify({ text: text.slice(0, 4000) })
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
