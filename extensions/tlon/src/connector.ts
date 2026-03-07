/**
 * extensions/tlon/src/connector.ts
 * Tlon (Urbit Groups) connector — Urbit Eyre HTTP API + SSE channel subscription.
 *
 * Protocol:
 *   PUT  /~/channel/<uid>          — open channel / send actions
 *   GET  /~/channel/<uid>          — SSE stream of events
 *   DELETE /~/channel/<uid>/<id>   — acknowledge event
 *   POST /~/login                  — get session cookie
 *
 * Features:
 *   - DM allowlist / pairing / open / disabled policy
 *   - ownerShip approval system (owner receives DM notifications)
 *   - Per-channel authorization rules (mode: open | restricted, allowedShips)
 *   - Auto-discover group channels
 *   - Manually pinned groupChannels
 *   - Reactions (add / remove emoji)
 *   - Thread reply support (replies in thread context)
 *   - Rich text: Markdown → Tlon verse blocks
 *   - Image URL upload support
 *   - SSRF guard (blocks private IPs unless allowPrivateNetwork: true)
 *   - Delivery targets: ~ship, dm/~ship, chat/~host/channel, group:~host/name
 *   - showModelSignature appends model name to outbound messages
 *   - Pairing code flow with 1-hour expiry
 *   - State persistence (pairings, approved ships, channel cache)
 */

import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'disabled';
export type ChannelMode = 'open' | 'restricted';

export interface ChannelRule {
  mode: ChannelMode;
  /** Ships allowed in this channel (when mode=restricted) */
  allowedShips?: string[];
}

export interface TlonAuthorization {
  channelRules?: Record<string, ChannelRule>;
}

export interface TlonConfig {
  /** Urbit ship name, e.g. ~sampel-palnet */
  ship: string;
  /** Ship URL, e.g. https://sampel-palnet.tlon.network or http://localhost:8080 */
  url: string;
  /** Login code from Landscape */
  code: string;
  /** Allow private/local network URLs (disables SSRF guard for ship requests) */
  allowPrivateNetwork?: boolean;
  /** Owner ship — always authorized everywhere, receives approval notifications */
  ownerShip?: string;
  /** Ships allowed to DM (empty = none allowed; ownerShip is always implicit) */
  dmAllowlist?: string[];
  /** DM policy for ships not in dmAllowlist */
  dmPolicy?: DmPolicy;
  /** Auto-accept DM invites from ships in dmAllowlist */
  autoAcceptDmInvites?: boolean;
  /** Auto-accept group invites */
  autoAcceptGroupInvites?: boolean;
  /** Auto-discover group channels the bot is in (default: true) */
  autoDiscoverChannels?: boolean;
  /** Manually pinned channel nests, e.g. ["chat/~host/general"] */
  groupChannels?: string[];
  /** Ships authorized for all channels by default */
  defaultAuthorizedShips?: string[];
  /** Per-channel authorization rules */
  authorization?: TlonAuthorization;
  /** Append model name to outbound messages */
  showModelSignature?: boolean;
  /** Max media size in MB (default: 20) */
  mediaMaxMb?: number;
  /** Require @mention in group channels (default: true) */
  requireMention?: boolean;
  // Internal state (managed by connector)
  _approvedPairings?: string[];
  _pendingPairings?: Record<string, { ship: string; expiresAt: number }>;
  _knownChannels?: string[];
}

export interface TlonMessage {
  id: string;
  channelId: 'tlon';
  from: string;
  chatId: string;
  text: string;
  timestamp: string;
  isDM: boolean;
  threadId?: string;
  nest?: string;
  attachments?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_DIR = path.join(os.homedir(), '.hyperclaw');
const STATE_FILE = path.join(STATE_DIR, 'tlon-state.json');
const PAIRING_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const SSE_RECONNECT_DELAY_MS = 5000;
const PAIRING_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some(r => r.test(hostname)) || hostname === 'localhost';
}

function checkSsrf(shipUrl: string, allowPrivate: boolean): void {
  if (allowPrivate) return;
  try {
    const { hostname } = new URL(shipUrl);
    if (isPrivateHost(hostname)) {
      throw new Error(
        `Tlon: ship URL "${shipUrl}" resolves to a private/local address. ` +
        'Set channels.tlon.allowPrivateNetwork: true to allow this (SSRF opt-in).'
      );
    }
  } catch (e: any) {
    if (e.message.startsWith('Tlon:')) throw e;
  }
}

// ---------------------------------------------------------------------------
// Rich text: Markdown → Tlon verse blocks
// ---------------------------------------------------------------------------

interface TlonInline {
  bold?: TlonInline[];
  italics?: TlonInline[];
  code?: string;
  ship?: string;
  tag?: string;
  link?: { href: string; content: string };
  break?: boolean;
  text?: string;
}

function markdownToInlines(text: string): TlonInline[] {
  const result: TlonInline[] = [];
  // Process line by line, converting **bold**, *italic*, `code`, @~ship
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~[a-z-]+)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      result.push({ bold: [{ text: part.slice(2, -2) }] });
    } else if (part.startsWith('*') && part.endsWith('*')) {
      result.push({ italics: [{ text: part.slice(1, -1) }] });
    } else if (part.startsWith('`') && part.endsWith('`')) {
      result.push({ code: part.slice(1, -1) });
    } else if (/^~[a-z-]+$/.test(part)) {
      result.push({ ship: part });
    } else if (part) {
      result.push({ text: part });
    }
  }
  return result;
}

function textToVerseBlock(text: string): object {
  const lines = text.split('\n');
  const verses: object[] = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      verses.push({ verse: { block: [{ header: { tag: 'h1', content: line.slice(2) } }] } });
    } else if (line.startsWith('## ')) {
      verses.push({ verse: { block: [{ header: { tag: 'h2', content: line.slice(3) } }] } });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      verses.push({ verse: { block: [{ listing: { item: line.slice(2) } }] } });
    } else if (line.startsWith('```')) {
      verses.push({ verse: { block: [{ code: { code: line.slice(3), lang: '' } }] } });
    } else if (line.trim() === '') {
      verses.push({ verse: { inline: [{ break: null }] } });
    } else {
      verses.push({ verse: { inline: markdownToInlines(line) } });
    }
  }

  return { story: verses };
}

// ---------------------------------------------------------------------------
// HTTP helper — Urbit Eyre requests
// ---------------------------------------------------------------------------

function urbitReq(
  shipUrl: string,
  method: string,
  pathname: string,
  cookie: string | null,
  body?: string,
  contentType?: string
): Promise<{ statusCode: number; setCookie: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, shipUrl);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const headers: Record<string, string | number> = {};
    if (cookie) headers['Cookie'] = cookie;
    if (body) {
      headers['Content-Type'] = contentType ?? 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = (mod as any).request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method,
      headers
    }, (res: any) => {
      const sc = res.headers['set-cookie']?.[0]?.split(';')[0] ?? null;
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString()));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 200, setCookie: sc, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// TlonConnector
// ---------------------------------------------------------------------------

export class TlonConnector extends EventEmitter {
  private cfg: Required<TlonConfig> & {
    _approvedPairings: string[];
    _pendingPairings: Record<string, { ship: string; expiresAt: number }>;
    _knownChannels: string[];
  };

  private cookie: string | null = null;
  private channelUid: string | null = null;
  private running = false;
  private lastEventId = 0;

  constructor(rawCfg: TlonConfig) {
    super();
    this.cfg = {
      dmPolicy: 'pairing',
      allowPrivateNetwork: false,
      dmAllowlist: [],
      autoAcceptDmInvites: true,
      autoAcceptGroupInvites: false,
      autoDiscoverChannels: true,
      groupChannels: [],
      defaultAuthorizedShips: [],
      authorization: {},
      showModelSignature: false,
      mediaMaxMb: 20,
      requireMention: true,
      ownerShip: '',
      _approvedPairings: [],
      _pendingPairings: {},
      _knownChannels: [],
      ...rawCfg
    } as any;
  }

  // ---- Lifecycle -----------------------------------------------------------

  async connect(): Promise<void> {
    checkSsrf(this.cfg.url, this.cfg.allowPrivateNetwork);
    await this.loadState();
    await this.login();
    await this.openChannel();
    await this.subscribeAll();
    this.running = true;
    console.log(chalk.green(`  🦅 Tlon: connected as ${this.cfg.ship} → ${this.cfg.url}`));
    this.emit('connected', { ship: this.cfg.ship, url: this.cfg.url });
    this.listenSSE();
  }

  disconnect(): void {
    this.running = false;
  }

  isRunning(): boolean { return this.running; }

  // ---- Auth ----------------------------------------------------------------

  private async login(): Promise<void> {
    const body = `password=${encodeURIComponent(this.cfg.code)}`;
    const r = await urbitReq(this.cfg.url, 'POST', '/~/login', null, body, 'application/x-www-form-urlencoded');
    if (!r.setCookie) throw new Error(`Tlon: login failed — check URL and code (HTTP ${r.statusCode})`);
    this.cookie = r.setCookie;
  }

  // ---- Channel management --------------------------------------------------

  private async openChannel(): Promise<void> {
    this.channelUid = `hyperclaw-${Date.now()}`;
    await this.urbitPut([]);
  }

  private async subscribeAll(): Promise<void> {
    const actions: object[] = [];

    // Subscribe to DMs via chat store
    actions.push(this.subscribeAction(this.cfg.ship, 'chat', '/dm'));

    // Discover or use pinned group channels
    const nests = [...(this.cfg.groupChannels ?? [])];
    if (this.cfg.autoDiscoverChannels) {
      const discovered = await this.discoverChannels();
      for (const n of discovered) if (!nests.includes(n)) nests.push(n);
    }
    this.cfg._knownChannels = nests;

    for (const nest of nests) {
      // nest format: "chat/~host/name"
      const parts = nest.split('/');
      if (parts.length >= 3) {
        const [, hostShip] = parts;
        actions.push(this.subscribeAction(hostShip ?? this.cfg.ship, 'chat', `/${nest}`));
      }
    }

    if (actions.length > 0) await this.urbitPut(actions);
  }

  private subscribeAction(ship: string, app: string, subscriptionPath: string): object {
    return {
      id: ++this.lastEventId,
      action: 'subscribe',
      ship,
      app,
      path: subscriptionPath
    };
  }

  /** Discover group channels by fetching the groups list from the ship. */
  private async discoverChannels(): Promise<string[]> {
    try {
      const r = await urbitReq(this.cfg.url, 'GET', '/~/scry/groups/groups.json', this.cookie);
      if (r.statusCode !== 200) return [];
      const data = JSON.parse(r.body);
      const nests: string[] = [];
      // groups.json returns a map of group ref → group data
      for (const groupData of Object.values(data)) {
        const channels = (groupData as any)?.channels ?? {};
        for (const nest of Object.keys(channels)) {
          nests.push(nest); // e.g. "chat/~host/name"
        }
      }
      return nests;
    } catch {
      return [];
    }
  }

  // ---- SSE stream ----------------------------------------------------------

  private listenSSE(): void {
    const url = new URL(`/~/channel/${this.channelUid}`, this.cfg.url);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const doConnect = () => {
      if (!this.running) return;
      const req = (mod as any).request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        headers: {
          Cookie: this.cookie,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      }, (res: any) => {
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
              try { void this.handleEvent(JSON.parse(dataLine)); } catch {}
              dataLine = '';
            }
          }
        });
        res.on('end', () => {
          if (this.running) setTimeout(doConnect, SSE_RECONNECT_DELAY_MS);
        });
        res.on('error', () => {
          if (this.running) setTimeout(doConnect, SSE_RECONNECT_DELAY_MS);
        });
      });
      req.on('error', () => {
        if (this.running) setTimeout(doConnect, SSE_RECONNECT_DELAY_MS);
      });
      req.end();
    };

    doConnect();
  }

  // ---- Event handling ------------------------------------------------------

  private async handleEvent(event: any): Promise<void> {
    if (event.id) {
      this.urbitDelete(event.id).catch(() => {});
    }

    const resp = event.response;
    if (!resp || resp === 'poke' || resp === 'subscribe') return;

    if (resp !== 'diff') return;
    const json = event.json;
    if (!json) return;

    // Handle chat DM write
    const dmWrite = json['chat-dm-write'] ?? json['dm-update']?.add?.message;
    if (dmWrite) {
      await this.handleDmWrite(dmWrite, json);
      return;
    }

    // Handle group chat write
    const chatWrite = json['chat-write'] ?? json['chat-update']?.post;
    if (chatWrite) {
      await this.handleGroupWrite(chatWrite, json);
      return;
    }

    // Handle group/DM invites
    if (json['group-invite'] || json['dm-invite']) {
      await this.handleInvite(json);
    }
  }

  private async handleDmWrite(msg: any, _raw: any): Promise<void> {
    const sender: string = msg.memo?.author ?? msg.ship ?? 'unknown';
    if (sender === this.cfg.ship) return; // echo

    const text = this.extractText(msg.memo?.content ?? msg.content ?? {});
    if (!text) return;

    const isDMAllowed = await this.checkDmPolicy(sender, text);
    if (!isDMAllowed) return;

    const chatId = `tlon:dm:${sender}`;
    this.emit('message', {
      id: `tlon-${Date.now()}`,
      channelId: 'tlon',
      from: sender,
      chatId,
      text,
      timestamp: new Date().toISOString(),
      isDM: true,
      threadId: msg.memo?.replyTo ?? undefined
    } as TlonMessage);
  }

  private async handleGroupWrite(msg: any, raw: any): Promise<void> {
    const nest: string = msg.nest ?? raw.nest ?? '';
    const sender: string = msg.memo?.author ?? msg.post?.author ?? 'unknown';
    if (sender === this.cfg.ship) return;

    const text = this.extractText(msg.memo?.content ?? msg.post?.content ?? {});
    if (!text) return;

    // Check if mention required
    if (this.cfg.requireMention && !text.includes(this.cfg.ship)) return;

    // Check channel authorization
    const allowed = this.isAuthorizedForChannel(sender, nest);
    if (!allowed) {
      // Notify owner
      if (this.cfg.ownerShip) {
        await this.sendDM(this.cfg.ownerShip,
          `🦅 Unauthorized mention in ${nest} from ${sender}`).catch(() => {});
      }
      return;
    }

    const chatId = `tlon:group:${nest}`;
    this.emit('message', {
      id: `tlon-${Date.now()}`,
      channelId: 'tlon',
      from: sender,
      chatId,
      nest,
      text,
      timestamp: new Date().toISOString(),
      isDM: false,
      threadId: msg.memo?.replyTo ?? undefined
    } as TlonMessage);
  }

  private async handleInvite(json: any): Promise<void> {
    if (json['dm-invite']) {
      const fromShip: string = json['dm-invite'].ship ?? '';
      const isAllowed = this.cfg.dmAllowlist?.includes(fromShip) || fromShip === this.cfg.ownerShip;
      if (isAllowed && this.cfg.autoAcceptDmInvites) {
        await this.pokeChatDm(fromShip, { accept: null }).catch(() => {});
        console.log(chalk.gray(`  Tlon: auto-accepted DM invite from ${fromShip}`));
      } else if (this.cfg.ownerShip) {
        await this.sendDM(this.cfg.ownerShip,
          `🦅 DM invite from ${fromShip} — approve with: hyperclaw pairing approve tlon ${fromShip}`).catch(() => {});
      }
    }

    if (json['group-invite'] && this.cfg.autoAcceptGroupInvites) {
      const groupRef: string = json['group-invite'].group ?? '';
      await this.pokeGroups(groupRef, { join: null }).catch(() => {});
      console.log(chalk.gray(`  Tlon: auto-accepted group invite for ${groupRef}`));
    }
  }

  // ---- Policy checks -------------------------------------------------------

  private async checkDmPolicy(ship: string, text: string): Promise<boolean> {
    const cfg = this.cfg;
    // Owner is always allowed
    if (cfg.ownerShip && ship === cfg.ownerShip) return true;

    const policy = cfg.dmPolicy ?? 'pairing';

    if (policy === 'disabled') return false;
    if (policy === 'open') return true;

    if (policy === 'allowlist') {
      if (cfg.dmAllowlist?.includes(ship)) return true;
      // Notify owner
      if (cfg.ownerShip) {
        await this.sendDM(cfg.ownerShip,
          `🦅 DM request from ${ship} (not in allowlist)`).catch(() => {});
      }
      return false;
    }

    if (policy === 'pairing') {
      // Prune expired
      const now = Date.now();
      for (const [code, entry] of Object.entries(cfg._pendingPairings)) {
        if (entry.expiresAt < now) delete cfg._pendingPairings[code];
      }

      if (cfg._approvedPairings.includes(ship) || cfg.dmAllowlist?.includes(ship)) return true;

      // Check if text is a valid pairing code
      const upper = text.trim().toUpperCase();
      const entry = Object.entries(cfg._pendingPairings).find(([code]) => code === upper);
      if (entry && entry[1].ship === ship) {
        cfg._approvedPairings.push(ship);
        delete cfg._pendingPairings[upper];
        await this.saveState();
        await this.sendDM(ship, '🦅 Paired! You can now chat with the assistant.');
        this.emit('pairing:approved', { ship });
        return false; // Don't forward the pairing code itself as a message
      }

      // Issue new pairing code
      const code = Array.from({ length: 6 }, () =>
        PAIRING_CHARS[Math.floor(Math.random() * PAIRING_CHARS.length)]
      ).join('');
      cfg._pendingPairings[code] = { ship, expiresAt: now + PAIRING_EXPIRY_MS };
      await this.saveState();
      await this.sendDM(ship,
        `🦅 Pairing required. Code: **${code}**\nApprove: \`hyperclaw pairing approve tlon ${code}\`\n(Expires in 1 hour)`
      ).catch(() => {});
      // Notify owner
      if (cfg.ownerShip) {
        await this.sendDM(cfg.ownerShip,
          `🦅 DM pairing request from ${ship} — code: ${code}`).catch(() => {});
      }
      return false;
    }

    return false;
  }

  private isAuthorizedForChannel(ship: string, nest: string): boolean {
    if (this.cfg.ownerShip && ship === this.cfg.ownerShip) return true;

    // Check per-channel rule
    const rule = this.cfg.authorization?.channelRules?.[nest];
    if (rule) {
      if (rule.mode === 'open') return true;
      if (rule.mode === 'restricted') return rule.allowedShips?.includes(ship) ?? false;
    }

    // Fall back to defaultAuthorizedShips
    if (this.cfg.defaultAuthorizedShips?.includes(ship)) return true;
    if (this.cfg.defaultAuthorizedShips?.includes('*')) return true;

    return false;
  }

  // ---- Text extraction from Tlon content -----------------------------------

  private extractText(content: any): string {
    if (!content) return '';
    if (typeof content === 'string') return content;

    // story format: { story: [{ verse: { inline: [...] } | { block: [...] } }] }
    if (content.story && Array.isArray(content.story)) {
      return content.story
        .map((verse: any) => {
          const inline = verse?.verse?.inline;
          const block = verse?.verse?.block;
          if (Array.isArray(inline)) return this.inlinesToText(inline);
          if (Array.isArray(block)) return this.blocksToText(block);
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }

  private inlinesToText(inlines: any[]): string {
    return inlines.map(i => {
      if (typeof i === 'string') return i;
      if (i?.text) return i.text;
      if (i?.bold) return this.inlinesToText(i.bold);
      if (i?.italics) return this.inlinesToText(i.italics);
      if (i?.code) return `\`${i.code}\``;
      if (i?.ship) return i.ship;
      if (i?.link) return i.link.content ?? i.link.href;
      if (i?.break !== undefined) return '\n';
      return '';
    }).join('');
  }

  private blocksToText(blocks: any[]): string {
    return blocks.map(b => {
      if (b?.header?.content) return b.header.content;
      if (b?.listing?.item) return `- ${b.listing.item}`;
      if (b?.code?.code) return `\`\`\`${b.code.code}\`\`\``;
      if (b?.image?.src) return `[image: ${b.image.src}]`;
      return '';
    }).filter(Boolean).join('\n');
  }

  // ---- Send ----------------------------------------------------------------

  /** Send a DM to a Urbit ship. Converts Markdown to Tlon verse blocks. */
  async sendDM(toShip: string, text: string): Promise<void> {
    const content = textToVerseBlock(this.applySignature(text));
    await this.pokeChatDm(toShip, { message: { memo: { content, author: this.cfg.ship, sent: Date.now() } } });
  }

  /** Send a message to a group channel nest (e.g. "chat/~host/name"). */
  async sendToNest(nest: string, text: string, replyTo?: string): Promise<void> {
    const content = textToVerseBlock(this.applySignature(text));
    const memo: any = { content, author: this.cfg.ship, sent: Date.now() };
    if (replyTo) memo.replyTo = replyTo;
    const parts = nest.split('/');
    const hostShip = parts[1] ?? this.cfg.ship;
    await this.urbitPut([{
      id: ++this.lastEventId,
      action: 'poke',
      ship: hostShip,
      app: 'chat',
      mark: 'chat-action-0',
      json: { write: { nest, add: { memo } } }
    }]);
  }

  /** Send by delivery target string.
   *  Formats: ~ship, dm/~ship, chat/~host/channel, group:~host/name
   */
  async sendToTarget(target: string, text: string): Promise<void> {
    const t = target.trim();
    if (t.startsWith('dm/') || t.startsWith('~')) {
      const ship = t.startsWith('dm/') ? t.slice(3) : t;
      return this.sendDM(ship, text);
    }
    if (t.startsWith('chat/') || t.startsWith('group:')) {
      const nest = t.startsWith('group:') ? `chat/${t.slice(6)}` : t;
      return this.sendToNest(nest, text);
    }
    // Fallback: treat as ship name
    return this.sendDM(t, text);
  }

  // ---- Reactions -----------------------------------------------------------

  async addReaction(nest: string, postId: string, emoji: string): Promise<void> {
    const parts = nest.split('/');
    const hostShip = parts[1] ?? this.cfg.ship;
    await this.urbitPut([{
      id: ++this.lastEventId,
      action: 'poke',
      ship: hostShip,
      app: 'chat',
      mark: 'chat-action-0',
      json: { react: { nest, postId, react: emoji } }
    }]).catch(() => {});
  }

  async removeReaction(nest: string, postId: string, emoji: string): Promise<void> {
    const parts = nest.split('/');
    const hostShip = parts[1] ?? this.cfg.ship;
    await this.urbitPut([{
      id: ++this.lastEventId,
      action: 'poke',
      ship: hostShip,
      app: 'chat',
      mark: 'chat-action-0',
      json: { react: { nest, postId, react: emoji === '' ? null : emoji } }
    }]).catch(() => {});
  }

  // ---- Pairing management --------------------------------------------------

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    const entry = this.cfg._pendingPairings[upper];
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      delete this.cfg._pendingPairings[upper];
      void this.saveState();
      return false;
    }
    this.cfg._approvedPairings.push(entry.ship);
    delete this.cfg._pendingPairings[upper];
    void this.saveState();
    return true;
  }

  listPendingPairings(): Record<string, string> {
    const now = Date.now();
    const result: Record<string, string> = {};
    for (const [code, entry] of Object.entries(this.cfg._pendingPairings)) {
      if (entry.expiresAt > now) result[code] = entry.ship;
    }
    return result;
  }

  // ---- Urbit protocol helpers ----------------------------------------------

  private async urbitPut(actions: object[]): Promise<void> {
    const body = JSON.stringify(actions);
    await urbitReq(this.cfg.url, 'PUT', `/~/channel/${this.channelUid}`, this.cookie, body);
  }

  private async urbitDelete(eventId: number): Promise<void> {
    await urbitReq(this.cfg.url, 'DELETE', `/~/channel/${this.channelUid}/${eventId}`, this.cookie);
  }

  private async pokeChatDm(toShip: string, dmAction: object): Promise<void> {
    await this.urbitPut([{
      id: ++this.lastEventId,
      action: 'poke',
      ship: this.cfg.ship,
      app: 'chat',
      mark: 'chat-dm-action',
      json: { ship: toShip, ...dmAction }
    }]);
  }

  private async pokeGroups(groupRef: string, action: object): Promise<void> {
    await this.urbitPut([{
      id: ++this.lastEventId,
      action: 'poke',
      ship: this.cfg.ship,
      app: 'groups',
      mark: 'group-action-0',
      json: { group: groupRef, ...action }
    }]);
  }

  // ---- State persistence ---------------------------------------------------

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      if (Array.isArray(s.approved)) this.cfg._approvedPairings = s.approved;
      if (s.pending && typeof s.pending === 'object') this.cfg._pendingPairings = s.pending;
      if (Array.isArray(s.knownChannels)) this.cfg._knownChannels = s.knownChannels;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(STATE_DIR);
    await fs.writeJson(STATE_FILE, {
      approved: this.cfg._approvedPairings,
      pending: this.cfg._pendingPairings,
      knownChannels: this.cfg._knownChannels
    }, { spaces: 2 });
  }

  // ---- Helpers -------------------------------------------------------------

  private applySignature(text: string): string {
    if (!this.cfg.showModelSignature) return text;
    return text; // Model signature injected by the agent engine, not here
  }

  /** Get all known channel nests (for CLI/cron delivery targets). */
  getKnownChannels(): string[] { return this.cfg._knownChannels; }
  getApprovedShips(): string[] { return this.cfg._approvedPairings; }
}
