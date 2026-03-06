/**
 * extensions/zalo-personal/src/connector.ts
 * Zalo PERSONAL account connector — via Zalo PC unofficial local API.
 * This is SEPARATE from Zalo OA (official). Uses Zalo PC app running locally.
 *
 * WARNING: Unofficial. Zalo may change this at any time.
 *
 * User setup:
 * 1. Install Zalo PC on Windows/macOS
 * 2. Login with personal account
 * 3. HyperClaw connects to local Zalo PC socket
 *    (via zalo-api-server: github.com/zaloplatform/zalo-api)
 *    OR use cookies extracted from Zalo Web
 * 
 * This implementation uses Zalo Web cookie auth (most stable approach).
 * User provides: cookie (from browser DevTools → Application → Cookies → chat.zalo.me)
 */
import https from 'https';
import { WebSocket } from 'ws';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'zalo-personal-state.json');

export interface ZaloPersonalConfig {
  cookie: string;        // Full cookie string from browser (zpw_sek, zpw_vt2, etc.)
  imei: string;          // Device IMEI (can be any UUID)
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

function zaloWebReq(cookie: string, method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'chat.zalo.me', port: 443, path: `/api${endpoint}`, method,
      headers: {
        'Cookie': cookie, 'Referer': 'https://chat.zalo.me/',
        'User-Agent': 'Mozilla/5.0 (compatible; HyperClaw/4.0)',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class ZaloPersonalConnector extends EventEmitter {
  config: ZaloPersonalConfig;
  private running = false;
  private ws: WebSocket | null = null;
  private userId = '';

  constructor(config: Partial<ZaloPersonalConfig> & { cookie: string }) {
    super();
    this.config = {
      imei: require('crypto').randomUUID(),
      dmPolicy: 'allowlist', allowFrom: [], approvedPairings: [], pendingPairings: {},
      ...config
    } as ZaloPersonalConfig;
  }

  async connect(): Promise<void> {
    // Get user info to verify cookie
    const profile = await zaloWebReq(this.config.cookie, 'GET', '/profile');
    this.userId = profile?.data?.userId || profile?.userId || '';
    await this.loadState();
    this.running = true;
    console.log(chalk.green(`  🦅 Zalo Personal: ${profile?.data?.displayName || this.userId} connected`));
    this.emit('connected', { userId: this.userId });
    this.startPolling();
  }

  private async startPolling(): Promise<void> {
    // Zalo Personal uses long-polling
    while (this.running) {
      try {
        const msgs = await zaloWebReq(this.config.cookie, 'GET', `/message/fetchlatestmsg?last_msg_id=0&limit=20`);
        for (const msg of (msgs?.data?.msgs || [])) {
          if (msg.fromUid === this.userId) continue;
          if (!msg.msgId || !msg.content) continue;

          const from = msg.fromUid;
          const text = msg.content;

          const allowed = await this.checkDMPolicy(from, text);
          if (!allowed) continue;

          this.emit('message', {
            id: msg.msgId, channelId: 'zalo-personal', from,
            chatId: msg.toUid || from, text,
            timestamp: new Date(parseInt(msg.ts || '0')).toISOString(), isDM: true
          });
        }
        await new Promise(r => setTimeout(r, 3000));
      } catch (e: any) {
        if (this.running) { console.log(chalk.yellow(`  ⚠  Zalo Personal: ${e.message}`)); await new Promise(r => setTimeout(r, 5000)); }
      }
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
        this.emit('pairing:approved', { userId: from, channelId: 'zalo-personal' }); return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from; await this.saveState();
      await this.sendMessage(from, `🦅 Mã ghép đôi: ${code}\nXác nhận: hyperclaw pairing approve zalo-personal ${code}`);
      return false;
    }
    return false;
  }

  async sendMessage(toUid: string, text: string): Promise<void> {
    await zaloWebReq(this.config.cookie, 'POST', '/message/sendmsg', {
      toid: toUid, msg: text.slice(0, 2000), imei: this.config.imei, type: 1
    });
  }

  disconnect(): void { this.running = false; this.ws?.close(); }

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
