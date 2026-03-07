/**
 * extensions/zalo/src/connector.ts
 * Zalo Bot API connector — bot.zaloplatforms.com
 *
 * Status: experimental. DMs supported; groups with policy controls.
 *
 * Auth: botToken (format: 12345689:abc-xyz) from bot.zaloplatforms.com.
 * Inbound: long-polling by default; webhook mode when webhookUrl is set.
 * Outbound: send text (2000-char limit) + images.
 *
 * Pairing codes expire after 1 hour.
 * getUpdates (polling) and webhook are mutually exclusive per Zalo API.
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_BASE = path.join(os.homedir(), '.hyperclaw');
const BOT_API_HOST = 'bot.zaloplatforms.com';
const BOT_API_BASE = '/v3';
const TEXT_CHUNK = 2000;
const DEFAULT_MEDIA_MB = 5;
const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEDUP_TTL_MS = 60_000;            // 1 minute replay window

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZaloBotAccountConfig {
  name?: string;
  enabled?: boolean;
  botToken?: string;
  tokenFile?: string;
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  allowFrom?: string[];
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom?: string[];
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  proxy?: string;
}

export interface ZaloBotConfig extends ZaloBotAccountConfig {
  botToken?: string;
  mediaMaxMb?: number;
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  pendingPairingTs?: Record<string, number>;
  accounts?: Record<string, ZaloBotAccountConfig>;
}

// ─── Zalo Bot API helper ───────────────────────────────────────────────────────

function zaloApi(token: string, method: string, apiPath: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const qs = method === 'GET' && !body ? '' : '';
    const req = https.request(
      {
        hostname: BOT_API_HOST,
        port: 443,
        path: `${BOT_API_BASE}${apiPath}${qs}`,
        method,
        headers: {
          Authorization: `Bot ${token}`,
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c));
        res.on('end', () => {
          try {
            const r = JSON.parse(data);
            if (r.error && r.error !== 0) reject(new Error(r.message || `Zalo error ${r.error}`));
            else resolve(r);
          } catch {
            reject(new Error('Zalo: invalid JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(35000, () => { req.destroy(); reject(new Error('Zalo API timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function zaloApiQuery(token: string, apiPath: string, params: Record<string, string | number>): Promise<any> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
    const req = https.request(
      {
        hostname: BOT_API_HOST,
        port: 443,
        path: `${BOT_API_BASE}${apiPath}?${qs}`,
        method: 'GET',
        headers: {
          Authorization: `Bot ${token}`,
          Accept: 'application/json'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c));
        res.on('end', () => {
          try {
            const r = JSON.parse(data);
            if (r.error && r.error !== 0) reject(new Error(r.message || `Zalo error ${r.error}`));
            else resolve(r);
          } catch {
            reject(new Error('Zalo: invalid JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(); reject(new Error('Zalo poll timeout')); });
    req.end();
  });
}

// ─── Single-account runner ─────────────────────────────────────────────────────

class ZaloAccount extends EventEmitter {
  private cfg: ZaloBotConfig;
  readonly accountId: string;
  private token = '';
  private running = false;
  private offset = 0;
  private mediaMaxMb: number;
  /** Dedup set: "eventName:messageId" → expiry timestamp */
  private dedupMap = new Map<string, number>();

  constructor(accountId: string, cfg: ZaloBotConfig) {
    super();
    this.accountId = accountId;
    this.cfg = {
      dmPolicy: 'pairing',
      allowFrom: [],
      groupPolicy: 'allowlist',
      groupAllowFrom: [],
      mediaMaxMb: DEFAULT_MEDIA_MB,
      pendingPairingTs: {},
      ...cfg
    };
    this.cfg.approvedPairings = this.cfg.approvedPairings ?? [];
    this.cfg.pendingPairings = this.cfg.pendingPairings ?? {};
    this.mediaMaxMb = this.cfg.mediaMaxMb ?? DEFAULT_MEDIA_MB;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  private async resolveToken(): Promise<void> {
    this.token =
      this.cfg.botToken ||
      (this.cfg.tokenFile ? (await fs.readFile(this.cfg.tokenFile, 'utf8')).trim() : '');
    if (!this.token) throw new Error(`Zalo [${this.accountId}]: botToken or tokenFile is required`);
  }

  // ── Connect ───────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.resolveToken();
    await this.loadState();
    this.running = true;

    const useWebhook = !!this.cfg.webhookUrl;

    if (useWebhook) {
      await this.registerWebhook();
      console.log(chalk.green(`  🔵 Zalo [${this.accountId}]: webhook mode — ${this.cfg.webhookUrl}`));
    } else {
      console.log(chalk.green(`  🔵 Zalo [${this.accountId}]: long-polling started`));
      void this.pollLoop();
    }

    this.emit('connected', { accountId: this.accountId, mode: useWebhook ? 'webhook' : 'polling' });
  }

  disconnect(): void {
    this.running = false;
  }

  // ── Webhook registration ──────────────────────────────────────────────────────

  private async registerWebhook(): Promise<void> {
    if (!this.cfg.webhookUrl || !this.cfg.webhookSecret) return;
    try {
      await zaloApi(this.token, 'POST', '/webhook', {
        url: this.cfg.webhookUrl,
        secret_token: this.cfg.webhookSecret
      });
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠  Zalo [${this.accountId}]: webhook registration: ${e.message}`));
    }
  }

  // ── Long-polling ─────────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const resp = await zaloApiQuery(this.token, '/event', {
          timeout: 30,
          offset: this.offset
        });
        const events: any[] = Array.isArray(resp?.updates) ? resp.updates
          : Array.isArray(resp?.result) ? resp.result
          : Array.isArray(resp) ? resp : [];

        for (const event of events) {
          const id = event.update_id ?? event.id;
          if (id != null && id >= this.offset) this.offset = id + 1;
          await this.handleEvent(event);
        }
      } catch (e: any) {
        if (this.running) {
          console.log(chalk.yellow(`  ⚠  Zalo [${this.accountId}] poll: ${e.message}`));
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  // ── Webhook event handler (called by gateway) ──────────────────────────────

  async handleWebhook(rawBody: string, secretHeader: string): Promise<void> {
    if (!this.verifyWebhookSecret(secretHeader)) {
      console.log(chalk.yellow(`  ⚠  Zalo [${this.accountId}]: invalid webhook secret`));
      return;
    }
    let event: any;
    try { event = JSON.parse(rawBody); } catch { return; }
    await this.handleEvent(event);
  }

  verifyWebhookSecret(headerValue: string): boolean {
    if (!this.cfg.webhookSecret) return true;
    return headerValue === this.cfg.webhookSecret;
  }

  // ── Event router ─────────────────────────────────────────────────────────────

  private async handleEvent(event: any): Promise<void> {
    if (!event) return;

    const eventName: string = event.event_name || event.type || '';
    const messageId: string = String(event.message?.msg_id || event.message_id || event.id || '');

    // Deduplicate events (replay window)
    if (messageId) {
      const key = `${eventName}:${messageId}`;
      const now = Date.now();
      if (this.dedupMap.has(key)) return;
      this.dedupMap.set(key, now + DEDUP_TTL_MS);
      // Periodic cleanup
      if (this.dedupMap.size > 1000) {
        for (const [k, exp] of this.dedupMap) if (exp < now) this.dedupMap.delete(k);
      }
    }

    const sender: string = event.sender?.id || event.from?.id || event.user_id || '';
    const groupId: string = event.message?.group_id || event.group_id || '';
    const isGroup = !!groupId;

    let text = '';

    switch (eventName) {
      case 'user_send_text':
      case 'message':
        text = event.message?.text || event.text || '';
        break;
      case 'user_send_image':
      case 'message_image': {
        const url: string = event.message?.attachments?.[0]?.payload?.url || event.image_url || '';
        const size: number = event.message?.attachments?.[0]?.payload?.filesize || 0;
        const maxBytes = this.mediaMaxMb * 1024 * 1024;
        if (size > maxBytes) return;
        text = url ? `[image:${url}]` : '[image]';
        break;
      }
      case 'user_send_sticker':
      case 'message_sticker':
        // Stickers: log but don't process
        return;
      default:
        return;
    }

    if (!text || !sender) return;

    if (isGroup) {
      if (!this.checkGroupPolicy(groupId, sender)) return;
      this.emit('message', {
        channelId: 'zalo', accountId: this.accountId,
        chatId: groupId, from: sender, text, isDM: false
      });
    } else {
      const allowed = await this.checkDMPolicy(sender, text);
      if (!allowed) return;
      this.emit('message', {
        channelId: 'zalo', accountId: this.accountId,
        chatId: sender, from: sender, text, isDM: true
      });
    }
  }

  // ── DM policy ─────────────────────────────────────────────────────────────────

  private async checkDMPolicy(from: string, text: string): Promise<boolean> {
    const policy = this.cfg.dmPolicy ?? 'pairing';
    const allowFrom = this.cfg.allowFrom ?? [];

    this.pruneExpiredCodes();

    switch (policy) {
      case 'disabled': return false;
      case 'open': return true;
      case 'allowlist':
        if (allowFrom.includes(from) || allowFrom.includes('*')) return true;
        await this.sendText(from, 'HyperClaw: Not on allowlist.');
        return false;
      case 'pairing': {
        if (this.cfg.approvedPairings.includes(from)) return true;
        const upper = text.trim().toUpperCase().match(/[A-Z0-9]{6}/)?.[0];
        if (upper && this.cfg.pendingPairings[upper]) {
          this.cfg.approvedPairings.push(from);
          delete this.cfg.pendingPairings[upper];
          delete this.cfg.pendingPairingTs![upper];
          await this.saveState();
          await this.sendText(from, 'Paired!');
          this.emit('pairing:approved', { userId: from, channelId: 'zalo', accountId: this.accountId });
          return true;
        }
        const code = Array.from(
          { length: 6 },
          () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');
        this.cfg.pendingPairings[code] = from;
        this.cfg.pendingPairingTs![code] = Date.now();
        await this.saveState();
        await this.sendText(
          from,
          `Pairing code: ${code}\nApprove: hyperclaw pairing approve zalo ${code}\n(expires in 1 hour)`
        );
        return false;
      }
    }
    return false;
  }

  private pruneExpiredCodes(): void {
    const now = Date.now();
    const ts = this.cfg.pendingPairingTs!;
    for (const code of Object.keys(ts)) {
      if (now - ts[code] > PAIRING_TTL_MS) {
        delete this.cfg.pendingPairings[code];
        delete ts[code];
      }
    }
  }

  // ── Group policy ──────────────────────────────────────────────────────────────

  private checkGroupPolicy(groupId: string, userId: string): boolean {
    const policy = this.cfg.groupPolicy ?? 'allowlist';
    if (policy === 'disabled') return false;
    if (policy === 'open') {
      // Mention-gated; groupAllowFrom if set
      const list = this.cfg.groupAllowFrom ?? this.cfg.allowFrom ?? [];
      return list.length === 0 || list.includes(userId);
    }
    // allowlist — group must be in groupAllowFrom or allowFrom
    const list = this.cfg.groupAllowFrom?.length
      ? this.cfg.groupAllowFrom
      : (this.cfg.allowFrom ?? []);
    return list.includes(groupId) || list.includes(userId);
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  async sendMessage(chatId: string, text: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += TEXT_CHUNK) chunks.push(text.slice(i, i + TEXT_CHUNK));
    for (const chunk of chunks) {
      await this.sendText(chatId, chunk);
    }
  }

  private async sendText(to: string, text: string): Promise<void> {
    await zaloApi(this.token, 'POST', '/message/sendtext', { to, text }).catch((e: any) =>
      console.error(`[zalo:${this.accountId}] sendText: ${e.message}`)
    );
  }

  async sendPhoto(to: string, imageUrl: string, caption?: string): Promise<void> {
    await zaloApi(this.token, 'POST', '/message/sendimage', {
      to,
      image_url: imageUrl,
      ...(caption ? { caption } : {})
    }).catch((e: any) =>
      console.error(`[zalo:${this.accountId}] sendPhoto: ${e.message}`)
    );
  }

  // ── Pairing ───────────────────────────────────────────────────────────────────

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.cfg.pendingPairings[upper]) return false;
    this.cfg.approvedPairings.push(this.cfg.pendingPairings[upper]);
    delete this.cfg.pendingPairings[upper];
    delete this.cfg.pendingPairingTs![upper];
    void this.saveState();
    return true;
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  private stateFile(): string {
    return path.join(STATE_BASE, `zalo-bot-state-${this.accountId}.json`);
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(this.stateFile());
      this.offset = s.offset || 0;
      if (s.p) this.cfg.pendingPairings = s.p;
      if (s.a) this.cfg.approvedPairings = s.a;
      if (s.pts) this.cfg.pendingPairingTs = s.pts;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(STATE_BASE);
    await fs.writeJson(
      this.stateFile(),
      {
        offset: this.offset,
        p: this.cfg.pendingPairings,
        a: this.cfg.approvedPairings,
        pts: this.cfg.pendingPairingTs
      },
      { spaces: 2 }
    );
  }

  isRunning(): boolean { return this.running; }
}

// ─── Public connector (manages 1..N accounts) ─────────────────────────────────

export class ZaloConnector extends EventEmitter {
  private config: ZaloBotConfig;
  private accounts: ZaloAccount[] = [];

  constructor(config: ZaloBotConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const sharedState = {
      approvedPairings: this.config.approvedPairings ?? [],
      pendingPairings: this.config.pendingPairings ?? {},
      pendingPairingTs: this.config.pendingPairingTs ?? {}
    };

    const accountEntries = Object.entries(this.config.accounts || {});

    if (accountEntries.length === 0) {
      const acct = new ZaloAccount('default', { ...this.config, ...sharedState });
      this.wire(acct);
      await acct.connect();
      this.accounts.push(acct);
    } else {
      for (const [id, acctCfg] of accountEntries) {
        if (acctCfg.enabled === false) continue;
        const merged: ZaloBotConfig = {
          ...this.config,
          ...acctCfg,
          mediaMaxMb: this.config.mediaMaxMb,
          ...sharedState
        };
        if (!merged.botToken && !merged.tokenFile) {
          console.error(`[zalo] Account "${id}" has no botToken or tokenFile — skipping`);
          continue;
        }
        const acct = new ZaloAccount(id, merged);
        this.wire(acct);
        try {
          await acct.connect();
          this.accounts.push(acct);
        } catch (e: any) {
          console.error(`[zalo] Account "${id}" failed: ${e.message}`);
        }
      }
    }
  }

  private wire(acct: ZaloAccount): void {
    acct.on('message', (msg) => this.emit('message', msg));
    acct.on('connected', (info) => this.emit('connected', info));
    acct.on('pairing:approved', (info) => this.emit('pairing:approved', info));
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const acct = this.accounts[0];
    if (!acct) throw new Error('Zalo: no connected account');
    await acct.sendMessage(chatId, text);
  }

  /** Called by gateway webhook handler for webhook mode accounts. */
  async handleWebhook(rawBody: string, secretHeader: string): Promise<void> {
    for (const acct of this.accounts) {
      if (acct.verifyWebhookSecret(secretHeader)) {
        await acct.handleWebhook(rawBody, secretHeader);
        return;
      }
    }
  }

  approvePairing(code: string): boolean {
    return this.accounts.some((a) => a.approvePairing(code));
  }

  disconnect(): void {
    for (const a of this.accounts) a.disconnect();
    this.accounts = [];
  }

  isRunning(): boolean {
    return this.accounts.some((a) => a.isRunning());
  }
}
