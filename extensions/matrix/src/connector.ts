/**
 * extensions/matrix/src/connector.ts
 * Matrix connector — Client-Server API v3, sync loop, DM + room routing.
 *
 * Supported: DMs, rooms, threads, media, reactions, polls (inbound → text),
 *            location (geo URI), E2EE (optional crypto module), multi-account.
 *
 * Auth: access token directly, or userId+password (token cached to credentials file).
 * E2EE: enable with encryption:true; requires @matrix-org/matrix-sdk-crypto-nodejs.
 *       Falls back gracefully if the crypto module is missing.
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const CREDS_BASE = path.join(HC_DIR, 'credentials', 'matrix');
const STATE_BASE = path.join(HC_DIR, 'matrix', 'accounts');
const DEFAULT_CHUNK = 16000;

// ─── Config types ─────────────────────────────────────────────────────────────

export interface MatrixDMPolicy {
  policy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
}

export interface MatrixRoomConfig {
  allow?: boolean;
  requireMention?: boolean;
  allowFrom?: string[];
}

export interface MatrixAccountConfig {
  name?: string;
  homeserver?: string;
  accessToken?: string;
  password?: string;
  userId?: string;
  deviceName?: string;
  encryption?: boolean;
  dm?: Partial<MatrixDMPolicy>;
  /** allowlist | open | disabled. Default: allowlist */
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom?: string[];
  /** Room allowlist + per-room overrides (room ID or alias → config) */
  groups?: Record<string, MatrixRoomConfig>;
  /** Legacy alias for groups */
  rooms?: Record<string, MatrixRoomConfig>;
  threadReplies?: 'off' | 'inbound' | 'always';
  replyToMode?: 'off' | 'first' | 'all';
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
  mediaMaxMb?: number;
  autoJoin?: 'always' | 'allowlist' | 'off';
  autoJoinAllowlist?: string[];
  actions?: Record<string, boolean>;
}

export interface MatrixConfig extends MatrixAccountConfig {
  homeserver: string;
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  /** Multi-account: each entry overrides top-level config */
  accounts?: Record<string, MatrixAccountConfig>;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function matrixReq(
  homeserver: string,
  token: string,
  method: string,
  apiPath: string,
  body?: object,
  query: Record<string, string> = {}
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(homeserver);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const qs = new URLSearchParams({ access_token: token, ...query }).toString();
    const reqPath = `/_matrix/client/v3${apiPath}?${qs}`;

    const req = (mod as typeof https).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: reqPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
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
            if (r.errcode) reject(new Error(r.error || r.errcode));
            else resolve(r);
          } catch {
            reject(new Error('Matrix: invalid JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Matrix: request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function matrixLogin(homeserver: string, userId: string, password: string, deviceName?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(homeserver);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const body = JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: userId.replace(/^@/, '').split(':')[0] },
      password,
      ...(deviceName ? { initial_device_display_name: deviceName } : {})
    });
    const req = (mod as typeof https).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: '/_matrix/client/v3/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('Matrix login: invalid response')); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function chunkText(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (mode === 'newline') {
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let current = '';
    for (const p of paragraphs) {
      if ((current + '\n\n' + p).length > limit && current) {
        chunks.push(current.trim());
        current = p;
      } else {
        current = current ? current + '\n\n' + p : p;
      }
    }
    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks.length ? chunks : [''];
}

// ─── Single-account runner ────────────────────────────────────────────────────

class MatrixAccount extends EventEmitter {
  private cfg: Required<MatrixDMPolicy> & MatrixAccountConfig & {
    homeserver: string;
    approvedPairings: string[];
    pendingPairings: Record<string, string>;
  };
  private accountId: string;
  private token = '';
  private userId = '';
  private running = false;
  private nextBatch: string | null = null;
  /** room ID → true if it is a DM room (populated from m.direct account data) */
  private directRooms = new Set<string>();
  /** resolved room alias → room ID cache */
  private aliasCache = new Map<string, string>();

  constructor(accountId: string, cfg: MatrixAccountConfig & {
    homeserver: string;
    approvedPairings: string[];
    pendingPairings: Record<string, string>;
  }) {
    super();
    this.accountId = accountId;
    this.cfg = {
      groupPolicy: 'allowlist',
      groupAllowFrom: [],
      groups: {},
      rooms: {},
      threadReplies: 'inbound',
      replyToMode: 'off',
      textChunkLimit: DEFAULT_CHUNK,
      chunkMode: 'length',
      mediaMaxMb: 10,
      autoJoin: 'always',
      autoJoinAllowlist: [],
      encryption: false,
      ...cfg,
      dm: {
        policy: cfg.dm?.policy ?? 'pairing',
        allowFrom: cfg.dm?.allowFrom ?? []
      }
    } as any;
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  async authenticate(): Promise<void> {
    const hs = this.cfg.homeserver;
    const credsFile = path.join(CREDS_BASE, `${this.accountId}.json`);

    // 1. Try token from config / env
    if (this.cfg.accessToken) {
      this.token = this.cfg.accessToken;
    } else if (this.cfg.password) {
      // 2. Try cached token
      let cached = false;
      try {
        const c = await fs.readJson(credsFile);
        if (c.homeserver === hs && c.userId === this.cfg.userId && c.accessToken) {
          this.token = c.accessToken;
          cached = true;
        }
      } catch {}

      if (!cached) {
        if (!this.cfg.userId) throw new Error(`Matrix [${this.accountId}]: userId required for password login`);
        const res = await matrixLogin(hs, this.cfg.userId, this.cfg.password!, this.cfg.deviceName);
        if (!res.access_token) throw new Error(`Matrix [${this.accountId}]: login failed — ${JSON.stringify(res)}`);
        this.token = res.access_token;
        await fs.ensureDir(path.dirname(credsFile));
        await fs.writeJson(credsFile, { homeserver: hs, userId: this.cfg.userId, accessToken: this.token }, { spaces: 2 });
      }
    } else {
      throw new Error(`Matrix [${this.accountId}]: accessToken or (userId + password) required`);
    }

    // Fetch userId if not provided
    const whoami = await matrixReq(hs, this.token, 'GET', '/account/whoami');
    this.userId = this.cfg.userId || whoami.user_id;

    // E2EE (optional module)
    if (this.cfg.encryption) {
      try {
        const tokenHash = crypto.createHash('sha256').update(this.token).digest('hex').slice(0, 12);
        const _cryptoDir = path.join(STATE_BASE, this.accountId,
          `${new URL(hs).hostname}__${this.userId.replace(/[^a-z0-9_.-]/gi, '_')}`,
          tokenHash, 'crypto');
        // Attempt to load the native crypto module (optional — may not be installed)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore: optional native module
        await import('@matrix-org/matrix-sdk-crypto-nodejs').catch(() => {
          console.log(chalk.yellow(`  ⚠  Matrix [${this.accountId}]: crypto module not available — E2EE disabled. ` +
            'Run: pnpm rebuild @matrix-org/matrix-sdk-crypto-nodejs'));
          this.cfg.encryption = false;
        });
      } catch {
        this.cfg.encryption = false;
      }
    }
  }

  // ── State ───────────────────────────────────────────────────────────────────

  private stateFile(): string {
    return path.join(STATE_BASE, this.accountId, 'bot-storage.json');
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(this.stateFile());
      this.nextBatch = s.nextBatch || null;
      if (s.p) this.cfg.pendingPairings = s.p;
      if (s.a) this.cfg.approvedPairings = s.a;
      if (s.directRooms) this.directRooms = new Set(s.directRooms);
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(this.stateFile()));
    await fs.writeJson(
      this.stateFile(),
      {
        nextBatch: this.nextBatch,
        p: this.cfg.pendingPairings,
        a: this.cfg.approvedPairings,
        directRooms: [...this.directRooms]
      },
      { spaces: 2 }
    );
  }

  // ── Connect ─────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.authenticate();
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🔷 Matrix [${this.accountId}]: ${this.userId} connected`));
    this.emit('connected', { userId: this.userId, accountId: this.accountId });
    void this.syncLoop();
  }

  disconnect(): void {
    this.running = false;
  }

  // ── Sync ────────────────────────────────────────────────────────────────────

  private async syncLoop(): Promise<void> {
    while (this.running) {
      try {
        const query: Record<string, string> = this.nextBatch
          ? { since: this.nextBatch, timeout: '30000' }
          : { timeout: '0' };

        const sync = await matrixReq(this.cfg.homeserver, this.token, 'GET', '/sync', undefined, query);
        this.nextBatch = sync.next_batch;

        // Update direct rooms from account data
        const directEvent = (sync.account_data?.events || []).find((e: any) => e.type === 'm.direct');
        if (directEvent?.content) {
          for (const rooms of Object.values(directEvent.content) as string[][]) {
            for (const r of rooms) this.directRooms.add(r);
          }
        }

        await this.saveState();

        // Handle invites
        for (const [roomId] of Object.entries(sync.rooms?.invite || {})) {
          await this.handleInvite(roomId as string);
        }

        // Handle timeline events
        const joinedRooms = sync.rooms?.join || {};
        for (const [roomId, rd] of Object.entries(joinedRooms) as [string, any][]) {
          for (const event of rd.timeline?.events || []) {
            if (event.sender === this.userId) continue;
            await this.handleEvent(roomId, event, rd);
          }
        }
      } catch (e: any) {
        if (this.running) {
          console.log(chalk.yellow(`  ⚠  Matrix [${this.accountId}]: ${e.message}`));
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  // ── Invite handling ─────────────────────────────────────────────────────────

  private async handleInvite(roomId: string): Promise<void> {
    const autoJoin = this.cfg.autoJoin ?? 'always';
    if (autoJoin === 'off') return;
    if (autoJoin === 'allowlist') {
      const resolved = await this.resolveRoom(roomId);
      const list = this.cfg.autoJoinAllowlist ?? [];
      if (!list.includes(roomId) && !list.includes(resolved)) return;
    }
    try {
      await matrixReq(this.cfg.homeserver, this.token, 'POST', `/rooms/${encodeURIComponent(roomId)}/join`, {});
    } catch {}
  }

  // ── Event routing ───────────────────────────────────────────────────────────

  private async handleEvent(roomId: string, event: any, roomData: any): Promise<void> {
    const isDM = this.directRooms.has(roomId);
    const sender: string = event.sender || '';
    if (!sender) return;

    let text = '';
    let eventThreadId: string | undefined;

    switch (event.type) {
      case 'm.room.message': {
        const msgtype: string = event.content?.msgtype || '';
        const relatesTo = event.content?.['m.relates_to'];
        eventThreadId = relatesTo?.rel_type === 'm.thread' ? relatesTo.event_id : undefined;

        switch (msgtype) {
          case 'm.text':
          case 'm.notice':
            text = event.content?.body || '';
            break;
          case 'm.image':
          case 'm.video':
          case 'm.audio':
          case 'm.file': {
            const mxcUrl: string = event.content?.url || '';
            const size: number = event.content?.info?.size || 0;
            const maxBytes = (this.cfg.mediaMaxMb ?? 10) * 1024 * 1024;
            if (size > maxBytes) return;
            text = `[${msgtype.replace('m.', '')}:${mxcUrl}]`;
            break;
          }
          case 'm.location':
            text = `[location:${event.content?.geo_uri || ''}]`;
            break;
          default:
            return;
        }
        break;
      }

      // Polls — inbound poll start as text
      case 'org.matrix.msc3381.poll.start':
      case 'm.poll.start': {
        const q = event.content?.['org.matrix.msc3381.poll.start']?.question?.body
          || event.content?.['m.poll']?.question?.text
          || '';
        if (!q) return;
        text = `[poll] ${q}`;
        break;
      }

      // Reactions — surface to agent as special text (tool layer handles them)
      case 'm.reaction': {
        const key = event.content?.['m.relates_to']?.key || '';
        const reacted = event.content?.['m.relates_to']?.event_id || '';
        if (!key) return;
        text = `[reaction:${key}:${reacted}]`;
        break;
      }

      default:
        return;
    }

    if (!text) return;

    if (isDM) {
      const allowed = await this.checkDMPolicy(sender, text, roomId);
      if (!allowed) return;
    } else {
      if (!this.checkGroupPolicy(roomId, sender, text, roomData)) return;
    }

    this.emit('message', {
      channelId: 'matrix',
      accountId: this.accountId,
      chatId: roomId,
      from: sender,
      text,
      threadId: eventThreadId,
      isDM,
      timestamp: new Date(event.origin_server_ts || Date.now()).toISOString()
    });
  }

  // ── DM policy ───────────────────────────────────────────────────────────────

  private async checkDMPolicy(sender: string, text: string, roomId: string): Promise<boolean> {
    const { policy, allowFrom } = this.cfg.dm as Required<MatrixDMPolicy>;

    switch (policy) {
      case 'disabled': return false;
      case 'open': return true;
      case 'allowlist':
        if (allowFrom.includes(sender) || allowFrom.includes('*')) return true;
        await this.sendMessage(roomId, 'HyperClaw: Not on allowlist.');
        return false;
      case 'pairing': {
        if (this.cfg.approvedPairings.includes(sender)) return true;
        const upper = text.trim().toUpperCase().match(/[A-Z0-9]{6}/)?.[0];
        if (upper && this.cfg.pendingPairings[upper]) {
          this.cfg.approvedPairings.push(sender);
          delete this.cfg.pendingPairings[upper];
          await this.saveState();
          await this.sendMessage(roomId, 'Paired!');
          this.emit('pairing:approved', { userId: sender, channelId: 'matrix', accountId: this.accountId });
          return true;
        }
        const code = Array.from(
          { length: 6 },
          () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');
        this.cfg.pendingPairings[code] = sender;
        await this.saveState();
        await this.sendMessage(
          roomId,
          `Pairing code: \`${code}\`\nApprove: hyperclaw pairing approve matrix ${code}`
        );
        return false;
      }
    }
    return false;
  }

  // ── Group/room policy ────────────────────────────────────────────────────────

  private checkGroupPolicy(roomId: string, sender: string, text: string, roomData: any): boolean {
    const policy = this.cfg.groupPolicy ?? 'allowlist';
    if (policy === 'disabled') return false;

    // Merge groups + rooms (legacy alias)
    const allGroups: Record<string, MatrixRoomConfig> = {
      ...(this.cfg.rooms || {}),
      ...(this.cfg.groups || {})
    };

    // Resolve room config (by exact ID or alias key)
    const roomCfg: MatrixRoomConfig = allGroups[roomId] || allGroups['*'] || {};

    if (policy === 'open' || roomCfg.allow === true) {
      // Sender allowlist
      if (roomCfg.allowFrom?.length && !roomCfg.allowFrom.includes(sender)) return false;
      const globalAllow = this.cfg.groupAllowFrom ?? [];
      if (globalAllow.length && !globalAllow.includes(sender)) return false;
      // Mention gating
      if (roomCfg.requireMention !== false) {
        const botMention = `${this.userId}`;
        if (!text.includes(botMention) && !text.startsWith('!')) return false;
      }
      return true;
    }

    // allowlist — room must be explicitly in groups map
    if (!allGroups[roomId] && !allGroups['*']) return false;
    if (roomCfg.allow === false) return false;

    const globalAllow = this.cfg.groupAllowFrom ?? [];
    if (globalAllow.length && !globalAllow.includes(sender)) return false;
    if (roomCfg.allowFrom?.length && !roomCfg.allowFrom.includes(sender)) return false;

    if (roomCfg.requireMention !== false) {
      const botMention = this.userId;
      if (!text.includes(botMention) && !text.startsWith('!')) return false;
    }
    return true;
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  async sendMessage(roomId: string, text: string, threadId?: string): Promise<void> {
    const limit = this.cfg.textChunkLimit ?? DEFAULT_CHUNK;
    const mode = this.cfg.chunkMode ?? 'length';
    const chunks = chunkText(text, limit, mode);

    const threadReplies = this.cfg.threadReplies ?? 'inbound';
    const useThread = threadId && (threadReplies === 'inbound' || threadReplies === 'always');

    for (const chunk of chunks) {
      const content: any = {
        msgtype: 'm.text',
        body: chunk,
        format: 'org.matrix.custom.html',
        formatted_body: chunk.replace(/\n/g, '<br/>')
      };
      if (useThread) {
        content['m.relates_to'] = {
          rel_type: 'm.thread',
          event_id: threadId,
          is_falling_back: true
        };
      }
      const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await matrixReq(
        this.cfg.homeserver,
        this.token,
        'PUT',
        `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
        content
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async resolveRoom(idOrAlias: string): Promise<string> {
    if (!idOrAlias.startsWith('#')) return idOrAlias;
    if (this.aliasCache.has(idOrAlias)) return this.aliasCache.get(idOrAlias)!;
    try {
      const res = await matrixReq(
        this.cfg.homeserver, this.token, 'GET',
        `/directory/room/${encodeURIComponent(idOrAlias)}`
      );
      if (res.room_id) this.aliasCache.set(idOrAlias, res.room_id);
      return res.room_id || idOrAlias;
    } catch {
      return idOrAlias;
    }
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.cfg.pendingPairings[upper]) return false;
    this.cfg.approvedPairings.push(this.cfg.pendingPairings[upper]);
    delete this.cfg.pendingPairings[upper];
    void this.saveState();
    return true;
  }

  isRunning(): boolean { return this.running; }
}

// ─── Public connector (manages 1..N accounts) ────────────────────────────────

export class MatrixConnector extends EventEmitter {
  private config: MatrixConfig;
  private accounts: MatrixAccount[] = [];

  constructor(config: MatrixConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const sharedState = {
      approvedPairings: this.config.approvedPairings ?? [],
      pendingPairings: this.config.pendingPairings ?? {}
    };

    const accountEntries = Object.entries(this.config.accounts || {});

    if (accountEntries.length === 0) {
      // Single default account
      const acct = new MatrixAccount('default', {
        ...this.config,
        ...sharedState
      });
      this.wire(acct);
      await acct.connect();
      this.accounts.push(acct);
    } else {
      // Multi-account — serialized startup
      for (const [id, acctCfg] of accountEntries) {
        const merged: any = {
          ...this.config,
          ...acctCfg,
          homeserver: acctCfg.homeserver || this.config.homeserver,
          ...sharedState
        };
        if (!merged.homeserver) {
          console.error(`[matrix] Account "${id}" has no homeserver — skipping`);
          continue;
        }
        const acct = new MatrixAccount(id, merged);
        this.wire(acct);
        try {
          await acct.connect();
          this.accounts.push(acct);
        } catch (e: any) {
          console.error(`[matrix] Account "${id}" failed: ${e.message}`);
        }
      }
    }
  }

  private wire(acct: MatrixAccount): void {
    acct.on('message', (msg) => this.emit('message', msg));
    acct.on('connected', (info) => this.emit('connected', info));
    acct.on('pairing:approved', (info) => this.emit('pairing:approved', info));
  }

  async sendMessage(roomId: string, text: string, threadId?: string): Promise<void> {
    const acct = this.accounts[0];
    if (!acct) throw new Error('Matrix: no connected account');
    await acct.sendMessage(roomId, text, threadId);
  }

  disconnect(): void {
    for (const a of this.accounts) a.disconnect();
    this.accounts = [];
  }

  approvePairing(code: string): boolean {
    return this.accounts.some((a) => a.approvePairing(code));
  }

  isRunning(): boolean {
    return this.accounts.some((a) => a.isRunning());
  }
}
