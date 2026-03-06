/**
 * extensions/mattermost/src/connector.ts
 * Mattermost connector — Outgoing Webhook + REST API.
 *
 * Setup:
 * 1. Product menu > Integrations > Outgoing Webhook
 * 2. Add Outgoing Webhook: trigger words (e.g. @hyperclaw or !hyperclaw)
 * 3. Callback URL: https://your-server/webhook/mattermost
 * 4. Copy the Token, add to config as webhookToken
 * 5. Create Personal Access Token or Bot Account for posting: Account Settings > Security > Personal Access Tokens
 * 6. serverUrl: https://your-mattermost-server.com
 */

import https from 'https';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'mattermost-state.json');

export interface MattermostConfig {
  serverUrl: string;        // https://mattermost.example.com
  token: string;            // Personal Access Token or Bot token (for posting)
  webhookToken: string;     // From Outgoing Webhook config (verification)
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];      // Mattermost user IDs
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function mattermostApi(serverUrl: string, token: string, method: string, path: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const base = serverUrl.startsWith('https') ? serverUrl : `https://${serverUrl.replace(/^https?:\/\//, '')}`;
    const url = new URL(path.startsWith('/') ? path : '/' + path, base);
    const payload = body ? JSON.stringify(body) : null;
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
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
          const r = data ? JSON.parse(data) : {};
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          if (ok) resolve(r);
          else reject(new Error(r.message || r.error || `HTTP ${res.statusCode}`));
        } catch (e: any) { reject(e || new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class MattermostConnector extends EventEmitter {
  config: MattermostConfig;
  private running = false;

  constructor(config: Partial<MattermostConfig> & { serverUrl: string; token: string; webhookToken: string }) {
    super();
    this.config = {
      dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {},
      ...config
    } as MattermostConfig;
  }

  async connect(): Promise<void> {
    const base = this.config.serverUrl.replace(/\/$/, '');
    await mattermostApi(base, this.config.token, 'GET', '/api/v4/users/me');
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Mattermost: connected to ${base}`));
    this.emit('connected', { serverUrl: base });
  }

  disconnect(): void { this.running = false; }

  /** Parse outgoing webhook payload (form-urlencoded or JSON) */
  async handleWebhook(body: string, _opts?: { contentType?: string }): Promise<void> {
    let params: Record<string, string>;
    const trimmed = (body || '').trim();
    if (trimmed.startsWith('{')) {
      try { params = JSON.parse(trimmed) as Record<string, string>; } catch { return; }
    } else {
      params = {};
      for (const pair of body.split('&')) {
        const eq = pair.indexOf('=');
        const k = eq >= 0 ? decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' ')) : decodeURIComponent(pair.replace(/\+/g, ' '));
        const v = eq >= 0 ? decodeURIComponent((pair.slice(eq + 1) || '').replace(/\+/g, ' ')) : '';
        if (k) params[k] = v;
      }
    }

    const token = params.token;
    if (token !== this.config.webhookToken) {
      console.log(chalk.yellow('  ⚠  Mattermost: invalid webhook token'));
      return;
    }

    const channelId = params.channel_id;
    const userId = params.user_id;
    const userName = params.user_name || '';
    let text = (params.text || '').trim();
    const triggerWord = params.trigger_word || '';
    if (triggerWord && text.startsWith(triggerWord)) text = text.slice(triggerWord.length).trim();
    if (!channelId || !userId || !text) return;

    const allowed = await this.checkDMPolicy(userId, text, channelId);
    if (!allowed) return;

    this.emit('message', {
      id: params.post_id || `${channelId}-${Date.now()}`,
      channelId: 'mattermost',
      from: userId,
      chatId: channelId,
      text,
      timestamp: params.timestamp ? new Date(parseInt(params.timestamp) * 1000).toISOString() : new Date().toISOString(),
      isDM: false,
      userName
    });
  }

  private async checkDMPolicy(userId: string, text: string, channelId: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(userId)) return true;
      await this.sendMessage(channelId, '🦅 HyperClaw: Not on allowlist.');
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(userId)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(userId);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(channelId, '🦅 Paired!');
        this.emit('pairing:approved', { userId, channelId: 'mattermost' });
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = userId;
      await this.saveState();
      await this.sendMessage(channelId, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve mattermost ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(channelId: string, text: string): Promise<void> {
    const base = this.config.serverUrl.replace(/\/$/, '');
    const chunks = text.match(/.{1,4000}/gs) || [text];
    for (const chunk of chunks) {
      await mattermostApi(base, this.config.token, 'POST', '/api/v4/posts', {
        channel_id: channelId,
        message: chunk.slice(0, 16383)
      });
    }
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

  isRunning(): boolean { return this.running; }
}
