/**
 * extensions/signal/src/connector.ts
 * REAL Signal connector — via signal-cli (Java) REST daemon.
 * Signal has no official bot API. This uses signal-cli which runs
 * as a local HTTP daemon that interfaces with the Signal protocol.
 *
 * User setup:
 * 1. Install signal-cli: github.com/AsamK/signal-cli
 *    brew install signal-cli  (macOS)
 *    or: java -jar signal-cli.jar
 * 2. Register/link a number:
 *    signal-cli -u +1234567890 register
 *    signal-cli -u +1234567890 verify CODE
 * 3. Start REST daemon:
 *    signal-cli -u +1234567890 daemon --http --port 8080
 * 4. Set signalCliUrl: http://localhost:8080
 */
import http from 'http';
import https from 'https';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'signal-state.json');

export interface SignalConfig {
  signalCliUrl: string;   // http://localhost:8080
  phoneNumber: string;    // +1234567890 (registered number)
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
  pollIntervalMs: number;
}

function cliReq(baseUrl: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + endpoint);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = (mod as any).request({
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 8080),
      path: url.pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, (res: any) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
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

export class SignalConnector extends EventEmitter {
  config: SignalConfig;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<SignalConfig> & { signalCliUrl: string; phoneNumber: string }) {
    super();
    this.config = { dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {}, pollIntervalMs: 3000, ...config } as SignalConfig;
  }

  async connect(): Promise<void> {
    // Check signal-cli is running
    await cliReq(this.config.signalCliUrl, 'GET', `/v1/accounts`);
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Signal: ${this.config.phoneNumber} connected via signal-cli`));
    this.emit('connected', { number: this.config.phoneNumber });
    this.startPolling();
  }

  disconnect(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private startPolling(): void {
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    try {
      const messages = await cliReq(this.config.signalCliUrl, 'GET',
        `/v1/receive/${encodeURIComponent(this.config.phoneNumber)}`);
      if (!Array.isArray(messages)) return;

      for (const envelope of messages) {
        const dm = envelope.envelope?.dataMessage;
        const from = envelope.envelope?.source;
        if (!dm?.message || !from) continue;

        const allowed = await this.checkDMPolicy(from, dm.message);
        if (!allowed) continue;

        this.emit('message', {
          id: envelope.envelope?.timestamp?.toString(),
          channelId: 'signal', from, chatId: from,
          text: dm.message, timestamp: new Date(envelope.envelope.timestamp).toISOString(), isDM: true
        });
      }
    } catch (e: any) {
      if (this.running) console.log(chalk.yellow(`  ⚠  Signal poll: ${e.message}`));
    }
  }

  private async checkDMPolicy(from: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.sendMessage(from, '🦅 HyperClaw: Not on allowlist.'); return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from); delete this.config.pendingPairings[upper];
        await this.saveState(); await this.sendMessage(from, '🦅 Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'signal' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendMessage(from, `🦅 Pairing code: ${code}\nApprove: hyperclaw pairing approve signal ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(recipient: string, text: string): Promise<void> {
    await cliReq(this.config.signalCliUrl, 'POST',
      `/v2/send`,
      { number: this.config.phoneNumber, recipients: [recipient], message: text.slice(0, 50000) }
    );
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper]; this.saveState(); return true;
  }

  private async loadState(): Promise<void> { try { const s = await fs.readJson(STATE_FILE); if (s.p) this.config.pendingPairings = s.p; if (s.a) this.config.approvedPairings = s.a; } catch {} }
  private async saveState(): Promise<void> { await fs.ensureDir(path.dirname(STATE_FILE)); await fs.writeJson(STATE_FILE, { p: this.config.pendingPairings, a: this.config.approvedPairings }, { spaces: 2 }); }
  isRunning() { return this.running; }
}
