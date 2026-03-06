/**
 * extensions/synology-chat/src/connector.ts
 * Synology Chat connector — incoming webhook + outgoing webhook.
 * Synology Chat uses a simple HTTP webhook model:
 *   Incoming: POST to Synology Chat webhook URL to send a message.
 *   Outgoing: Synology Chat POSTs to your server when a user sends a message.
 */

import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'synology-chat-state.json');

export interface SynologyChatConfig {
  /** Incoming webhook URL from Synology Chat — used to POST messages into the chat */
  incomingWebhookUrl: string;
  /** Port to listen on for outgoing webhooks from Synology Chat */
  webhookPort?: number;
  /** Path for the outgoing webhook endpoint */
  webhookPath?: string;
  /** Optional HMAC token for verifying requests from Synology Chat */
  webhookToken?: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function httpsPost(url: string, body: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = (mod as any).request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(encoded)
      }
    }, (res: any) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(encoded);
    req.end();
  });
}

export class SynologyChatConnector extends EventEmitter {
  config: SynologyChatConfig;
  private server: http.Server | null = null;
  private running = false;

  constructor(config: Partial<SynologyChatConfig> & { incomingWebhookUrl: string }) {
    super();
    this.config = {
      webhookPort: 7789,
      webhookPath: '/synology-hook',
      dmPolicy: 'pairing',
      allowFrom: [],
      approvedPairings: [],
      pendingPairings: {},
      ...config
    } as SynologyChatConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    await this.startWebhookServer();
    this.running = true;
    console.log(chalk.green(`  🦅 Synology Chat: webhook listening on :${this.config.webhookPort}${this.config.webhookPath}`));
    this.emit('connected', { webhookPort: this.config.webhookPort });
  }

  disconnect(): void {
    this.running = false;
    this.server?.close();
    this.server = null;
  }

  private startWebhookServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== this.config.webhookPath) {
          res.writeHead(404).end();
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => body += c);
        req.on('end', async () => {
          try {
            // Synology Chat sends application/x-www-form-urlencoded
            const params = new URLSearchParams(body);
            const token = params.get('token');
            const text = params.get('text') || '';
            const userId = params.get('user_id') || 'unknown';
            const username = params.get('username') || userId;
            const channelId = params.get('channel_id') || 'unknown';
            const channelName = params.get('channel_name') || channelId;

            // Token verification
            if (this.config.webhookToken && token !== this.config.webhookToken) {
              res.writeHead(403).end('Forbidden');
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');

            if (!text || !userId) return;

            const allowed = await this.checkPolicy(userId, username, channelId, text);
            if (!allowed) return;

            this.emit('message', {
              id: `syno-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              channelId: 'synology-chat',
              from: username,
              chatId: channelId,
              chatName: channelName,
              text,
              timestamp: new Date().toISOString(),
              isDM: false
            });
          } catch (e: any) {
            console.log(chalk.yellow(`  ⚠  Synology Chat: ${e.message}`));
            res.writeHead(500).end();
          }
        });
      });

      this.server.listen(this.config.webhookPort, () => resolve());
      this.server.on('error', reject);
    });
  }

  private async checkPolicy(userId: string, username: string, channelId: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;

    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(userId) || this.config.allowFrom.includes(username)) return true;
      await this.sendMessage(channelId, '🦅 You are not on the allowlist.');
      return false;
    }

    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(userId)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(userId);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(channelId, '🦅 Paired! You can now send messages to the assistant.');
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = userId;
      await this.saveState();
      await this.sendMessage(channelId, `🦅 Pairing required. Your code: \`${code}\`\nApprove: hyperclaw pairing approve synology-chat ${code}`);
      return false;
    }

    return false;
  }

  async sendMessage(channelId: string, text: string): Promise<void> {
    try {
      await httpsPost(this.config.incomingWebhookUrl, { text });
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠  Synology Chat send error: ${e.message}`));
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
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      p: this.config.pendingPairings,
      a: this.config.approvedPairings
    }, { spaces: 2 });
  }

  isRunning(): boolean { return this.running; }
}
