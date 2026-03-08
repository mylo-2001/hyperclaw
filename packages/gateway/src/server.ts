/**
 * packages/gateway/src/server.ts
 * HyperClaw Gateway — local-first WebSocket control plane.
 * Handles: sessions, presence, config, channel routing, canvas, webhooks.
 * Uses GatewayDeps for all external integrations (injected by host).
 */

import http from 'http';
import { spawn } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import type { GatewayDeps, SessionStoreLike } from './deps';

let activeServer: GatewayServer | null = null;

// ─── Gateway Lock ─────────────────────────────────────────────────────────────

/**
 * Thrown when the gateway cannot bind its WebSocket port.
 *
 * Most common cause: another gateway instance is already running on the same
 * port (EADDRINUSE). The OS releases the port automatically on any exit,
 * including crashes and SIGKILL — no separate lock file or cleanup is needed.
 *
 * To run a second gateway on the same host, use an isolated profile and a
 * unique port (leave at least 20 ports between base ports):
 *   hyperclaw --profile rescue gateway --port 19001
 */
export class GatewayLockError extends Error {
  readonly code: string;
  constructor(message: string, code = 'GATEWAY_LOCK') {
    super(message);
    this.name = 'GatewayLockError';
    this.code = code;
  }
}

/** Config hot-reload mode — mirrors OpenClaw's gateway.reload.mode. */
export type ReloadMode = 'hybrid' | 'hot' | 'restart' | 'off';

/** Per-channel DM scope isolation — mirrors OpenClaw's session.dmScope. */
export type DmScope = 'global' | 'per-channel' | 'per-channel-peer' | 'per-account-channel-peer';

/** mDNS/Zeroconf discovery mode. */
export type MdnsMode = 'minimal' | 'full' | 'off';

/** Browser SSRF policy. */
export interface BrowserSsrfPolicy {
  /** Allow private/internal network destinations from browser tool. Default: true (operator model). */
  dangerouslyAllowPrivateNetwork?: boolean;
  /** Hostname allowlist patterns (glob). Used in strict mode. */
  hostnameAllowlist?: string[];
  /** Exact hostname exceptions even when otherwise blocked. */
  allowedHostnames?: string[];
}

export interface GatewayConfig {
  port: number;
  bind: string;
  authToken: string;
  runtime: string;
  enabledChannels: string[];
  hooks: boolean;
  /** When true (daemon start), PC access is forced full (daemon mode). */
  daemonMode?: boolean;
  /** Config hot-reload mode. Default: 'hybrid'. */
  reloadMode?: ReloadMode;
  /** Debounce ms for config file watcher. Default: 300. */
  reloadDebounceMs?: number;
  /** Per-channel DM session isolation. Default: 'global'. */
  dmScope?: DmScope;
  /** Trusted reverse-proxy IPs/CIDRs for X-Forwarded-For. */
  trustedProxies?: string[];
  /** mDNS/Zeroconf discovery mode. Default: 'minimal'. */
  mdnsMode?: MdnsMode;
  /** Browser SSRF policy. */
  browserSsrfPolicy?: BrowserSsrfPolicy;
  /** Injected dependencies (required for full operation) */
  deps: GatewayDeps;
}

export interface Session {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  source: string;
  connectedAt: string;
  lastActiveAt: string;
  talkMode?: boolean;
  elevated?: boolean;
  /** When set, this session is a mobile node (iOS/Android Connect tab). */
  nodeId?: string;
  /** Pending node command callbacks. */
  _nodePending?: Map<string, { resolve: (r: { ok: boolean; data?: unknown; error?: string }) => void }>;
  /** Stable key for session restore (e.g. telegram:userId). Persist/load from store under this key. */
  restoreKey?: string;
}

export type { SessionStoreLike } from './deps';

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private sessions = new Map<string, Session>();
  private transcripts = new Map<string, Array<{ role: string; content: string }>>();
  private sessionStore: SessionStoreLike | null = null;
  private config: GatewayConfig;
  private startedAt = '';
  private stopCron: (() => void) | null = null;
  private channelRunner: { stop: () => Promise<void>; handleWebhook?: (channelId: string, body: string, opts?: { signature?: string; timestamp?: string }) => Promise<string | void>; verifyWebhook?: (channelId: string, mode: string, token: string, challenge: string) => string | null } | null = null;
  private configWatcher: { close: () => void } | null = null;
  private configReloadDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /** Start watching the config file for changes and hot-apply safe settings. */
  private startConfigWatcher(): void {
    const mode: ReloadMode = this.config.reloadMode ?? 'hybrid';
    if (mode === 'off') return;

    const configPath = this.config.deps.getConfigPath?.() ?? '';
    if (!configPath) return;

    const fsNode = require('fs') as typeof import('fs');
    const debounceMs = this.config.reloadDebounceMs ?? 300;
    try {
      const watcher = fsNode.watch(configPath, { persistent: false }, (_event: string) => {
        if (this.configReloadDebounce) clearTimeout(this.configReloadDebounce);
        this.configReloadDebounce = setTimeout(() => void this.hotReloadConfig(), debounceMs);
      });
      this.configWatcher = watcher;
      console.log(chalk.gray(`  ⚙  Config watcher active (mode: ${mode}) — ${configPath}`));
    } catch {
      // Config file may not exist yet — watcher will be inert
    }
  }

  /** Hot-apply safe config changes without restarting. */
  private async hotReloadConfig(): Promise<void> {
    try {
      const fs = require('fs-extra') as typeof import('fs-extra');
      const configPath = this.config.deps.getConfigPath?.() ?? '';
      if (!configPath) return;
      const raw = await fs.readJson(configPath).catch(() => null);
      if (!raw) return;

      // Restart-required fields (port, bind, authToken, runtime)
      const restartRequired =
        raw.gateway?.port !== this.config.port ||
        raw.gateway?.bind !== this.config.bind;

      if (restartRequired) {
        console.log(chalk.yellow('\n  ⚙  Config change requires gateway restart — restarting...\n'));
        // Broadcast to all sessions
        for (const s of this.sessions.values()) {
          if (s.socket.readyState === 1) {
            s.socket.send(JSON.stringify({ type: 'gateway:reloading', reason: 'config-change' }));
          }
        }
        // Trigger restart via daemon if available
        try {
          const { DaemonManager } = await import('../../../src/infra/daemon');
          await new DaemonManager().restart?.();
        } catch { /* daemon not running — skip */ }
        return;
      }

      // Hot-apply safe fields: hooks, channels, agent settings, identity
      if (raw.gateway?.hooks !== undefined) this.config.hooks = raw.gateway.hooks;

      // Notify sessions of reload
      const reloadMsg = JSON.stringify({ type: 'gateway:config-reloaded', ts: new Date().toISOString() });
      for (const s of this.sessions.values()) {
        if (s.socket.readyState === 1) s.socket.send(reloadMsg);
      }
      console.log(chalk.green('  ⚙  Config hot-reloaded (no restart needed)'));
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚙  Config reload failed: ${e.message}`));
    }
  }

  async start(): Promise<void> {
    this.httpServer = http.createServer((req, res) => { void this.handleHttp(req, res); });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', this.handleConnection.bind(this));
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.bind, () => resolve());
      this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new GatewayLockError(
            `another gateway instance is already listening on ws://${this.config.bind}:${this.config.port}`,
            'EADDRINUSE'
          ));
        } else {
          reject(new GatewayLockError(
            `failed to bind gateway socket on ws://${this.config.bind}:${this.config.port}: ${err.message}`,
            err.code || 'BIND_ERROR'
          ));
        }
      });
    });
    this.startedAt = new Date().toISOString();
    activeServer = this;
    try {
      this.sessionStore = await this.config.deps.createSessionStore(this.config.deps.getHyperClawDir());
    } catch (_) {
      this.sessionStore = null;
    }
    const icon = this.config.daemonMode ? '🩸' : '🦅';
    const color = this.config.daemonMode ? chalk.red.bind(chalk) : chalk.hex('#06b6d4');
    console.log(color(`\n  ${icon} Gateway started: ws://${this.config.bind}:${this.config.port}\n`));
    this.channelRunner = await this.config.deps.startChannelRunners({
      port: this.config.port,
      bind: this.config.bind,
      authToken: this.config.deps.resolveGatewayToken(this.config.authToken)
    });
    if (this.config.hooks && this.config.deps.createHookLoader) {
      const loader = this.config.deps.createHookLoader();
      loader.execute('gateway:start', {}).catch(() => {});
      this.stopCron = loader.startCronScheduler();
    }
    this.startConfigWatcher();
  }

  async stop(): Promise<void> {
    if (this.configWatcher) { this.configWatcher.close(); this.configWatcher = null; }
    if (this.configReloadDebounce) { clearTimeout(this.configReloadDebounce); }
    if (this.channelRunner) { await this.channelRunner.stop(); this.channelRunner = null; }
    if (this.stopCron) { this.stopCron(); this.stopCron = null; }
    for (const s of this.sessions.values()) s.socket.close(1001, 'Gateway shutting down');
    this.sessions.clear();
    this.wss?.close();
    await new Promise<void>(resolve => this.httpServer?.close(() => resolve()));
    activeServer = null;
  }

  /** Returns false and sends 401 if auth required but missing/invalid. */
  private async requireAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const token = this.config.deps.resolveGatewayToken(this.config.authToken);
    const auth = req.headers.authorization;
    if (!token && !auth) return true;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized', hint: 'Authorization: Bearer <gateway_token_or_developer_key>' }));
      return false;
    }
    const bearer = auth.slice(7);
    if (token && bearer === token) return true;
    if (this.config.deps.validateApiAuth) {
      const ok = await this.config.deps.validateApiAuth(bearer);
      if (ok) return true;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', hint: 'Authorization: Bearer <gateway_token_or_developer_key>' }));
    return false;
  }

  /** Resolve real client IP, honouring X-Forwarded-For only when the socket peer is a trusted proxy. */
  private resolveClientIp(req: http.IncomingMessage): string {
    const socketIp = req.socket.remoteAddress ?? '127.0.0.1';
    const trusted = this.config.trustedProxies ?? [];
    if (trusted.length === 0) return socketIp;
    const isTrusted = trusted.some(proxy => {
      if (proxy === socketIp) return true;
      // CIDR check for /prefix notation
      if (proxy.includes('/')) {
        try {
          const [base, bits] = proxy.split('/');
          const mask = ~((1 << (32 - parseInt(bits, 10))) - 1);
          const ipToNum = (ip: string) => ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
          return (ipToNum(socketIp) & mask) === (ipToNum(base) & mask);
        } catch { return false; }
      }
      return false;
    });
    if (!isTrusted) return socketIp;
    const xff = req.headers['x-forwarded-for'] as string | undefined;
    return xff ? xff.split(',')[0].trim() : socketIp;
  }

  // Rate-limit store for Config RPC: key = `${deviceId}:${clientIp}`, value = { count, windowStart }
  private configRpcRateLimit = new Map<string, { count: number; windowStart: number }>();
  private readonly CONFIG_RPC_MAX = 3;
  private readonly CONFIG_RPC_WINDOW_MS = 60_000;

  private checkConfigRpcRateLimit(key: string): { ok: boolean; retryAfterMs?: number } {
    const now = Date.now();
    let entry = this.configRpcRateLimit.get(key);
    if (!entry || now - entry.windowStart > this.CONFIG_RPC_WINDOW_MS) {
      entry = { count: 0, windowStart: now };
    }
    entry.count++;
    this.configRpcRateLimit.set(key, entry);
    if (entry.count > this.CONFIG_RPC_MAX) {
      const retryAfterMs = this.CONFIG_RPC_WINDOW_MS - (now - entry.windowStart);
      return { ok: false, retryAfterMs };
    }
    return { ok: true };
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url || '/').split('?')[0];
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (url === '/api/v1/check') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, service: 'hyperclaw', version: '5.0.7' }));
      return;
    }

    // Config RPC — rate-limited to 3 req/60 s per deviceId+clientIp
    if ((url === '/api/v1/config/apply' || url === '/api/v1/config/patch') && req.method === 'POST') {
      if (!(await this.requireAuth(req, res))) return;
      const clientIp = this.resolveClientIp(req);
      const deviceId = (req.headers['x-hyperclaw-device'] as string) || 'anon';
      const rlKey = `${deviceId}:${clientIp}`;
      const rl = this.checkConfigRpcRateLimit(rlKey);
      if (!rl.ok) {
        res.writeHead(429, { 'Retry-After': String(Math.ceil((rl.retryAfterMs ?? 60000) / 1000)) });
        res.end(JSON.stringify({ error: 'UNAVAILABLE', retryAfterMs: rl.retryAfterMs, hint: 'Config RPC is rate-limited to 3 requests per 60 seconds.' }));
        return;
      }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const configPath = this.config.deps.getConfigPath();
          const current = await fs.readJson(configPath).catch(() => ({}));
          let next: object;
          if (url.endsWith('/apply')) {
            // Full replace
            next = payload;
          } else {
            // Shallow merge (patch)
            next = { ...current, ...payload };
          }
          await fs.writeJson(configPath, next, { spaces: 2 });
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, action: url.endsWith('/apply') ? 'apply' : 'patch' }));
        } catch (e: any) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url === '/api/v1/pi' && req.method === 'POST') {
      if (!(await this.requireAuth(req, res))) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const handler = this.config.deps.createPiRPCHandler(
            (msg, opts) => this.callAgent(msg, { currentSessionId: opts?.currentSessionId, source: opts?.source }),
            () => this.getSessionsList()
          );
          const rpcReq = JSON.parse(body || '{}');
          const rpcRes = await handler(rpcReq);
          res.writeHead(200);
          res.end(JSON.stringify(rpcRes));
        } catch (e: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: e.message || 'Parse error' } }));
        }
      });
      return;
    }
    if (url === '/api/status') {
      const cfg = this.loadConfig();
      res.writeHead(200);
      res.end(JSON.stringify({
        running: true,
        port: this.config.port,
        channels: this.config.enabledChannels,
        model: cfg?.provider?.modelId || 'unknown',
        agentName: cfg?.identity?.agentName || 'Hyper',
        sessions: this.sessions.size,
        uptime: this.startedAt ? `${Math.round((Date.now() - new Date(this.startedAt).getTime()) / 1000)}s` : '0s'
      }));
      return;
    }
    if (url === '/api/traces' && req.method === 'GET') {
      if (!(await this.requireAuth(req, res))) return;
      (async () => {
        const params = new URL(req.url || '', 'http://localhost').searchParams;
        const limit = Math.min(100, parseInt(params.get('limit') || '50', 10) || 50);
        try {
          const traces = this.config.deps.listTraces
            ? await this.config.deps.listTraces(this.config.deps.getHyperClawDir(), limit)
            : [];
          res.writeHead(200);
          res.end(JSON.stringify({ traces }));
        } catch {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to list traces' }));
        }
      })();
      return;
    }
    if (url === '/api/costs' && req.method === 'GET') {
      if (!(await this.requireAuth(req, res))) return;
      (async () => {
        const params = new URL(req.url || '', 'http://localhost').searchParams;
        const sessionId = params.get('sessionId');
        const hcDir = this.config.deps.getHyperClawDir();
        try {
          if (sessionId && this.config.deps.getSessionSummary) {
            const summary = await this.config.deps.getSessionSummary(hcDir, sessionId);
            res.writeHead(200);
            res.end(JSON.stringify({ sessionId, summary }));
          } else if (this.config.deps.getGlobalSummary) {
            const summary = await this.config.deps.getGlobalSummary(this.config.deps.getHyperClawDir());
            res.writeHead(200);
            res.end(JSON.stringify({ summary }));
          }
        } catch (e: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
      return;
    }

    if (url === '/api/remote/restart' && req.method === 'POST') {
      const auth = req.headers.authorization;
      const token = this.config.deps.resolveGatewayToken(this.config.authToken);
      if (token && auth !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      (async () => {
        const hcDir = this.config.deps.getHyperClawDir();
        const pidFile = path.join(hcDir, 'gateway.pid');
        let didSpawn = false;
        try {
          if (await fs.pathExists(pidFile)) {
            const storedPid = parseInt(await fs.readFile(pidFile, 'utf8'), 10);
            if (storedPid === process.pid && this.config.daemonMode) {
              const runMainPath = this.config.deps.getRunMainPath?.()
                || process.argv[1] || require.main?.filename || path.resolve(process.cwd(), 'dist/run-main.js');
              const child = spawn(process.execPath, [runMainPath, 'daemon', 'restart'], {
                detached: true,
                stdio: 'ignore',
                env: process.env,
                cwd: process.cwd()
              });
              child.unref();
              didSpawn = true;
            }
          }
        } catch {}
        res.writeHead(200);
        res.end(JSON.stringify({
          accepted: true,
          message: didSpawn
            ? 'Restarting daemon...'
            : 'Gateway does not run as daemon. Run: hyperclaw daemon start, or from remote: ssh user@host "hyperclaw daemon restart"',
          restarted: didSpawn
        }));
      })();
      return;
    }

    if (url === '/api/v1/tts' && req.method === 'POST') {
      if (!(await this.requireAuth(req, res))) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { text } = JSON.parse(body || '{}');
          const cfg = this.loadConfig();
          const apiKey = cfg?.talkMode?.apiKey || process.env.ELEVENLABS_API_KEY;
          if (!apiKey || !text) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing text or ELEVENLABS_API_KEY' }));
            return;
          }
          const audio = this.config.deps.textToSpeech
            ? await this.config.deps.textToSpeech(text.slice(0, 4000), {
                apiKey,
                voiceId: cfg?.talkMode?.voiceId,
                modelId: cfg?.talkMode?.modelId
              })
            : null;
          if (!audio) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: 'TTS failed' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ format: 'mp3', data: audio }));
        } catch (e: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (url === '/api/nodes' && req.method === 'GET') {
      if (!(await this.requireAuth(req, res))) return;
      try {
        const NR = this.config.deps.NodeRegistry;
        const nodes = NR ? NR.getNodes().map(n => ({
          nodeId: n.nodeId,
          platform: n.platform,
          capabilities: n.capabilities,
          deviceName: n.deviceName,
          connectedAt: n.connectedAt,
          lastSeenAt: n.lastSeenAt
        })) : [];
        res.writeHead(200);
        res.end(JSON.stringify({ nodes }));
      } catch (e: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (url === '/api/chat' && req.method === 'POST') {
      if (!(await this.requireAuth(req, res))) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const { message } = parsed;
          const agentId: string | undefined = parsed.agentId;
          const sessionKey: string | undefined = parsed.sessionKey;
          const source = (req.headers['x-hyperclaw-source'] as string) || 'unknown';
          const response = await this.callAgent(message, { source, agentId, sessionKey });
          res.writeHead(200);
          res.end(JSON.stringify({ response }));
        } catch (e: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    // Generic inbound webhook: POST { message } → agent. For external services (cron, Zapier, etc).
    if (url === '/api/webhook/inbound' && req.method === 'POST') {
      if (!(await this.requireAuth(req, res))) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const parsed = typeof body === 'string' ? JSON.parse(body || '{}') : {};
          const message = parsed.message || parsed.text || parsed.prompt || String(parsed);
          if (!message || typeof message !== 'string') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Body must include "message" or "text" or "prompt"' }));
            return;
          }
          const response = await this.callAgent(message, { source: 'webhook:inbound' });
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, response }));
        } catch (e: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url === '/api/canvas/state' && req.method === 'GET') {
      if (!(await this.requireAuth(req, res))) return;
      const getState = this.config.deps.getCanvasState;
      if (getState) {
        getState().then(canvas => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(canvas));
        }).catch((e: any) => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
      } else {
        import('../../../src/canvas/renderer').then(({ CanvasRenderer }) => {
          const renderer = new CanvasRenderer();
          renderer.getOrCreate().then(canvas => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(canvas));
          }).catch((e: any) => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          });
        }).catch((e: any) => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
      }
      return;
    }
    if (url === '/api/canvas/a2ui' && req.method === 'GET') {
      if (!(await this.requireAuth(req, res))) return;
      const getA2UI = this.config.deps.getCanvasA2UI;
      if (getA2UI) {
        getA2UI().then(jsonl => {
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.writeHead(200);
          res.end(jsonl + '\n');
        }).catch((e: any) => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
      } else {
        import('../../../src/canvas/renderer').then(({ CanvasRenderer }) => {
          import('../../../src/canvas/a2ui-protocol').then(({ toBeginRendering, toJSONL }) => {
            const renderer = new CanvasRenderer();
            renderer.getOrCreate().then(canvas => {
              const msg = toBeginRendering(canvas);
              res.setHeader('Content-Type', 'application/x-ndjson');
              res.setHeader('Cache-Control', 'no-cache');
              res.writeHead(200);
              res.end(toJSONL([msg]) + '\n');
            }).catch((e: any) => {
              res.writeHead(500);
              res.end(JSON.stringify({ error: e.message }));
            });
          });
        }).catch((e: any) => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
      }
      return;
    }
    if (url === '/chat' || url === '/chat/') {
      res.setHeader('Content-Type', 'text/html');
      const fp = path.join(process.cwd(), 'static', 'chat.html');
      if (fs.pathExistsSync(fp)) res.end(fs.readFileSync(fp, 'utf8'));
      else res.end('<!DOCTYPE html><html><body><p>Chat UI: <a href="/">apps/web</a></p></body></html>');
      return;
    }
    if (url === '/dashboard' || url === '/dashboard/') {
      res.setHeader('Content-Type', 'text/html');
      const fp = path.join(process.cwd(), 'static', 'dashboard.html');
      if (fs.pathExistsSync(fp)) res.end(fs.readFileSync(fp, 'utf8'));
      else res.end('<!DOCTYPE html><html><body><p>Dashboard: <a href="/api/status">status</a></p></body></html>');
      return;
    }
    if (url === '/' || url === '') {
      res.writeHead(302, { Location: '/dashboard' });
      res.end();
      return;
    }
    if (url.startsWith('/webhook/')) {
      const channelId = url.split('/')[2];
      if (req.method === 'GET') {
        const params = new URL(url, 'http://x').searchParams;
        // Twitter/X Account Activity API uses crc_token
        if (channelId === 'twitter') {
          const crcToken = params.get('crc_token');
          if (crcToken) {
            const verified = this.channelRunner?.verifyWebhook?.(channelId, 'crc', crcToken, '');
            if (verified) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(verified);
              return;
            }
          }
        }
        const mode = params.get('hub.mode') || '';
        const token = params.get('hub.verify_token') || '';
        const challenge = params.get('hub.challenge') || '';
        const verified = this.channelRunner?.verifyWebhook?.(channelId, mode, token, challenge);
        if (verified !== null && verified !== undefined) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(verified);
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        }
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          const host = req.headers['host'] || 'localhost';
          const baseUrl = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${host}`;
          let opts: { signature?: string; timestamp?: string; lineSignature?: string; twilioSignature?: string; webhookUrl?: string } | undefined;
          if (channelId === 'slack') opts = { signature: (req.headers['x-slack-signature'] as string) || '', timestamp: (req.headers['x-slack-request-timestamp'] as string) || '' };
          else if (channelId === 'line') opts = { signature: (req.headers['x-line-signature'] as string) || '' };
          else if (channelId === 'sms') opts = { twilioSignature: (req.headers['x-twilio-signature'] as string) || '', webhookUrl: `${baseUrl}${req.url}` };
          else if (channelId === 'instagram' || channelId === 'messenger') opts = { signature: (req.headers['x-hub-signature-256'] as string) || '' };
          else if (channelId === 'viber') opts = { signature: (req.headers['x-viber-signature'] as string) || '' };
          let challenge: string | void = undefined;
          if (this.channelRunner?.handleWebhook) challenge = await this.channelRunner.handleWebhook(channelId, body, opts).catch(() => undefined);
          this.broadcast({ type: 'webhook:received', channelId, payload: body });
          if (typeof challenge === 'string') {
            const contentType = challenge.trim().startsWith('{') ? 'application/json' : 'text/plain';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(challenge);
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          }
        });
        return;
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const id = crypto.randomBytes(8).toString('hex');
    const source = (req.headers['x-hyperclaw-source'] as string) || 'unknown';
    const authToken = this.config.deps.resolveGatewayToken(this.config.authToken);
    const session: Session = {
      id, socket: ws, authenticated: !authToken,
      source, connectedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString()
    };
    this.sessions.set(id, session);
    this.broadcast({ type: 'presence:join', sessionId: id, source }, id);
    console.log(chalk.gray(`  [gateway] +connect ${source} ${id}`));

    if (authToken && !session.authenticated) {
      this.send(session, { type: 'connect.challenge', sessionId: id });
    } else {
      this.send(session, { type: 'connect.ok', sessionId: id, version: '5.0.7', heartbeatInterval: 30000 });
      if (this.config.hooks && this.config.deps.createHookLoader) {
        this.config.deps.createHookLoader().execute('session:start', { sessionId: id }).catch(() => {});
      }
    }

    ws.on('message', (data) => {
      session.lastActiveAt = new Date().toISOString();
      try { this.handleMessage(session, JSON.parse(data.toString())); }
      catch { this.send(session, { type: 'error', message: 'Invalid JSON' }); }
    });
    ws.on('close', () => {
      const s = this.sessions.get(id);
      if (s?.nodeId && this.config.deps.NodeRegistry) {
        this.config.deps.NodeRegistry.unregister(s.nodeId);
        console.log(chalk.gray(`  [gateway] -node ${s.nodeId}`));
      }
      if (this.config.hooks && !s?.nodeId && this.config.deps.createHookLoader) {
        const turnCount = this.transcripts.get(id)?.length ?? 0;
        this.config.deps.createHookLoader().execute('session:end', { sessionId: id, turnCount }).catch(() => {});
      }
      this.transcripts.delete(id);
      this.sessions.delete(id);
      this.broadcast({ type: 'presence:leave', sessionId: id });
      console.log(chalk.gray(`  [gateway] -disconnect ${id}`));
    });
    ws.on('error', (e) => console.log(chalk.yellow(`  [gateway] error ${id}: ${e.message}`)));
  }

  private handleMessage(session: Session, msg: any): void {
    // Node registration (mobile iOS/Android Connect tab) — allowed before auth
    if (msg.type === 'node_register') {
      const nodeId = msg.nodeId || `node-${session.id}`;
      const platform = (msg.platform === 'ios' || msg.platform === 'android') ? msg.platform : 'ios';
      const capabilities = msg.capabilities || {};
      const authToken = this.config.deps.resolveGatewayToken(this.config.authToken);
      if (authToken && msg.token !== authToken) {
        this.send(session, { type: 'node:error', message: 'Invalid token' });
        session.socket.close(4001, 'Unauthorized');
        return;
      }
      const NR = this.config.deps.NodeRegistry;
      if (!NR) { this.send(session, { type: 'node:error', message: 'Node registry not available' }); return; }
      const cmdIdToResolve = new Map<string, { resolve: (r: any) => void }>();
      session._nodePending = cmdIdToResolve;
      const node = {
        nodeId,
        platform,
        capabilities,
        deviceName: msg.deviceName,
        connectedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        send: async (cmd: { id: string; type: string; params?: Record<string, unknown> }) => {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              cmdIdToResolve.delete(cmd.id);
              resolve({ ok: false, error: 'Timeout' });
            }, 30000);
            cmdIdToResolve.set(cmd.id, { resolve: (r) => { clearTimeout(timeout); resolve(r); } });
            this.send(session, { type: 'node:command', id: cmd.id, command: cmd.type, params: cmd.params });
          });
        }
      };
      const protocolVersion = msg.protocolVersion ?? 1;
      NR.register(node);
      session.nodeId = nodeId;
      session.authenticated = true;
      session.source = `node:${platform}`;
      this.send(session, {
        type: 'node:registered',
        nodeId,
        sessionId: session.id,
        protocolVersion: Math.min(protocolVersion, 2),
        heartbeatInterval: 30000,
        capabilities: Object.keys(capabilities)
      });
      console.log(chalk.gray(`  [gateway] +node ${nodeId} (${platform})`));
      return;
    }
    if (msg.type === 'node:unregister' && session.nodeId && this.config.deps.NodeRegistry) {
      this.config.deps.NodeRegistry.unregister(session.nodeId);
      session.nodeId = undefined;
      this.send(session, { type: 'node:unregistered' });
      return;
    }
    if (msg.type === 'node:command_response' && session._nodePending) {
      const r = session._nodePending.get(msg.id);
      if (r) {
        session._nodePending.delete(msg.id);
        r.resolve({ ok: msg.ok, data: msg.data, error: msg.error });
      }
      return;
    }
    if (msg.type === 'session:restore' && (msg.restoreKey ?? msg.previousSessionId)) {
      const key = String(msg.restoreKey ?? msg.previousSessionId);
      session.restoreKey = key;
      if (this.sessionStore) {
        this.sessionStore.get(key).then((state) => {
          if (state?.transcript?.length) {
            const arr = this.transcripts.get(session.id) || [];
            for (const t of state.transcript) {
              if (!arr.some(x => x.role === t.role && x.content === t.content)) arr.push(t);
            }
            if (arr.length > 100) arr.splice(0, arr.length - 80);
            this.transcripts.set(session.id, arr);
            this.send(session, { type: 'session:restored', transcript: state.transcript });
          }
        }).catch(() => {});
      }
      return;
    }
    if (msg.type === 'auth') {
      const resolved = this.config.deps.resolveGatewayToken(this.config.authToken);
      if (resolved && msg.token === resolved) {
        session.authenticated = true;
        this.send(session, { type: 'auth.ok', sessionId: session.id });
      } else {
        session.socket.close(4001, 'Unauthorized');
      }
      return;
    }
    if (!session.authenticated) { this.send(session, { type: 'error', message: 'Not authenticated' }); return; }

    switch (msg.type) {
      case 'ping': {
        if (session.nodeId && this.config.deps.NodeRegistry) {
          this.config.deps.NodeRegistry.updateLastSeen?.(session.nodeId);
        }
        this.send(session, { type: 'pong', ts: Date.now() });
        break;
      }
      case 'talk:enable': session.talkMode = true; this.send(session, { type: 'talk:ok', enabled: true }); break;
      case 'talk:disable': session.talkMode = false; this.send(session, { type: 'talk:ok', enabled: false }); break;
      case 'elevated:enable': {
        const cfg = this.loadConfig();
        const allowFrom = (cfg?.tools?.elevated as any)?.allowFrom ?? [];
        const enabled = (cfg?.tools?.elevated as any)?.enabled === true;
        if (!enabled) { this.send(session, { type: 'error', message: 'Elevated mode disabled in config' }); break; }
        if (allowFrom.length && !allowFrom.includes(session.source) && !allowFrom.includes('*')) {
          this.send(session, { type: 'error', message: 'Source not in elevated allowFrom' }); break;
        }
        session.elevated = true; this.send(session, { type: 'elevated:ok', enabled: true }); break;
      }
      case 'elevated:disable': session.elevated = false; this.send(session, { type: 'elevated:ok', enabled: false }); break;
      case 'chat:message': {
        const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
        if (this.config.hooks && this.config.deps.createHookLoader) {
          this.config.deps.createHookLoader().execute('message:received', { sessionId: session.id }).catch(() => {});
        }
        const onDone = (response: string) => {
          this.send(session, { type: 'chat:response', content: response });
          if (session.talkMode && response) {
            this.synthesizeAndSendAudio(session, response).catch(() => {});
          }
          if (this.config.hooks && this.config.deps.createHookLoader) {
            this.config.deps.createHookLoader().execute('message:sent', { sessionId: session.id, message: content, response }).catch(() => {});
          }
        };
        this.callAgent(content, {
          currentSessionId: session.id,
          onToken: (token) => this.send(session, { type: 'chat:chunk', content: token }),
          onDone
        }).catch((e: Error) => this.send(session, { type: 'chat:response', content: `Error: ${e.message}` }));
        break;
      }
      case 'gateway:status':
        this.send(session, { type: 'gateway:status', sessions: this.sessions.size, uptime: this.startedAt });
        break;
      case 'presence:list':
        this.send(session, {
          type: 'presence:list',
          sessions: Array.from(this.sessions.entries()).map(([sid, s]) => ({ id: sid, source: s.source }))
        });
        break;
      case 'config:get':
        this.send(session, { type: 'config:data', config: this.scrubConfig(this.loadConfig()) });
        break;
    }
  }

  private async callAgent(
    message: string,
    opts?: {
      currentSessionId?: string;
      source?: string;
      onToken?: (token: string) => void;
      onDone?: (response: string) => void;
      /** Agent ID to route to (from binding resolution or broadcast dispatch). */
      agentId?: string;
      /** Pre-computed session key (from session-keys.ts). */
      sessionKey?: string;
    }
  ): Promise<string> {
    const sid = opts?.currentSessionId;
    const sess = sid ? this.sessions.get(sid) : undefined;
    const confirmTriggers = ['confirm', 'yes', 'ok', 'elevate'];
    if (sid && confirmTriggers.includes(message.trim().toLowerCase())) {
      const getPending = this.config.deps.getPending;
      const clearPending = this.config.deps.clearPending;
      if (getPending && clearPending) {
        const pending = getPending(sid);
        if (pending) {
          clearPending(sid);
          try {
            const result = await pending.execute();
            opts?.onDone?.(result);
            return result;
          } catch (e: any) {
            const err = `Error: ${e.message}`;
            opts?.onDone?.(err);
            return err;
          }
        }
      }
    }
    const cfg = this.loadConfig();
    const elevated = sess?.elevated && (cfg?.tools?.elevated as any)?.enabled === true;
    const source = opts?.source || sess?.source;
    const hcDir = this.config.deps.getHyperClawDir();
    const runOpts: Record<string, unknown> = {
      sessionId: sid,
      source,
      elevated,
      onToken: opts?.onToken,
      onDone: opts?.onDone,
      daemonMode: this.config.daemonMode,
      appendTranscript: (s, role, content) => this.appendTranscript(s, role, content),
      activeServer: activeServer ?? this,
      // Multi-agent routing: agentId and sessionKey resolved by channel runner
      ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {})
    };
    if ((cfg?.observability as any)?.traces && this.config.deps.createRunTracer && this.config.deps.writeTraceToFile) {
      const tracer = this.config.deps.createRunTracer(sid, source);
      runOpts.onToolCall = tracer.onToolCall;
      runOpts.onToolResult = tracer.onToolResult;
      runOpts.onRunEnd = (usage, err) => {
        tracer.onRunEnd(usage, err);
        this.config.deps.writeTraceToFile!(hcDir, tracer.trace).catch(() => {});
      };
    }
    const baseOnRunEnd = runOpts.onRunEnd as ((usage?: object, err?: string) => void) | undefined;
    const recordUsage = this.config.deps.recordUsage;
    runOpts.onRunEnd = (usage: object | undefined, err: string | undefined) => {
      baseOnRunEnd?.(usage, err);
      if (sid && usage && recordUsage) {
        recordUsage(hcDir, sid, usage as { input: number; output: number; cacheRead?: number }, { source, model: (cfg?.provider?.modelId as string) ?? undefined }).catch(() => {});
      }
    };
    const result = await this.config.deps.runAgentEngine(message, runOpts);
    return result.text;
  }

  appendTranscript(sessionId: string, role: string, content: string): void {
    let arr = this.transcripts.get(sessionId);
    if (!arr) { arr = []; this.transcripts.set(sessionId, arr); }
    arr.push({ role, content });
    if (arr.length > 100) arr.splice(0, arr.length - 80);
    const sess = this.sessions.get(sessionId);
    const storeKey = sess?.restoreKey || sessionId;
    if (this.sessionStore) {
      this.sessionStore.append(storeKey, role, content, sess?.source).catch(() => {});
    }
  }

  getSessionsList(): Array<{ id: string; source: string; connectedAt: string }> {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id, source: s.source, connectedAt: s.connectedAt
    }));
  }

  sendToSession(sessionId: string, msg: object): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.socket.readyState !== WebSocket.OPEN) return false;
    this.send(s, msg);
    return true;
  }

  getSessionHistory(sessionId: string, limit = 20): Array<{ role: string; content: string }> {
    const arr = this.transcripts.get(sessionId) ?? [];
    return arr.slice(-limit);
  }

  send(session: Session, msg: object): void {
    if (session.socket.readyState === WebSocket.OPEN)
      session.socket.send(JSON.stringify(msg));
  }

  broadcast(msg: object, excludeId?: string): void {
    for (const [id, s] of this.sessions)
      if (id !== excludeId && s.authenticated) this.send(s, msg);
  }

  private async synthesizeAndSendAudio(session: Session, text: string): Promise<void> {
    const cfg = this.loadConfig();
    const talk = cfg?.talkMode;
    const apiKey = talk?.apiKey || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return;
    const textToSpeech = this.config.deps.textToSpeech;
    if (!textToSpeech) return;
    const audio = await textToSpeech(text.slice(0, 4000), {
      apiKey,
      voiceId: talk?.voiceId,
      modelId: talk?.modelId || 'eleven_multilingual_v2'
    });
    if (audio) this.send(session, { type: 'chat:audio', format: 'mp3', data: audio });
  }

  private loadConfig(): any {
    if (this.config.deps.loadConfig) return this.config.deps.loadConfig();
    try { return fs.readJsonSync(this.config.deps.getConfigPath()); } catch { return null; }
  }

  private scrubConfig(cfg: any): any {
    if (!cfg) return null;
    const s = JSON.parse(JSON.stringify(cfg));
    if (s.provider?.apiKey) s.provider.apiKey = '***';
    if (s.gateway?.authToken) s.gateway.authToken = '***';
    return s;
  }

  getStatus() { return { running: true, port: this.config.port, sessions: this.sessions.size, startedAt: this.startedAt }; }
}

const DEFAULT_PORT = 18789;

export async function startGateway(opts: { daemonMode?: boolean; deps: GatewayDeps }): Promise<GatewayServer> {
  const deps = opts.deps;
  let base: Partial<GatewayConfig>;
  try {
    base = fs.readJsonSync(deps.getConfigPath()).gateway;
  } catch {
    base = { port: DEFAULT_PORT, bind: '127.0.0.1', authToken: '', runtime: 'node', enabledChannels: [], hooks: true };
  }
  const portEnv = process.env.PORT || process.env.HYPERCLAW_PORT;
  const port = portEnv ? parseInt(portEnv, 10) || base.port : base.port;
  const cfg: GatewayConfig = {
    ...base,
    port: port ?? DEFAULT_PORT,
    bind: base.bind ?? '127.0.0.1',
    authToken: deps.resolveGatewayToken(base.authToken ?? '') ?? base.authToken ?? '',
    runtime: base.runtime ?? 'node',
    enabledChannels: base.enabledChannels ?? [],
    hooks: base.hooks ?? true,
    daemonMode: opts.daemonMode,
    deps
  };
  const server = new GatewayServer(cfg);
  await server.start();
  return server;
}

export function getActiveServer() { return activeServer; }

// Extend GatewayServer prototype with ISessionServer methods (used by agent sessions tools)
GatewayServer.prototype.getSessionsList = function () {
  const out: { id: string; source: string; connectedAt: string }[] = [];
  for (const [id, s] of (this as any).sessions as Map<string, Session>) {
    out.push({
      id,
      source: s.source,
      connectedAt: s.connectedAt,
      lastActiveAt: s.lastActiveAt,
      talkMode: s.talkMode ?? false,
      nodeId: s.nodeId ?? null,
    } as any);
  }
  return out;
};

GatewayServer.prototype.sendToSession = function (id: string, msg: unknown): boolean {
  const session = ((this as any).sessions as Map<string, Session>).get(id);
  if (!session || session.socket.readyState !== 1 /* OPEN */) return false;
  try {
    session.socket.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
};

GatewayServer.prototype.getSessionHistory = function (id: string, limit: number): { role: string; content: string }[] {
  const history = ((this as any).transcripts as Map<string, Array<{ role: string; content: string }>>).get(id);
  if (!history) return [];
  return history.slice(-limit);
};
