/**
 * extensions/tlon/src/connector.ts
 * Tlon (Urbit Groups) connector — Urbit Eyre HTTP API + SSE channel subscription.
 * Connects to a running Urbit ship and subscribes to a DM or group channel.
 *
 * Urbit channel protocol:
 *   PUT /~/channel/<uid>           — open a channel
 *   GET /~/channel/<uid>           — SSE stream of events
 *   PUT /~/channel/<uid>           — poke / subscribe actions (JSON body)
 *   DELETE /~/channel/<uid>/<id>   — acknowledge events
 */

import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'tlon-state.json');

export interface TlonConfig {
  /** URL of the Urbit ship, e.g. http://localhost:8080 */
  shipUrl: string;
  /** Urbit ship name, e.g. ~sampel-palnet */
  ship: string;
  /** Login code from Landscape */
  code: string;
  /** Group to join, e.g. ~sampel-palnet/my-group */
  group?: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

type UrbitAction = Record<string, unknown>;

export class TlonConnector extends EventEmitter {
  config: TlonConfig;
  private cookie: string | null = null;
  private channelUid: string | null = null;
  private running = false;
  private lastEventId = 0;
  private sseAbort: AbortController | null = null;

  constructor(config: Partial<TlonConfig> & { shipUrl: string; ship: string; code: string }) {
    super();
    this.config = {
      dmPolicy: 'pairing',
      allowFrom: [],
      approvedPairings: [],
      pendingPairings: {},
      ...config
    } as TlonConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    await this.login();
    await this.openChannel();
    await this.subscribe();
    this.running = true;
    console.log(chalk.green(`  🦅 Tlon: connected as ${this.config.ship}`));
    this.emit('connected', { ship: this.config.ship });
    this.listenSSE();
  }

  disconnect(): void {
    this.running = false;
    this.sseAbort?.abort();
  }

  private async login(): Promise<void> {
    const body = `password=${encodeURIComponent(this.config.code)}`;
    const cookie = await this.urbitReq('POST', '/~/login', body, 'application/x-www-form-urlencoded');
    if (!cookie) throw new Error('Tlon: login failed — check ship URL and code');
    this.cookie = cookie;
  }

  private async openChannel(): Promise<void> {
    this.channelUid = `hyperclaw-${Date.now()}`;
    await this.urbitPut([]);
  }

  private async subscribe(): Promise<void> {
    const actions: UrbitAction[] = [];

    // Subscribe to DMs (chat store)
    actions.push({
      id: ++this.lastEventId,
      action: 'subscribe',
      ship: this.config.ship,
      app: 'chat-store',
      path: '/keys'
    });

    // Subscribe to group messages if configured
    if (this.config.group) {
      const [groupShip, groupName] = this.config.group.split('/');
      actions.push({
        id: ++this.lastEventId,
        action: 'subscribe',
        ship: groupShip,
        app: 'graph-store',
        path: `/updates`
      });
    }

    await this.urbitPut(actions);
  }

  private listenSSE(): void {
    this.sseAbort = new AbortController();
    const url = new URL(`/~/channel/${this.channelUid}`, this.config.shipUrl);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const doRequest = () => {
      if (!this.running) return;
      const req = (mod as any).request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        headers: {
          'Cookie': this.cookie,
          'Accept': 'text/event-stream'
        }
      }, async (res: any) => {
        let buf = '';
        res.on('data', async (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              await this.handleEvent(data);
            } catch {}
          }
        });
        res.on('end', () => {
          if (this.running) setTimeout(doRequest, 3000);
        });
        res.on('error', () => {
          if (this.running) setTimeout(doRequest, 5000);
        });
      });

      req.on('error', () => {
        if (this.running) setTimeout(doRequest, 5000);
      });
      req.end();
    };

    doRequest();
  }

  private async handleEvent(event: any): Promise<void> {
    // Acknowledge the event
    if (event.id) {
      await this.urbitDelete(event.id).catch(() => {});
    }

    const response = event.response;
    if (!response || response === 'poke' || response === 'subscribe') return;

    // chat-store keys update → grab new messages
    if (response === 'diff' && event.json?.['chat-update']?.['message']) {
      const msg = event.json['chat-update']['message'];
      const path: string = msg.path || '';
      const envelope = msg.envelope;
      if (!envelope) return;

      const author: string = envelope.author || 'unknown';
      const text: string = envelope.letter?.text || '';
      if (!text || author === this.config.ship) return;

      const allowed = await this.checkPolicy(author, path, text);
      if (!allowed) return;

      this.emit('message', {
        id: `tlon-${envelope.uid || Date.now()}`,
        channelId: 'tlon',
        from: author,
        chatId: path,
        text,
        timestamp: new Date(envelope.when || Date.now()).toISOString(),
        isDM: path.startsWith('/~~/dm')
      });
    }
  }

  private async checkPolicy(author: string, chatId: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;

    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(author)) return true;
      await this.sendDM(author, '🦅 You are not on the allowlist.');
      return false;
    }

    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(author)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(author);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendDM(author, '🦅 Paired! You can now chat with the assistant.');
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = author;
      await this.saveState();
      await this.sendDM(author, `🦅 Pairing required. Code: ${code}\nApprove: hyperclaw pairing approve tlon ${code}`);
      return false;
    }

    return false;
  }

  async sendDM(ship: string, text: string): Promise<void> {
    const dmPath = `/~~/dm/${ship}/`;
    await this.poke('chat-hook', 'json', {
      'chat-action': {
        'message': {
          path: dmPath,
          envelope: {
            uid: Math.random().toString(36).slice(2),
            number: Date.now(),
            author: this.config.ship,
            when: Date.now(),
            letter: { text }
          }
        }
      }
    });
  }

  async sendToPath(chatPath: string, text: string): Promise<void> {
    await this.poke('chat-hook', 'json', {
      'chat-action': {
        'message': {
          path: chatPath,
          envelope: {
            uid: Math.random().toString(36).slice(2),
            number: Date.now(),
            author: this.config.ship,
            when: Date.now(),
            letter: { text }
          }
        }
      }
    });
  }

  private async poke(app: string, mark: string, json: unknown): Promise<void> {
    await this.urbitPut([{
      id: ++this.lastEventId,
      action: 'poke',
      ship: this.config.ship,
      app,
      mark,
      json
    }]);
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
  }

  private async urbitReq(method: string, p: string, body?: string, contentType?: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const url = new URL(p, this.config.shipUrl);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;
      const headers: Record<string, string> = {};
      if (this.cookie) headers['Cookie'] = this.cookie;
      if (body) {
        headers['Content-Type'] = contentType || 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }
      const req = (mod as any).request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method,
        headers
      }, (res: any) => {
        const setCookie = res.headers['set-cookie']?.[0]?.split(';')[0] || null;
        let data = '';
        res.on('data', (c: Buffer) => data += c);
        res.on('end', () => resolve(setCookie || data || null));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  private async urbitPut(actions: UrbitAction[]): Promise<void> {
    const body = JSON.stringify(actions);
    await this.urbitReq('PUT', `/~/channel/${this.channelUid}`, body);
  }

  private async urbitDelete(eventId: number): Promise<void> {
    await this.urbitReq('DELETE', `/~/channel/${this.channelUid}/${eventId}`);
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      p: this.config.pendingPairings,
      a: this.config.approvedPairings
    }, { spaces: 2 });
  }

  isRunning(): boolean { return this.running; }
}
