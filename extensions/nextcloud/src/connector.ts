/**
 * extensions/nextcloud/src/connector.ts
 * Nextcloud Talk bot connector — webhook receiver + bot API.
 *
 * Architecture: registers an HTTP server that Nextcloud Talk posts events to.
 * Sends replies via the Talk bot API (X-Nextcloud-Talk-Bot-Secret) or,
 * if apiUser+apiPassword are provided, via OCS API with Basic Auth.
 *
 * Bot registration (on your Nextcloud server):
 *   ./occ talk:bot:install "HyperClaw" "<shared-secret>" "<webhook-url>" --feature reaction
 *
 * Inbound signature: X-Nextcloud-Talk-Signature = HMAC-SHA256(secret, random + body)
 * where X-Nextcloud-Talk-Random is prepended.
 *
 * Supported: DMs, rooms, reactions, markdown messages.
 * Not supported: threads, media uploads (sent as URLs).
 */

import http from 'http';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'nextcloud-talk-state.json');
const DEFAULT_PORT = 8788;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PATH = '/nextcloud-talk-webhook';
const DEFAULT_CHUNK = 32000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NextcloudTalkRoomConfig {
  requireMention?: boolean;
  allowFrom?: string[];
}

export interface NextcloudTalkConfig {
  /** Nextcloud instance URL, e.g. https://cloud.example.com */
  baseUrl: string;
  /** Bot shared secret (from occ talk:bot:install) */
  botSecret?: string;
  /** Path to file containing the bot secret */
  botSecretFile?: string;

  /** Optional: Nextcloud API user for OCS calls (DM detection + fallback send) */
  apiUser?: string;
  /** Optional: Nextcloud API/app password */
  apiPassword?: string;
  /** Path to file containing the API password */
  apiPasswordFile?: string;

  /** Webhook listener port (default: 8788) */
  webhookPort?: number;
  /** Webhook listener host (default: 0.0.0.0) */
  webhookHost?: string;
  /** Webhook path (default: /nextcloud-talk-webhook) */
  webhookPath?: string;
  /** Externally reachable webhook URL (for proxy setups) */
  webhookPublicUrl?: string;

  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  /** Per-room settings keyed by room token */
  rooms: Record<string, NextcloudTalkRoomConfig>;

  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, { historyLimit?: number }>;
  mediaMaxMb?: number;

  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

// ─── OCS helper ───────────────────────────────────────────────────────────────

function ocsReq(
  baseUrl: string,
  user: string,
  password: string,
  method: string,
  apiPath: string,
  body?: object
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/ocs/v2.php/apps/spreed/api/v4${apiPath}`);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    const payload = body ? JSON.stringify(body) : null;
    const req = (mod as typeof https).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'OCS-APIRequest': 'true',
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
            const parsed = JSON.parse(data);
            const ocs = parsed?.ocs;
            if (ocs?.meta?.statuscode >= 400)
              reject(new Error(ocs.meta.message || 'OCS error'));
            else resolve(ocs?.data ?? parsed);
          } catch {
            reject(new Error('Nextcloud: invalid JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Send a message via the Talk bot API (X-Nextcloud-Talk-Bot-Secret auth). */
function botSend(
  baseUrl: string,
  secret: string,
  token: string,
  message: string,
  referenceId?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/ocs/v2.php/apps/spreed/api/v1/bot/${token}/message`);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = JSON.stringify({
      message,
      referenceId: referenceId || crypto.randomBytes(8).toString('hex')
    });
    const req = (mod as typeof https).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'X-Nextcloud-Talk-Bot-Secret': secret,
          'OCS-APIRequest': 'true',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({}); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function chunkText(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (mode === 'newline') {
    const paras = text.split(/\n\n+/);
    const chunks: string[] = [];
    let cur = '';
    for (const p of paras) {
      if ((cur + '\n\n' + p).length > limit && cur) {
        chunks.push(cur.trim());
        cur = p;
      } else {
        cur = cur ? cur + '\n\n' + p : p;
      }
    }
    if (cur) chunks.push(cur.trim());
    return chunks.filter(Boolean);
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks.length ? chunks : [''];
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class NextcloudTalkConnector extends EventEmitter {
  config: NextcloudTalkConfig;
  private server: http.Server | null = null;
  private running = false;
  private resolvedSecret = '';
  private resolvedApiPassword = '';
  /** Cache: room token → isDM (room.type === 1) */
  private roomTypeCache = new Map<string, boolean>();

  constructor(config: Partial<NextcloudTalkConfig> & { baseUrl: string }) {
    super();
    this.config = {
      dmPolicy: 'pairing',
      allowFrom: [],
      groupPolicy: 'allowlist',
      groupAllowFrom: [],
      rooms: {},
      approvedPairings: [],
      pendingPairings: {},
      ...config
    } as NextcloudTalkConfig;
  }

  // ── Credentials ─────────────────────────────────────────────────────────────

  private async resolveCredentials(): Promise<void> {
    this.resolvedSecret =
      this.config.botSecret ||
      (this.config.botSecretFile
        ? (await fs.readFile(this.config.botSecretFile, 'utf8')).trim()
        : '');
    if (!this.resolvedSecret)
      throw new Error('nextcloud-talk: botSecret or botSecretFile is required');

    this.resolvedApiPassword =
      this.config.apiPassword ||
      (this.config.apiPasswordFile
        ? (await fs.readFile(this.config.apiPasswordFile, 'utf8')).trim()
        : '');
  }

  // ── Connect ──────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.resolveCredentials();
    await this.loadState();
    this.running = true;
    await this.startWebhookServer();
    const port = this.config.webhookPort ?? DEFAULT_PORT;
    const wPath = this.config.webhookPath ?? DEFAULT_PATH;
    const publicUrl = this.config.webhookPublicUrl || `http://localhost:${port}${wPath}`;
    console.log(chalk.green(`  ☁️  Nextcloud Talk: webhook listening at ${publicUrl}`));
    this.emit('connected', { webhookUrl: publicUrl });
  }

  disconnect(): void {
    this.running = false;
    this.server?.close();
    this.server = null;
  }

  // ── Webhook server ───────────────────────────────────────────────────────────

  private startWebhookServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const wPath = this.config.webhookPath ?? DEFAULT_PATH;
        if (req.url !== wPath || req.method !== 'POST') {
          res.writeHead(404);
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          const random = req.headers['x-nextcloud-talk-random'] as string | undefined;
          const sig = req.headers['x-nextcloud-talk-signature'] as string | undefined;

          if (!this.verifySignature(random || '', body, sig || '')) {
            console.log(chalk.yellow('  ⚠  Nextcloud Talk: invalid webhook signature'));
            res.writeHead(401);
            res.end();
            return;
          }

          res.writeHead(200);
          res.end();

          void this.handlePayload(body).catch((e) =>
            console.error(`[nextcloud-talk] handler error: ${e.message}`)
          );
        });
      });

      const port = this.config.webhookPort ?? DEFAULT_PORT;
      const host = this.config.webhookHost ?? DEFAULT_HOST;
      this.server.listen(port, host, () => resolve());
      this.server.on('error', reject);
    });
  }

  // ── Signature verification ──────────────────────────────────────────────────

  verifySignature(random: string, body: string, signature: string): boolean {
    if (!this.resolvedSecret) return false;
    const expected = crypto
      .createHmac('sha256', this.resolvedSecret)
      .update(random + body)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature.toLowerCase()),
        Buffer.from(expected.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  // ── Payload handler ──────────────────────────────────────────────────────────

  private async handlePayload(raw: string): Promise<void> {
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    const objectType: string = payload?.object?.type || '';
    const actorId: string = payload?.actor?.id || '';
    const actorName: string = payload?.actor?.name || actorId;
    const token: string = payload?.target?.id || '';

    if (!token || !actorId) return;

    switch (objectType) {
      case 'chat-message': {
        const msgContent = payload.object?.content;
        const text: string =
          (typeof msgContent === 'object' ? msgContent?.message : msgContent) ||
          payload.object?.name ||
          '';
        if (!text) return;
        await this.routeMessage(token, actorId, actorName, text);
        break;
      }
      case 'reaction': {
        const emoji: string = payload.object?.name || payload.object?.content || '';
        const reactedId: string = String(payload.object?.id || '');
        if (!emoji) return;
        const text = `[reaction:${emoji}:${reactedId}]`;
        await this.routeMessage(token, actorId, actorName, text);
        break;
      }
      default:
        break;
    }
  }

  // ── Route: DM vs room ────────────────────────────────────────────────────────

  private async routeMessage(token: string, userId: string, displayName: string, text: string): Promise<void> {
    const isDM = await this.detectDM(token);

    if (isDM) {
      const allowed = await this.checkDMPolicy(userId, text, token);
      if (!allowed) return;
    } else {
      if (!this.checkGroupPolicy(token, userId, text)) return;
    }

    this.emit('message', {
      channelId: 'nextcloud-talk',
      chatId: token,
      from: userId,
      displayName,
      text,
      isDM
    });
  }

  /** Look up whether a room token is a DM (type=1). Caches results. */
  private async detectDM(token: string): Promise<boolean> {
    if (this.roomTypeCache.has(token)) return this.roomTypeCache.get(token)!;
    if (!this.config.apiUser || !this.resolvedApiPassword) {
      // No OCS credentials — cannot distinguish DM from group
      this.roomTypeCache.set(token, false);
      return false;
    }
    try {
      const room = await ocsReq(
        this.config.baseUrl, this.config.apiUser, this.resolvedApiPassword,
        'GET', `/room/${token}`
      );
      const isDM = room?.type === 1;
      this.roomTypeCache.set(token, isDM);
      return isDM;
    } catch {
      this.roomTypeCache.set(token, false);
      return false;
    }
  }

  // ── DM policy ────────────────────────────────────────────────────────────────

  private async checkDMPolicy(userId: string, text: string, token: string): Promise<boolean> {
    switch (this.config.dmPolicy) {
      case 'disabled': return false;
      case 'open': return true;
      case 'allowlist':
        if (this.config.allowFrom.includes(userId) || this.config.allowFrom.includes('*'))
          return true;
        await this.sendMessage(token, 'HyperClaw: Not on allowlist.');
        return false;
      case 'pairing': {
        if (this.config.approvedPairings.includes(userId)) return true;
        const upper = text.trim().toUpperCase().match(/[A-Z0-9]{6}/)?.[0];
        if (upper && this.config.pendingPairings[upper]) {
          this.config.approvedPairings.push(userId);
          delete this.config.pendingPairings[upper];
          await this.saveState();
          await this.sendMessage(token, 'Paired!');
          this.emit('pairing:approved', { userId, channelId: 'nextcloud-talk' });
          return true;
        }
        const code = Array.from(
          { length: 6 },
          () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');
        this.config.pendingPairings[code] = userId;
        await this.saveState();
        await this.sendMessage(
          token,
          `Pairing code: ${code}\nApprove: hyperclaw pairing approve nextcloud-talk ${code}`
        );
        return false;
      }
    }
    return false;
  }

  // ── Group policy ─────────────────────────────────────────────────────────────

  private checkGroupPolicy(token: string, userId: string, text: string): boolean {
    const policy = this.config.groupPolicy;
    if (policy === 'disabled') return false;

    const roomCfg = this.config.rooms[token];

    if (policy === 'open') {
      if (roomCfg?.allowFrom?.length && !roomCfg.allowFrom.includes(userId)) return false;
      const global = this.config.groupAllowFrom;
      if (global.length && !global.includes(userId)) return false;
      return true;
    }

    // allowlist — room must be explicitly listed
    if (!roomCfg) return false;

    const global = this.config.groupAllowFrom;
    if (global.length && !global.includes(userId)) return false;
    if (roomCfg.allowFrom?.length && !roomCfg.allowFrom.includes(userId)) return false;

    // Mention gating (default: required)
    if (roomCfg.requireMention !== false) {
      if (!text.includes('@HyperClaw') && !text.startsWith('!')) return false;
    }

    return true;
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  async sendMessage(token: string, text: string): Promise<void> {
    const limit = this.config.textChunkLimit ?? DEFAULT_CHUNK;
    const mode = this.config.chunkMode ?? 'length';
    const chunks = chunkText(text, limit, mode);

    for (const chunk of chunks) {
      if (this.config.apiUser && this.resolvedApiPassword) {
        await ocsReq(
          this.config.baseUrl,
          this.config.apiUser,
          this.resolvedApiPassword,
          'POST',
          `/chat/${token}`,
          { message: chunk }
        );
      } else {
        await botSend(this.config.baseUrl, this.resolvedSecret, token, chunk);
      }
    }
  }

  // ── Pairing ───────────────────────────────────────────────────────────────────

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    void this.saveState();
    return true;
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(
      STATE_FILE,
      { p: this.config.pendingPairings, a: this.config.approvedPairings },
      { spaces: 2 }
    );
  }

  isRunning(): boolean { return this.running; }
}

// Backward-compat alias
export { NextcloudTalkConnector as NextcloudConnector };
