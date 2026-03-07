/**
 * extensions/signal/src/connector.ts
 * Signal connector — signal-cli HTTP JSON-RPC + SSE event stream.
 *
 * Features:
 *   - Auto-spawn signal-cli daemon or connect to external daemon (httpUrl)
 *   - SSE real-time events (replaces polling)
 *   - DM + group routing with groupPolicy / groupAllowFrom
 *   - UUID sender support (uuid:<id>)
 *   - Typing indicators + read receipts
 *   - Reactions (DMs + groups with targetAuthor)
 *   - Text chunking (textChunkLimit + chunkMode=newline)
 *   - Media cap (mediaMaxMb)
 *   - Pairing with code expiry (1h)
 *   - Multi-account support
 *
 * Setup paths:
 *   A) Link existing account: signal-cli link -n "HyperClaw" → scan QR
 *   B) Register dedicated number: signal-cli -a +N register → verify <CODE>
 *   Then: signal-cli -a +N daemon --http --port 8080   (or let autoStart=true do it)
 */

import http from 'http';
import https from 'https';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'disabled';
export type ChunkMode = 'length' | 'newline';
export type ReactionLevel = 'off' | 'ack' | 'minimal' | 'extensive';
export type ReceiveMode = 'on-start' | 'manual';

export interface SignalActionsConfig {
  reactions?: boolean;
}

export interface SignalAccountConfig {
  name?: string;
  /** Bot phone number in E.164 format (e.g. +15551234567) */
  account?: string;
  /** Path to signal-cli binary (default: 'signal-cli') */
  cliPath?: string;
  /** Full daemon URL — overrides httpHost/httpPort. Disables autoStart when set. */
  httpUrl?: string;
  /** Daemon bind host (default: 127.0.0.1) */
  httpHost?: string;
  /** Daemon bind port (default: 8080) */
  httpPort?: number;
  /** Auto-spawn signal-cli daemon (default: true when httpUrl is unset) */
  autoStart?: boolean;
  /** Max wait for daemon startup in ms (default: 15000, max: 120000) */
  startupTimeoutMs?: number;
  /** When to start receiving messages (default: 'on-start') */
  receiveMode?: ReceiveMode;

  dmPolicy?: DmPolicy;
  /** E.164 numbers or uuid:<id> values allowed to DM. '*' = open. */
  allowFrom?: string[];

  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];

  historyLimit?: number;
  dmHistoryLimit?: number;

  textChunkLimit?: number;
  chunkMode?: ChunkMode;
  mediaMaxMb?: number;
  ignoreAttachments?: boolean;
  ignoreStories?: boolean;
  sendReadReceipts?: boolean;
  configWrites?: boolean;

  actions?: SignalActionsConfig;
  reactionLevel?: ReactionLevel;
}

export interface SignalConfig extends SignalAccountConfig {
  /** Multi-account map. Keys become accountId. */
  accounts?: Record<string, SignalAccountConfig>;
  /** Internal — managed by connector */
  approvedPairings?: string[];
  pendingPairings?: Record<string, { sender: string; expiresAt: number }>;
}

// Internal resolved account
interface ResolvedAccount {
  id: string;
  name: string;
  account: string;
  cliPath: string;
  daemonUrl: string;
  autoStart: boolean;
  startupTimeoutMs: number;
  receiveMode: ReceiveMode;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: GroupPolicy;
  groupAllowFrom: string[];
  historyLimit: number;
  dmHistoryLimit: number;
  textChunkLimit: number;
  chunkMode: ChunkMode;
  mediaMaxMb: number;
  ignoreAttachments: boolean;
  ignoreStories: boolean;
  sendReadReceipts: boolean;
  configWrites: boolean;
  actions: SignalActionsConfig;
  reactionLevel: ReactionLevel;
  approvedPairings: string[];
  pendingPairings: Record<string, { sender: string; expiresAt: number }>;
}

export interface SignalMessage {
  accountId: string;
  id: string;
  from: string;
  chatId: string;
  text: string;
  timestamp: string;
  isDM: boolean;
  groupId?: string;
  attachments?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR = path.join(os.homedir(), '.hyperclaw');
const PAIRING_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const SSE_RECONNECT_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers — HTTP request to signal-cli daemon
// ---------------------------------------------------------------------------

function cliReq(daemonUrl: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const base = daemonUrl.replace(/\/$/, '');
    const url = new URL(endpoint.startsWith('/') ? endpoint : `/${endpoint}`, base);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = mod.request({
      hostname: url.hostname,
      port: parseInt(url.port || (isHttps ? '443' : '8080'), 10),
      path: url.pathname + (url.search || ''),
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {}
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString()));
      res.on('end', () => {
        if (!data.trim()) { resolve({}); return; }
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers — chunking
// ---------------------------------------------------------------------------

function chunkText(text: string, limit: number, mode: ChunkMode): string[] {
  if (mode === 'newline') {
    // Split on blank lines first, then re-chunk by length
    const paragraphs = text.split(/\n\s*\n/);
    const result: string[] = [];
    let buf = '';
    for (const p of paragraphs) {
      if ((buf + (buf ? '\n\n' : '') + p).length > limit) {
        if (buf) { result.push(buf); buf = ''; }
        if (p.length > limit) {
          // Paragraph itself exceeds limit → hard split
          const subs = p.match(new RegExp(`.{1,${limit}}`, 'gs')) || [p];
          result.push(...subs.slice(0, -1));
          buf = subs[subs.length - 1];
        } else {
          buf = p;
        }
      } else {
        buf = buf ? `${buf}\n\n${p}` : p;
      }
    }
    if (buf) result.push(buf);
    return result;
  }
  // 'length' mode
  return text.match(new RegExp(`.{1,${limit}}`, 'gs')) || [text];
}

// ---------------------------------------------------------------------------
// Helpers — sender identity
// ---------------------------------------------------------------------------

function normalizeSender(source: string | undefined, sourceUuid: string | undefined): string {
  // Prefer UUID for stable identity
  if (sourceUuid) return `uuid:${sourceUuid}`;
  return source ?? '';
}

function senderAllowed(sender: string, allowList: string[]): boolean {
  if (!allowList.length) return false;
  return allowList.some(p => {
    if (p === '*') return true;
    if (p === sender) return true;
    // uuid:<id> matching — match both prefixed and bare form
    if (p.startsWith('uuid:') && sender === p) return true;
    if (!p.startsWith('uuid:') && sender === `uuid:${p}`) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveAccount(
  id: string,
  raw: SignalAccountConfig,
  state: { approved: string[]; pending: Record<string, { sender: string; expiresAt: number }> }
): ResolvedAccount {
  const host = raw.httpHost ?? '127.0.0.1';
  const port = raw.httpPort ?? 8080;
  const daemonUrl = raw.httpUrl ?? `http://${host}:${port}`;
  const hasExternalUrl = !!raw.httpUrl;

  return {
    id,
    name: raw.name ?? id,
    account: raw.account ?? '',
    cliPath: raw.cliPath ?? 'signal-cli',
    daemonUrl,
    autoStart: raw.autoStart ?? !hasExternalUrl,
    startupTimeoutMs: Math.min(raw.startupTimeoutMs ?? 15000, 120000),
    receiveMode: raw.receiveMode ?? 'on-start',
    dmPolicy: raw.dmPolicy ?? 'pairing',
    allowFrom: raw.allowFrom ?? [],
    groupPolicy: raw.groupPolicy ?? 'allowlist',
    groupAllowFrom: raw.groupAllowFrom ?? [],
    historyLimit: raw.historyLimit ?? 50,
    dmHistoryLimit: raw.dmHistoryLimit ?? 50,
    textChunkLimit: raw.textChunkLimit ?? 4000,
    chunkMode: raw.chunkMode ?? 'length',
    mediaMaxMb: raw.mediaMaxMb ?? 8,
    ignoreAttachments: raw.ignoreAttachments ?? false,
    ignoreStories: raw.ignoreStories ?? false,
    sendReadReceipts: raw.sendReadReceipts ?? false,
    configWrites: raw.configWrites ?? true,
    actions: { reactions: true, ...raw.actions },
    reactionLevel: raw.reactionLevel ?? 'minimal',
    approvedPairings: state.approved,
    pendingPairings: state.pending
  };
}

// ---------------------------------------------------------------------------
// SingleAccountConnector
// ---------------------------------------------------------------------------

class SingleAccountConnector extends EventEmitter {
  acc: ResolvedAccount;
  private daemon: ChildProcess | null = null;
  private sseActive = false;
  private sseReconnect = false;

  constructor(acc: ResolvedAccount) {
    super();
    this.acc = acc;
  }

  // ---- connect ------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.acc.autoStart) {
      await this._spawnDaemon();
    }
    // Verify daemon is reachable
    await cliReq(this.acc.daemonUrl, 'GET', '/v1/accounts');
    await this._loadState();
    console.log(chalk.green(`  🦅 Signal[${this.acc.id}]: ${this.acc.account || 'linked'} connected via ${this.acc.daemonUrl}`));
    this.emit('connected', { accountId: this.acc.id, account: this.acc.account, daemonUrl: this.acc.daemonUrl });
    if (this.acc.receiveMode === 'on-start') {
      this._startSSE();
    }
  }

  disconnect(): void {
    this.sseReconnect = false;
    this.sseActive = false;
    if (this.daemon) {
      this.daemon.kill();
      this.daemon = null;
    }
  }

  // ---- Auto-spawn daemon --------------------------------------------------

  private async _spawnDaemon(): Promise<void> {
    const { cliPath, account, httpHost, httpPort } = {
      cliPath: this.acc.cliPath,
      account: this.acc.account,
      httpHost: new URL(this.acc.daemonUrl).hostname,
      httpPort: parseInt(new URL(this.acc.daemonUrl).port || '8080', 10)
    };
    if (!account) throw new Error(`Signal[${this.acc.id}]: 'account' (phone number) is required for autoStart`);

    console.log(chalk.gray(`  Signal[${this.acc.id}]: spawning daemon ${cliPath} -a ${account} daemon --http...`));
    this.daemon = spawn(cliPath, ['-a', account, 'daemon', '--http', `--port=${httpPort}`, `--http-host=${httpHost}`], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.daemon.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.log(chalk.gray(`  [signal-cli] ${line}`));
    });

    this.daemon.on('exit', (code) => {
      console.log(chalk.yellow(`  ⚠ Signal[${this.acc.id}]: daemon exited (code ${code})`));
    });

    // Wait for daemon to be ready
    const deadline = Date.now() + this.acc.startupTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await cliReq(this.acc.daemonUrl, 'GET', '/v1/accounts');
        return; // ready
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    throw new Error(`Signal[${this.acc.id}]: daemon did not start within ${this.acc.startupTimeoutMs}ms`);
  }

  // ---- SSE stream ---------------------------------------------------------

  private _startSSE(): void {
    this.sseReconnect = true;
    this._connectSSE();
  }

  private _connectSSE(): void {
    if (!this.sseReconnect) return;
    const url = new URL('/v1/events', this.acc.daemonUrl);
    if (this.acc.account) url.searchParams.set('account', this.acc.account);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const req = mod.request({
      hostname: url.hostname,
      port: parseInt(url.port || (isHttps ? '443' : '8080'), 10),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }
    }, (res) => {
      this.sseActive = true;
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataLine = line.slice(5).trim();
          } else if (line === '' && dataLine) {
            try { this._handleEnvelope(JSON.parse(dataLine)); } catch {}
            dataLine = '';
          }
        }
      });
      res.on('end', () => {
        this.sseActive = false;
        if (this.sseReconnect) {
          console.log(chalk.yellow(`  Signal[${this.acc.id}]: SSE disconnected, reconnecting...`));
          setTimeout(() => this._connectSSE(), SSE_RECONNECT_DELAY_MS);
        }
      });
      res.on('error', () => {
        this.sseActive = false;
        if (this.sseReconnect) setTimeout(() => this._connectSSE(), SSE_RECONNECT_DELAY_MS);
      });
    });

    req.on('error', () => {
      if (this.sseReconnect) setTimeout(() => this._connectSSE(), SSE_RECONNECT_DELAY_MS);
    });
    req.end();
  }

  // ---- Envelope routing ---------------------------------------------------

  private _handleEnvelope(ev: any): void {
    const envelope = ev.envelope ?? ev;
    if (!envelope) return;

    // Ignore stories
    if (this.acc.ignoreStories && envelope.storyMessage) return;

    const dataMessage = envelope.dataMessage ?? envelope.syncMessage?.sentMessage?.dataMessage;
    if (!dataMessage) return;
    if (!dataMessage.message && !dataMessage.attachments?.length) return;

    const source = envelope.source as string | undefined;
    const sourceUuid = envelope.sourceUuid as string | undefined;
    const from = normalizeSender(source, sourceUuid);
    const timestamp = envelope.timestamp ?? Date.now();
    const msgId = String(timestamp);
    const text = (dataMessage.message as string | undefined)?.trim() ?? '';

    // Group message?
    const groupInfo = dataMessage.groupInfo ?? dataMessage.groupV2;
    if (groupInfo?.groupId) {
      this._routeGroup(from, groupInfo.groupId as string, text, msgId, dataMessage);
    } else {
      this._routeDM(from, text, msgId, dataMessage);
    }
  }

  // ---- DM routing ---------------------------------------------------------

  private async _routeDM(from: string, text: string, msgId: string, dataMessage: any): Promise<void> {
    const acc = this.acc;
    if (acc.dmPolicy === 'disabled') return;

    // Read receipt
    if (acc.sendReadReceipts) {
      this._sendReadReceipt(from, parseInt(msgId, 10)).catch(() => {});
    }

    if (acc.dmPolicy === 'open') {
      this._emitMessage(from, from, text, msgId, true, undefined, dataMessage);
      return;
    }

    if (acc.dmPolicy === 'allowlist') {
      if (!senderAllowed(from, acc.allowFrom)) {
        console.log(chalk.gray(`  signal[${acc.id}]: drop DM from ${from} (dmPolicy=allowlist)`));
        return;
      }
      this._emitMessage(from, from, text, msgId, true, undefined, dataMessage);
      return;
    }

    if (acc.dmPolicy === 'pairing') {
      // Prune expired codes
      const now = Date.now();
      for (const [code, entry] of Object.entries(acc.pendingPairings)) {
        if (entry.expiresAt < now) delete acc.pendingPairings[code];
      }

      if (acc.approvedPairings.includes(from) || senderAllowed(from, acc.allowFrom)) {
        this._emitMessage(from, from, text, msgId, true, undefined, dataMessage);
        return;
      }

      const upper = text.trim().toUpperCase();
      const existing = Object.entries(acc.pendingPairings).find(([code]) => code === upper);
      if (existing && existing[1].sender === from) {
        acc.approvedPairings.push(from);
        delete acc.pendingPairings[upper];
        await this._saveState();
        await this.sendMessage(from, '🦅 Paired!');
        this.emit('pairing:approved', { accountId: acc.id, sender: from });
        return;
      }

      const code = Array.from({ length: 6 }, () =>
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
      ).join('');
      acc.pendingPairings[code] = { sender: from, expiresAt: now + PAIRING_EXPIRY_MS };
      await this._saveState();
      await this.sendMessage(from, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve signal ${code}\n(Expires in 1 hour)`);
    }
  }

  // ---- Group routing ------------------------------------------------------

  private _routeGroup(from: string, groupId: string, text: string, msgId: string, dataMessage: any): void {
    const acc = this.acc;
    if (acc.groupPolicy === 'disabled') return;

    if (acc.groupPolicy === 'allowlist') {
      const combined = [...(acc.groupAllowFrom ?? []), ...(acc.allowFrom ?? [])];
      if (combined.length && !senderAllowed(from, combined)) {
        console.log(chalk.gray(`  signal[${acc.id}]: drop group msg from ${from} in ${groupId} (allowlist)`));
        return;
      }
    }

    const chatId = `signal:group:${groupId}`;
    this._emitMessage(from, chatId, text, msgId, false, groupId, dataMessage);
  }

  private _emitMessage(
    from: string,
    chatId: string,
    text: string,
    msgId: string,
    isDM: boolean,
    groupId: string | undefined,
    dataMessage: any
  ): void {
    const attachments: string[] = [];
    if (!this.acc.ignoreAttachments && Array.isArray(dataMessage?.attachments)) {
      for (const att of dataMessage.attachments) {
        const sizeMb = (att.size ?? 0) / (1024 * 1024);
        if (sizeMb <= this.acc.mediaMaxMb) attachments.push(att.id ?? att.filename ?? '');
      }
    }

    const payload: SignalMessage = {
      accountId: this.acc.id,
      id: msgId,
      from,
      chatId,
      text,
      timestamp: new Date(parseInt(msgId, 10)).toISOString(),
      isDM,
      ...(groupId ? { groupId } : {}),
      ...(attachments.length ? { attachments } : {})
    };
    this.emit('message', payload);
  }

  // ---- Send ---------------------------------------------------------------

  async sendMessage(recipient: string, text: string, groupId?: string): Promise<void> {
    const chunks = chunkText(text, this.acc.textChunkLimit, this.acc.chunkMode);
    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        number: this.acc.account,
        message: chunk
      };
      if (groupId) {
        body.group_id = groupId;
      } else {
        // recipient may be uuid:<id> or E.164
        const resolvedRecipient = recipient.startsWith('uuid:') ? undefined : recipient;
        const resolvedUuid = recipient.startsWith('uuid:') ? recipient.slice(5) : undefined;
        if (resolvedUuid) body.recipients = [{ uuid: resolvedUuid }];
        else body.recipients = [resolvedRecipient];
      }
      await cliReq(this.acc.daemonUrl, 'POST', '/v2/send', body);
    }
  }

  // ---- Typing indicator ---------------------------------------------------

  async sendTyping(recipient: string, groupId?: string, stop = false): Promise<void> {
    try {
      const body: Record<string, unknown> = { number: this.acc.account, stop };
      if (groupId) body.group_id = groupId;
      else body.recipient = recipient.startsWith('uuid:') ? { uuid: recipient.slice(5) } : recipient;
      await cliReq(this.acc.daemonUrl, 'PUT', '/v1/typing', body);
    } catch {}
  }

  // ---- Read receipt -------------------------------------------------------

  private async _sendReadReceipt(sender: string, timestamp: number): Promise<void> {
    const body: Record<string, unknown> = {
      number: this.acc.account,
      receipt_type: 'read',
      timestamps: [timestamp]
    };
    if (sender.startsWith('uuid:')) body.recipient = { uuid: sender.slice(5) };
    else body.recipient = sender;
    await cliReq(this.acc.daemonUrl, 'POST', '/v1/receipts', body);
  }

  // ---- Reactions ----------------------------------------------------------

  async addReaction(
    recipient: string,
    emoji: string,
    targetTimestamp: number,
    targetAuthor?: string,
    groupId?: string
  ): Promise<void> {
    if (!this.acc.actions.reactions || this.acc.reactionLevel === 'off' || this.acc.reactionLevel === 'ack') return;
    const body: Record<string, unknown> = {
      number: this.acc.account,
      emoji,
      target_author: targetAuthor ?? recipient,
      timestamp: targetTimestamp,
      remove: false
    };
    if (groupId) body.group_id = groupId;
    else body.recipient = recipient.startsWith('uuid:') ? { uuid: recipient.slice(5) } : recipient;
    await cliReq(this.acc.daemonUrl, 'POST', `/v1/reactions/${encodeURIComponent(this.acc.account)}`, body);
  }

  async removeReaction(
    recipient: string,
    emoji: string,
    targetTimestamp: number,
    targetAuthor?: string,
    groupId?: string
  ): Promise<void> {
    if (!this.acc.actions.reactions) return;
    const body: Record<string, unknown> = {
      number: this.acc.account,
      emoji,
      target_author: targetAuthor ?? recipient,
      timestamp: targetTimestamp,
      remove: true
    };
    if (groupId) body.group_id = groupId;
    else body.recipient = recipient.startsWith('uuid:') ? { uuid: recipient.slice(5) } : recipient;
    await cliReq(this.acc.daemonUrl, 'POST', `/v1/reactions/${encodeURIComponent(this.acc.account)}`, body);
  }

  // ---- Pairing management -------------------------------------------------

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    const entry = this.acc.pendingPairings[upper];
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      delete this.acc.pendingPairings[upper];
      this._saveState();
      return false;
    }
    this.acc.approvedPairings.push(entry.sender);
    delete this.acc.pendingPairings[upper];
    this._saveState();
    return true;
  }

  listPendingPairings(): Record<string, string> {
    const now = Date.now();
    const result: Record<string, string> = {};
    for (const [code, entry] of Object.entries(this.acc.pendingPairings)) {
      if (entry.expiresAt > now) result[code] = entry.sender;
    }
    return result;
  }

  // ---- State persistence --------------------------------------------------

  private _stateFile(): string {
    return path.join(STATE_DIR, `signal-state-${this.acc.id}.json`);
  }

  private async _saveState(): Promise<void> {
    await fs.ensureDir(STATE_DIR);
    await fs.writeJson(this._stateFile(), {
      approvedPairings: this.acc.approvedPairings,
      pendingPairings: this.acc.pendingPairings
    }, { spaces: 2 });
  }

  async _loadState(): Promise<void> {
    try {
      const s = await fs.readJson(this._stateFile());
      if (Array.isArray(s.approvedPairings)) this.acc.approvedPairings = s.approvedPairings;
      if (s.pendingPairings && typeof s.pendingPairings === 'object') this.acc.pendingPairings = s.pendingPairings;
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// SignalConnector — public facade (single or multi-account)
// ---------------------------------------------------------------------------

export class SignalConnector extends EventEmitter {
  private accounts: Map<string, SingleAccountConnector> = new Map();
  private rawConfig: SignalConfig;

  constructor(config: SignalConfig) {
    super();
    this.rawConfig = config;
  }

  async connect(): Promise<void> {
    const cfg = this.rawConfig;
    const accountDefs: Record<string, SignalAccountConfig> = cfg.accounts ?? { default: cfg };

    for (const [id, rawAcc] of Object.entries(accountDefs)) {
      const merged: SignalAccountConfig = { ...cfg, ...rawAcc };
      const state = {
        approved: cfg.approvedPairings ?? [],
        pending: cfg.pendingPairings ?? {}
      };
      const acc = resolveAccount(id, merged, state);
      if (!acc.account && acc.autoStart) {
        console.log(chalk.yellow(`  ⚠ Signal[${id}]: 'account' required for autoStart — skipping`));
        continue;
      }

      const conn = new SingleAccountConnector(acc);
      await conn._loadState();
      conn.on('message', (msg: SignalMessage) => this.emit('message', msg));
      conn.on('connected', (info: any) => this.emit('connected', info));
      conn.on('pairing:approved', (info: any) => this.emit('pairing:approved', info));

      await conn.connect();
      this.accounts.set(id, conn);
    }
  }

  disconnect(): void {
    for (const conn of this.accounts.values()) conn.disconnect();
    this.accounts.clear();
  }

  private _acc(accountId = 'default'): SingleAccountConnector {
    const conn = this.accounts.get(accountId);
    if (!conn) throw new Error(`Signal: account '${accountId}' not found`);
    return conn;
  }

  async sendMessage(recipient: string, text: string, groupId?: string, accountId?: string): Promise<void> {
    return this._acc(accountId).sendMessage(recipient, text, groupId);
  }

  async sendTyping(recipient: string, groupId?: string, stop?: boolean, accountId?: string): Promise<void> {
    return this._acc(accountId).sendTyping(recipient, groupId, stop);
  }

  async addReaction(recipient: string, emoji: string, targetTimestamp: number, targetAuthor?: string, groupId?: string, accountId?: string): Promise<void> {
    return this._acc(accountId).addReaction(recipient, emoji, targetTimestamp, targetAuthor, groupId);
  }

  async removeReaction(recipient: string, emoji: string, targetTimestamp: number, targetAuthor?: string, groupId?: string, accountId?: string): Promise<void> {
    return this._acc(accountId).removeReaction(recipient, emoji, targetTimestamp, targetAuthor, groupId);
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
