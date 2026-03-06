/**
 * extensions/msteams/src/connector.ts
 * REAL Microsoft Teams connector — Bot Framework webhook.
 * User provides: appId, appPassword (from Azure Bot registration)
 * Setup: portal.azure.com → Bot Services → New Bot → Teams channel
 *        Webhook URL: /webhook/msteams
 */
import https from 'https';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'msteams-state.json');

export interface MSTeamsConfig {
  appId: string;
  appPassword: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

interface BotToken { token: string; expiresAt: number; }

let cachedToken: BotToken | null = null;

async function getBotToken(appId: string, appPassword: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;
  return new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appPassword)}&scope=https%3A%2F%2Fapi.botframework.com%2F.default`;
    const req = https.request({
      hostname: 'login.microsoftonline.com', port: 443,
      path: '/botframework.com/oauth2/v2.0/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          cachedToken = { token: r.access_token, expiresAt: Date.now() + (r.expires_in * 1000) };
          resolve(r.access_token);
        } catch { reject(new Error('Token parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendActivity(token: string, serviceUrl: string, conversationId: string, activity: object): Promise<void> {
  const url = new URL(`${serviceUrl}v3/conversations/${conversationId}/activities`);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(activity);
    const req = https.request({
      hostname: url.hostname, port: 443,
      path: url.pathname, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export class MSTeamsConnector extends EventEmitter {
  config: MSTeamsConfig;
  private running = false;

  constructor(config: Partial<MSTeamsConfig> & { appId: string; appPassword: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, ...config } as MSTeamsConfig;
  }

  async connect(): Promise<void> {
    await getBotToken(this.config.appId, this.config.appPassword);
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 MS Teams: Bot ${this.config.appId} connected`));
    this.emit('connected', { appId: this.config.appId });
  }

  disconnect(): void { this.running = false; }

  async handleWebhook(body: string): Promise<void> {
    let activity: any;
    try { activity = JSON.parse(body); } catch { return; }
    if (activity.type !== 'message') return;

    const from = activity.from?.aadObjectId || activity.from?.id;
    const text = activity.text?.replace(/<at>[^<]+<\/at>/g, '').trim();
    const serviceUrl = activity.serviceUrl;
    const conversationId = activity.conversation?.id;
    if (!from || !text || !serviceUrl || !conversationId) return;

    const allowed = await this.checkDMPolicy(from, text, serviceUrl, conversationId, activity);
    if (!allowed) return;

    this.emit('message', {
      id: activity.id, channelId: 'msteams', from, chatId: conversationId,
      fromName: activity.from?.name, text,
      timestamp: activity.timestamp || new Date().toISOString(),
      isDM: activity.conversation?.conversationType === 'personal',
      serviceUrl, activity
    });
  }

  private async checkDMPolicy(from: string, text: string, serviceUrl: string, convId: string, activity: any): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.reply(serviceUrl, convId, activity, '🦅 HyperClaw: Not on allowlist.'); return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from); delete this.config.pendingPairings[upper];
        await this.saveState(); await this.reply(serviceUrl, convId, activity, '🦅 Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'msteams' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.reply(serviceUrl, convId, activity, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve msteams ${code}`);
      return false;
    }
    return false;
  }

  async reply(serviceUrl: string, conversationId: string, originalActivity: any, text: string): Promise<void> {
    const token = await getBotToken(this.config.appId, this.config.appPassword);
    await sendActivity(token, serviceUrl, conversationId, {
      type: 'message', text: text.slice(0, 4000),
      replyToId: originalActivity.id,
      from: { id: this.config.appId },
      conversation: originalActivity.conversation,
      recipient: originalActivity.from
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
