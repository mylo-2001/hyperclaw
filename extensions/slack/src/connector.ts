/**
 * extensions/slack/src/connector.ts
 * REAL Slack connector — Slack Web API + Events API (HTTP mode).
 * No SDK. Handles: DMs, channel messages, slash commands, pairing.
 *
 * Setup:
 * 1. Create app at api.slack.com/apps
 * 2. Enable "Event Subscriptions" → Request URL: http://your-server/webhook/slack
 * 3. Subscribe to: message.im, message.channels, app_mention
 * 4. Add OAuth scopes: chat:write, im:read, im:write, channels:read, channels:history
 * 5. Install to workspace → copy Bot Token (xoxb-...)
 */

import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'slack-state.json');

// ─── Slack API helper ─────────────────────────────────────────────────────────

function slackApi(token: string, method: string, body: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'slack.com',
      port: 443,
      path: `/api/${method}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (!r.ok) reject(new Error(r.error || 'Slack API error'));
          else resolve(r);
        } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export interface SlackConfig {
  botToken: string;            // xoxb-...
  signingSecret: string;       // for webhook signature verification
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];         // Slack user IDs
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  appMentionOnly: boolean;     // only respond to @mentions in channels
}

export interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
}

export class SlackConnector extends EventEmitter {
  config: SlackConfig;
  botUserId = '';
  teamName = '';

  constructor(config: Partial<SlackConfig> & { botToken: string; signingSecret: string }) {
    super();
    this.config = {
      dmPolicy: 'allowlist', allowFrom: [], approvedPairings: {},
      pendingPairings: {}, appMentionOnly: false, ...config
    } as SlackConfig;
  }

  async connect(): Promise<void> {
    const auth = await slackApi(this.config.botToken, 'auth.test');
    this.botUserId = auth.user_id;
    this.teamName = auth.team;
    await this.loadState();
    console.log(chalk.green(`  🦅 Slack: @${auth.user} in ${auth.team} connected`));
    this.emit('connected', { userId: auth.user_id, team: auth.team });
  }

  // ─── Webhook handler (called by gateway server on POST /webhook/slack) ─────

  async handleWebhook(body: string, signature: string, timestamp: string): Promise<string | null> {
    // Verify signature
    if (!this.verifySignature(body, signature, timestamp)) {
      console.log(chalk.yellow('  ⚠  Slack: invalid signature'));
      return null;
    }

    const payload = JSON.parse(body);

    // URL verification challenge
    if (payload.type === 'url_verification') {
      return payload.challenge;
    }

    if (payload.type === 'event_callback') {
      await this.handleEvent(payload.event);
    }

    return null;
  }

  verifySignature(body: string, signature: string, timestamp: string): boolean {
    // Reject old timestamps (replay attack)
    const ts = parseInt(timestamp);
    if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const baseString = `v0:${timestamp}:${body}`;
    const hash = 'v0=' + crypto.createHmac('sha256', this.config.signingSecret)
      .update(baseString).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } catch { return false; }
  }

  private async handleEvent(event: SlackEvent): Promise<void> {
    // Ignore bot messages
    if (event.bot_id || event.user === this.botUserId) return;
    if (!event.text || !event.user || !event.channel) return;

    const isDM = event.channel_type === 'im';
    const isAppMention = event.type === 'app_mention';

    // In channels, only respond to mentions (if configured)
    if (!isDM && this.config.appMentionOnly && !isAppMention) return;
    if (!isDM && !isAppMention && event.type !== 'message') return;

    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim(); // strip @mentions

    if (isDM) {
      const allowed = await this.checkDMPolicy(event.user, event.channel, text);
      if (!allowed) return;
    }

    this.emit('message', {
      id: event.ts,
      channelId: 'slack',
      from: event.user,
      chatId: event.channel,
      text,
      timestamp: new Date(parseFloat(event.ts || '0') * 1000).toISOString(),
      isDM,
      threadTs: event.thread_ts
    });
  }

  // ─── DM Policy ─────────────────────────────────────────────────────────────

  private async checkDMPolicy(userId: string, channelId: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;

    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(userId)) return true;
      await this.sendMessage(channelId, '🦅 *HyperClaw*\n\nYou are not on the allowlist.');
      return false;
    }

    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(userId)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(userId);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(channelId, '🦅 *Paired!* You can now send messages.');
        this.emit('pairing:approved', { userId, channelId: 'slack' });
        return true;
      }
      const code = this.generateCode();
      this.config.pendingPairings[code] = userId;
      await this.saveState();
      await this.sendMessage(channelId,
        `🦅 *HyperClaw Pairing*\n\nSend the owner this code: \`${code}\`\n\nApprove with: \`hyperclaw pairing approve slack ${code}\``
      );
      return false;
    }
    return false;
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  async sendMessage(channel: string, text: string, threadTs?: string): Promise<void> {
    // Slack max message length is 3001 chars
    const chunks = text.match(/.{1,3000}/gs) || [text];
    for (const chunk of chunks) {
      await slackApi(this.config.botToken, 'chat.postMessage', {
        channel, text: chunk,
        mrkdwn: true,
        ...(threadTs ? { thread_ts: threadTs } : {})
      });
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    // Slack doesn't have a typing indicator for bots, but we can set status
    // In socket mode this works — in HTTP mode we skip
  }

  async openDM(userId: string): Promise<string> {
    const r = await slackApi(this.config.botToken, 'conversations.open', { users: userId });
    return r.channel.id;
  }

  async sendDM(userId: string, text: string): Promise<void> {
    const channelId = await this.openDM(userId);
    await this.sendMessage(channelId, text);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

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

  addToAllowlist(userId: string): void {
    if (!this.config.allowFrom.includes(userId)) { this.config.allowFrom.push(userId); this.saveState(); }
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
}
