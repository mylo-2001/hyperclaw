/**
 * extensions/imessage-native/src/connector.ts
 * iMessage via imsg CLI (github.com/steipete/imsg) — macOS native, no BlueBubbles.
 *
 * Status: legacy external CLI integration.
 * Gateway spawns `imsg rpc` and communicates over JSON-RPC on stdio (no separate daemon/port).
 *
 * For new iMessage deployments, use BlueBubbles instead.
 *
 * Requirements: imsg installed, Full Disk Access + Automation for Terminal/Node.
 */

import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'imessage-native-state.json');
const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface IMessageNativeConfig {
  /** Path to the imsg binary. Defaults to IMSG_PATH env var or 'imsg'. */
  cliPath?: string;
  /**
   * Path to the Messages SQLite database.
   * Defaults to ~/Library/Messages/chat.db.
   * Required for Full Disk Access read fallback; imsg rpc uses it internally.
   */
  dbPath?: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  /** Timestamps (ms) for pending pairing codes so they expire after TTL. */
  pendingPairingTs?: Record<string, number>;
}

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: Record<string, unknown>;
}

export class IMessageNativeConnector extends EventEmitter {
  config: IMessageNativeConfig;
  private rpcProc: ReturnType<typeof spawn> | null = null;
  private running = false;
  private lastMessageTs = 0;
  private rpcSeq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buf = '';

  constructor(config: Partial<IMessageNativeConfig> = {}) {
    super();
    this.config = {
      cliPath: config.cliPath || process.env.IMSG_PATH || 'imsg',
      dbPath: config.dbPath || path.join(os.homedir(), 'Library', 'Messages', 'chat.db'),
      dmPolicy: config.dmPolicy ?? 'pairing',
      allowFrom: config.allowFrom ?? [],
      approvedPairings: config.approvedPairings ?? [],
      pendingPairings: config.pendingPairings ?? {},
      pendingPairingTs: config.pendingPairingTs ?? {}
    };
  }

  async connect(): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('imessage-native is macOS only. For new deployments use BlueBubbles.');
    }
    await this.loadState();
    this.running = true;
    this.emit('connected', {});
    this.startRpc();
  }

  private startRpc(): void {
    if (!this.running) return;

    const bin = this.config.cliPath!;
    const args = ['rpc'];
    if (this.config.dbPath) args.push('--db', this.config.dbPath);

    this.rpcProc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.rpcProc.stdout?.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString();
      const lines = this.buf.split('\n');
      this.buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.handleRpcLine(JSON.parse(line) as RpcResponse);
        } catch {}
      }
    });

    this.rpcProc.stderr?.on('data', () => {});
    this.rpcProc.on('error', () => {});
    this.rpcProc.on('exit', (code) => {
      this.rpcProc = null;
      this.buf = '';
      // Reject any outstanding requests
      for (const [, cb] of this.pending) cb.reject(new Error('imsg rpc exited'));
      this.pending.clear();
      if (this.running && code !== 0) setTimeout(() => this.startRpc(), 5000);
    });

    // Subscribe to incoming messages via JSON-RPC notification
    this.rpcSend('messages.watch', {}).catch(() => {});
  }

  private handleRpcLine(msg: RpcResponse): void {
    // Incoming message notification (no id)
    if (!msg.id && msg.method === 'message' && msg.params) {
      this.onIncomingMessage(msg.params as Record<string, unknown>);
      return;
    }
    // Response to a request
    if (msg.id != null) {
      const cb = this.pending.get(msg.id);
      if (!cb) return;
      this.pending.delete(msg.id);
      if (msg.error) cb.reject(new Error(msg.error.message));
      else cb.resolve(msg.result);
    }
  }

  private onIncomingMessage(params: Record<string, unknown>): void {
    if (params.isFromMe) return;
    const handle =
      (params.handle as any)?.address ||
      (params.sender as string) ||
      (params.chatId as string) ||
      (params.from as string);
    const text = (params.text as string) || (params.body as string) || (params.message as string);
    if (!handle || !text) return;

    const ts = (params.dateCreated as number) || (params.timestamp as number) || Date.now();
    if (ts <= this.lastMessageTs) return;
    this.lastMessageTs = ts;
    void this.saveState();

    void this.checkDMPolicyAndEmit(handle, text);
  }

  private pruneExpiredCodes(): void {
    const now = Date.now();
    const ts = this.config.pendingPairingTs!;
    for (const code of Object.keys(ts)) {
      if (now - ts[code] > PAIRING_TTL_MS) {
        delete this.config.pendingPairings[code];
        delete ts[code];
      }
    }
  }

  private async checkDMPolicyAndEmit(from: string, text: string): Promise<void> {
    if (this.config.dmPolicy === 'disabled') return;

    if (this.config.dmPolicy === 'open') {
      this.emit('message', { chatId: from, text });
      return;
    }

    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) this.emit('message', { chatId: from, text });
      else await this.sendMessage(from, 'HyperClaw: Not on allowlist.');
      return;
    }

    // pairing
    this.pruneExpiredCodes();

    if (this.config.approvedPairings.includes(from)) {
      this.emit('message', { chatId: from, text });
      return;
    }

    const code = (text.trim().toUpperCase().match(/[A-Z0-9]{6}/) || [])[0];
    if (code && this.config.pendingPairings[code]) {
      this.config.approvedPairings.push(from);
      delete this.config.pendingPairings[code];
      delete this.config.pendingPairingTs![code];
      await this.saveState();
      await this.sendMessage(from, 'Paired!');
      this.emit('pairing:approved', { userId: from, channelId: 'imessage-native' });
      this.emit('message', { chatId: from, text });
      return;
    }

    const newCode = Array.from(
      { length: 6 },
      () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
    ).join('');
    this.config.pendingPairings[newCode] = from;
    this.config.pendingPairingTs![newCode] = Date.now();
    await this.saveState();
    await this.sendMessage(
      from,
      `Pairing code: ${newCode}\nApprove: hyperclaw pairing approve imessage-native ${newCode}\n(expires in 1 hour)`
    );
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    const to = String(chatId).trim();
    if (!to) return;
    if (!this.rpcProc) throw new Error('imsg rpc not running');
    await this.rpcSend('messages.send', { to, text });
  }

  private rpcSend(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.rpcProc?.stdin) {
        reject(new Error('imsg rpc stdin unavailable'));
        return;
      }
      const id = this.rpcSeq++;
      const req: RpcRequest = { jsonrpc: '2.0', id, method, params };
      this.pending.set(id, { resolve, reject });
      this.rpcProc.stdin.write(JSON.stringify(req) + '\n');
      // Per-request timeout of 15 s
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`imsg rpc timeout for method ${method}`));
        }
      }, 15000);
      // Clear timer when settled
      const orig = this.pending.get(id)!;
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); orig.resolve(v); },
        reject: (e) => { clearTimeout(timer); orig.reject(e); }
      });
    });
  }

  disconnect(): void {
    this.running = false;
    this.rpcProc?.kill();
    this.rpcProc = null;
    this.buf = '';
    for (const [, cb] of this.pending) cb.reject(new Error('disconnected'));
    this.pending.clear();
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      this.lastMessageTs = s.lastTs || 0;
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
      if (s.pts) this.config.pendingPairingTs = s.pts;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(
      STATE_FILE,
      {
        lastTs: this.lastMessageTs,
        p: this.config.pendingPairings,
        a: this.config.approvedPairings,
        pts: this.config.pendingPairingTs
      },
      { spaces: 2 }
    );
  }
}
