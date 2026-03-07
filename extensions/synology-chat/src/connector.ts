/**
 * extensions/synology-chat/src/connector.ts
 * Synology Chat connector — inbound outgoing-webhook + outbound incoming-webhook.
 *
 * Architecture:
 *   Inbound:  Synology Chat POSTs to your gateway → gateway calls handleWebhook()
 *   Outbound: connector POSTs to Synology Chat incoming webhook URL
 *
 * The connector does NOT run its own HTTP server. The main gateway routes
 * POST <webhookPath> to handleWebhook().
 *
 * Quick setup:
 *   1. Synology Chat → Integrations → Incoming Webhook → create, copy URL
 *   2. Synology Chat → Integrations → Outgoing Webhook → create, copy token
 *      Outgoing URL: https://<gateway>/webhook/synology  (or custom webhookPath)
 *   3. Configure channels.synology-chat and restart gateway.
 */

import https from 'https';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';

export interface SynologyAccountConfig {
  name?: string;
  /** Outgoing webhook token from Synology Chat (for inbound verification). Env: SYNOLOGY_CHAT_TOKEN */
  token?: string;
  /** Incoming webhook URL for sending messages. Env: SYNOLOGY_CHAT_INCOMING_URL */
  incomingUrl?: string;
  /** Gateway path that receives Synology Chat outgoing webhook POSTs. Default: /webhook/synology */
  webhookPath?: string;
  dmPolicy?: DmPolicy;
  /** Numeric Synology Chat user IDs. Env: SYNOLOGY_ALLOWED_USER_IDS (comma-separated) */
  allowedUserIds?: string[] | string;
  /** Rate limit per sender per minute. Env: SYNOLOGY_RATE_LIMIT */
  rateLimitPerMinute?: number;
  /** Allow self-signed NAS TLS certificates. Default: false */
  allowInsecureSsl?: boolean;
}

export interface SynologyChatConfig extends SynologyAccountConfig {
  /** Multi-account map. */
  accounts?: Record<string, SynologyAccountConfig>;
  /** Internal pairing state — managed by connector */
  approvedPairings?: string[];
  pendingPairings?: Record<string, string>;
}

// Resolved single-account config
interface ResolvedAccount {
  id: string;
  name: string;
  token: string;
  incomingUrl: string;
  webhookPath: string;
  dmPolicy: DmPolicy;
  allowedUserIds: string[];
  rateLimitPerMinute: number;
  allowInsecureSsl: boolean;
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

export interface SynologyMessage {
  accountId: string;
  id: string;
  from: string;
  userId: string;
  chatId: string;
  text: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Env resolution
// ---------------------------------------------------------------------------

function resolveAllowedIds(raw: string[] | string | undefined, envVal: string | undefined): string[] {
  if (Array.isArray(raw) && raw.length) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(s => s.trim()).filter(Boolean);
  if (envVal) return envVal.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function resolveAccount(
  id: string,
  raw: SynologyAccountConfig,
  state: { approved: string[]; pending: Record<string, string> }
): ResolvedAccount {
  const token = raw.token || process.env['SYNOLOGY_CHAT_TOKEN'] || '';
  const incomingUrl = raw.incomingUrl || process.env['SYNOLOGY_CHAT_INCOMING_URL'] || '';
  const allowedUserIds = resolveAllowedIds(raw.allowedUserIds, process.env['SYNOLOGY_ALLOWED_USER_IDS']);
  const rateLimitPerMinute = raw.rateLimitPerMinute
    ?? (process.env['SYNOLOGY_RATE_LIMIT'] ? parseInt(process.env['SYNOLOGY_RATE_LIMIT']!, 10) : 30);

  return {
    id,
    name: raw.name ?? process.env['OPENCLAW_BOT_NAME'] ?? id,
    token,
    incomingUrl,
    webhookPath: raw.webhookPath ?? '/webhook/synology',
    dmPolicy: raw.dmPolicy ?? 'allowlist',
    allowedUserIds,
    rateLimitPerMinute,
    allowInsecureSsl: raw.allowInsecureSsl ?? false,
    approvedPairings: state.approved,
    pendingPairings: state.pending
  };
}

// ---------------------------------------------------------------------------
// Per-sender rate limiter
// ---------------------------------------------------------------------------

class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(private limitPerMinute: number) {}

  allow(senderId: string): boolean {
    if (this.limitPerMinute <= 0) return true;
    const now = Date.now();
    const cutoff = now - 60_000;
    const timestamps = (this.windows.get(senderId) ?? []).filter(t => t > cutoff);
    if (timestamps.length >= this.limitPerMinute) return false;
    timestamps.push(now);
    this.windows.set(senderId, timestamps);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Outbound HTTP POST to Synology incoming webhook
// ---------------------------------------------------------------------------

function postToSynology(incomingUrl: string, text: string, userId?: string, allowInsecureSsl = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(incomingUrl);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;

    // Synology incoming webhook accepts form-urlencoded payload with `payload` key
    // The payload is a JSON string: { text: "...", user_ids: [123456] }
    const payloadObj: Record<string, unknown> = { text };
    if (userId) payloadObj.user_ids = [parseInt(userId, 10)].filter(n => !isNaN(n));
    const encoded = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`;

    const options: http.RequestOptions = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(encoded)
      }
    };

    if (isHttps && allowInsecureSsl) {
      (options as https.RequestOptions).rejectUnauthorized = false;
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(encoded);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// SingleAccountConnector
// ---------------------------------------------------------------------------

const STATE_DIR = path.join(os.homedir(), '.hyperclaw');

class SingleAccountConnector extends EventEmitter {
  acc: ResolvedAccount;
  private rateLimiter: RateLimiter;

  constructor(acc: ResolvedAccount) {
    super();
    this.acc = acc;
    this.rateLimiter = new RateLimiter(acc.rateLimitPerMinute);
  }

  // ---- Startup validation -------------------------------------------------

  validate(): void {
    const { dmPolicy, allowedUserIds, token, incomingUrl } = this.acc;
    if (!token) throw new Error(`Synology Chat[${this.acc.id}]: 'token' is required (set SYNOLOGY_CHAT_TOKEN or config)`);
    if (!incomingUrl) throw new Error(`Synology Chat[${this.acc.id}]: 'incomingUrl' is required`);
    if (dmPolicy === 'allowlist' && allowedUserIds.length === 0) {
      throw new Error(
        `Synology Chat[${this.acc.id}]: dmPolicy="allowlist" requires at least one allowedUserId. ` +
        `Use dmPolicy="open" to allow all senders.`
      );
    }
  }

  // ---- Inbound webhook handler (called by gateway) -----------------------

  async handleWebhook(body: string): Promise<{ status: number; body: string }> {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(body);
    } catch {
      return { status: 400, body: 'Bad Request' };
    }

    // Token verification
    const inboundToken = params.get('token');
    if (inboundToken !== this.acc.token) {
      console.log(chalk.yellow(`  ⚠ Synology Chat[${this.acc.id}]: invalid token`));
      return { status: 403, body: 'Forbidden' };
    }

    const text = (params.get('text') ?? '').trim();
    const userId = params.get('user_id') ?? '';
    const username = params.get('username') ?? userId;
    const channelId = params.get('channel_id') ?? '';
    const timestamp = params.get('timestamp') ?? String(Date.now());

    if (!text || !userId) return { status: 200, body: '{}' };

    // Rate limit
    if (!this.rateLimiter.allow(userId)) {
      console.log(chalk.gray(`  synology-chat[${this.acc.id}]: rate-limited sender ${userId}`));
      return { status: 429, body: 'Too Many Requests' };
    }

    // Respond immediately (Synology expects quick 200)
    const allowed = await this._checkPolicy(userId, channelId, text);
    if (!allowed) return { status: 200, body: '{}' };

    const msg: SynologyMessage = {
      accountId: this.acc.id,
      id: `syno-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      from: username,
      userId,
      chatId: userId, // target for replies = sender's user ID
      text,
      timestamp: new Date().toISOString()
    };
    this.emit('message', msg);
    return { status: 200, body: '{}' };
  }

  // ---- DM policy ----------------------------------------------------------

  private async _checkPolicy(userId: string, channelId: string, text: string): Promise<boolean> {
    const acc = this.acc;
    if (acc.dmPolicy === 'disabled') return false;
    if (acc.dmPolicy === 'open') return true;

    if (acc.dmPolicy === 'allowlist') {
      if (acc.allowedUserIds.includes(userId)) return true;
      console.log(chalk.gray(`  synology-chat[${acc.id}]: drop sender ${userId} (dmPolicy=allowlist)`));
      return false;
    }

    if (acc.dmPolicy === 'pairing') {
      if (acc.approvedPairings.includes(userId)) return true;

      const upper = text.trim().toUpperCase();
      if (acc.pendingPairings[upper] === userId) {
        acc.approvedPairings.push(userId);
        delete acc.pendingPairings[upper];
        await this._saveState();
        await this.sendMessage(userId, '🦅 Paired! You can now send messages to the assistant.');
        this.emit('pairing:approved', { accountId: acc.id, userId });
        return true;
      }

      const code = Array.from({ length: 6 }, () =>
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
      ).join('');
      acc.pendingPairings[code] = userId;
      await this._saveState();
      await this.sendMessage(
        userId,
        `🦅 Pairing required. Your code: \`${code}\`\nApprove: hyperclaw pairing approve synology-chat ${code}`
      );
      return false;
    }

    return false;
  }

  // ---- Send ---------------------------------------------------------------

  async sendMessage(userId: string, text: string): Promise<void> {
    try {
      await postToSynology(this.acc.incomingUrl, text, userId, this.acc.allowInsecureSsl);
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠ Synology Chat[${this.acc.id}] send error: ${e.message}`));
    }
  }

  /** Resolve outbound target. Accepts: numeric ID, "synology-chat:<id>", "user:<id>" */
  resolveTarget(target: string): string {
    if (target.startsWith('synology-chat:')) return target.slice(14);
    if (target.startsWith('user:')) return target.slice(5);
    return target; // bare numeric ID
  }

  // ---- Pairing management -------------------------------------------------

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.acc.pendingPairings[upper]) return false;
    this.acc.approvedPairings.push(this.acc.pendingPairings[upper]);
    delete this.acc.pendingPairings[upper];
    this._saveState();
    return true;
  }

  listPendingPairings(): Record<string, string> {
    return { ...this.acc.pendingPairings };
  }

  // ---- State persistence --------------------------------------------------

  private _stateFile(): string {
    return path.join(STATE_DIR, `synology-chat-state-${this.acc.id}.json`);
  }

  async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(this._stateFile());
      if (Array.isArray(s.approvedPairings)) this.acc.approvedPairings = s.approvedPairings;
      if (s.pendingPairings && typeof s.pendingPairings === 'object') this.acc.pendingPairings = s.pendingPairings;
    } catch {}
  }

  private async _saveState(): Promise<void> {
    await fs.ensureDir(STATE_DIR);
    await fs.writeJson(this._stateFile(), {
      approvedPairings: this.acc.approvedPairings,
      pendingPairings: this.acc.pendingPairings
    }, { spaces: 2 });
  }
}

// ---------------------------------------------------------------------------
// SynologyChatConnector — public facade (single or multi-account)
// ---------------------------------------------------------------------------

export class SynologyChatConnector extends EventEmitter {
  private accounts: Map<string, SingleAccountConnector> = new Map();
  /** webhookPath → accountId index for fast routing */
  private pathIndex: Map<string, string> = new Map();
  private rawConfig: SynologyChatConfig;

  constructor(config: SynologyChatConfig) {
    super();
    this.rawConfig = config;
  }

  async connect(): Promise<void> {
    const cfg = this.rawConfig;
    const accountDefs: Record<string, SynologyAccountConfig> = cfg.accounts ?? { default: cfg };

    for (const [id, rawAcc] of Object.entries(accountDefs)) {
      const merged: SynologyAccountConfig = { ...cfg, ...rawAcc };
      const state = {
        approved: cfg.approvedPairings ?? [],
        pending: cfg.pendingPairings ?? {}
      };
      const acc = resolveAccount(id, merged, state);
      const conn = new SingleAccountConnector(acc);

      try {
        conn.validate();
      } catch (e: any) {
        console.log(chalk.red(`  ✗ ${e.message} — account skipped`));
        continue;
      }

      await conn.loadState();
      conn.on('message', (msg: SynologyMessage) => this.emit('message', msg));
      conn.on('pairing:approved', (info: any) => this.emit('pairing:approved', info));

      this.accounts.set(id, conn);
      this.pathIndex.set(acc.webhookPath, id);
      console.log(chalk.green(`  🦅 Synology Chat[${id}]: ready — inbound path ${acc.webhookPath}`));
    }

    this.emit('connected', { accountIds: Array.from(this.accounts.keys()) });
  }

  disconnect(): void {
    this.accounts.clear();
    this.pathIndex.clear();
  }

  // ---- Gateway webhook entry point ----------------------------------------

  /** Called by the gateway's HTTP server for inbound POST requests. */
  async handleWebhook(requestPath: string, body: string): Promise<{ status: number; body: string }> {
    const accountId = this.pathIndex.get(requestPath);
    if (!accountId) return { status: 404, body: 'Not Found' };
    return this._acc(accountId).handleWebhook(body);
  }

  /** Returns all registered webhook paths (for gateway route registration). */
  getWebhookPaths(): string[] {
    return Array.from(this.pathIndex.keys());
  }

  // ---- Delegate -----------------------------------------------------------

  private _acc(accountId = 'default'): SingleAccountConnector {
    const conn = this.accounts.get(accountId);
    if (!conn) throw new Error(`Synology Chat: account '${accountId}' not found`);
    return conn;
  }

  async sendMessage(userId: string, text: string, accountId?: string): Promise<void> {
    const conn = this._acc(accountId);
    const resolved = conn.resolveTarget(userId);
    return conn.sendMessage(resolved, text);
  }

  resolveTarget(target: string, accountId?: string): string {
    return this._acc(accountId).resolveTarget(target);
  }

  approvePairing(code: string, accountId?: string): boolean {
    return this._acc(accountId).approvePairing(code);
  }

  listPendingPairings(accountId?: string): Record<string, string> {
    return this._acc(accountId).listPendingPairings();
  }

  getAccountIds(): string[] {
    return Array.from(this.accounts.keys());
  }

  isRunning(): boolean {
    return this.accounts.size > 0;
  }
}
