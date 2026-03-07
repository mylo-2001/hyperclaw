/**
 * extensions/line/src/connector.ts
 * LINE Messaging API connector — webhook receiver + reply/push API.
 *
 * Supported: DMs, group chats, rooms, media, locations, stickers,
 * Flex messages, template messages, quick replies, loading indicator.
 * Unsupported: reactions, threads.
 *
 * Webhook path: /line/webhook  (configurable via webhookPath)
 * Signature:    HMAC-SHA256 over raw body, base64-encoded (X-Line-Signature header)
 */

import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'line-state.json');
const TEXT_CHUNK = 5000;
const DEFAULT_MEDIA_MAX_MB = 10;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LINEAccountConfig {
  channelAccessToken?: string;
  channelSecret?: string;
  tokenFile?: string;
  secretFile?: string;
  webhookPath?: string;
}

export interface LINEGroupConfig {
  allowFrom?: string[];
}

export interface LINEChannelData {
  quickReplies?: string[];
  location?: {
    title: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  flexMessage?: {
    altText: string;
    contents: object;
  };
  templateMessage?: {
    type: 'confirm';
    text: string;
    confirmLabel: string;
    confirmData: string;
    cancelLabel: string;
    cancelData: string;
  };
}

export interface LINEConfig {
  channelAccessToken?: string;
  channelSecret?: string;
  /** Path to a file containing the channel access token */
  tokenFile?: string;
  /** Path to a file containing the channel secret */
  secretFile?: string;
  /** Custom webhook path (default: /line/webhook) */
  webhookPath?: string;
  /** Max media download size in MB (default: 10) */
  mediaMaxMb?: number;

  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled';
  allowFrom: string[];

  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  /** Per-group allowlist overrides */
  groups?: Record<string, LINEGroupConfig>;

  approvedPairings: string[];
  pendingPairings: Record<string, string>;

  /** Multiple named accounts (advanced) */
  accounts?: Record<string, LINEAccountConfig>;
}

// ─── LINE API helper ──────────────────────────────────────────────────────────

function lineReq(token: string, endpoint: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.line.me',
        port: 443,
        path: endpoint,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Start the LINE loading indicator for a chat. */
function lineLoadingIndicator(token: string, chatId: string): Promise<any> {
  return lineReq(token, '/v2/bot/chat/loading/start', { chatId, loadingSeconds: 20 }).catch(
    () => {}
  );
}

// ─── Markdown strip ───────────────────────────────────────────────────────────

/**
 * Strip markdown for plain-text delivery.
 * Code blocks and tables are converted to Flex cards when channelData allows;
 * for plain-text paths they become preformatted text.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, (m) => m.trimStart());
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildQuickReply(items: string[]): object {
  return {
    items: items.slice(0, 13).map((label) => ({
      type: 'action',
      action: { type: 'message', label: label.slice(0, 20), text: label }
    }))
  };
}

function buildMessages(text: string, channelData?: LINEChannelData): object[] {
  const msgs: object[] = [];
  const plain = stripMarkdown(text);
  const qr = channelData?.quickReplies?.length ? buildQuickReply(channelData.quickReplies) : undefined;

  // Location message (sent separately, no quickReply on it)
  if (channelData?.location) {
    const loc = channelData.location;
    msgs.push({ type: 'location', title: loc.title, address: loc.address, latitude: loc.latitude, longitude: loc.longitude });
  }

  // Flex message replaces text when provided
  if (channelData?.flexMessage) {
    msgs.push({
      type: 'flex',
      altText: channelData.flexMessage.altText,
      contents: channelData.flexMessage.contents,
      ...(qr ? { quickReply: qr } : {})
    });
    return msgs;
  }

  // Template message
  if (channelData?.templateMessage) {
    const t = channelData.templateMessage;
    msgs.push({
      type: 'template',
      altText: t.text,
      template: {
        type: 'confirm',
        text: t.text,
        actions: [
          { type: 'postback', label: t.confirmLabel, data: t.confirmData },
          { type: 'postback', label: t.cancelLabel, data: t.cancelData }
        ]
      },
      ...(qr ? { quickReply: qr } : {})
    });
    return msgs;
  }

  // Plain text, chunked at TEXT_CHUNK chars
  const chunks = chunkText(plain);
  chunks.forEach((chunk, i) => {
    const isLast = i === chunks.length - 1;
    msgs.push({
      type: 'text',
      text: chunk,
      ...(isLast && qr ? { quickReply: qr } : {})
    });
  });

  return msgs;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += TEXT_CHUNK) chunks.push(text.slice(i, i + TEXT_CHUNK));
  return chunks.length ? chunks : [''];
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class LINEConnector extends EventEmitter {
  config: LINEConfig;
  private running = false;
  private _token = '';
  private _secret = '';

  constructor(
    config: Partial<LINEConfig> & { channelAccessToken?: string; channelSecret?: string }
  ) {
    super();
    this.config = {
      dmPolicy: 'pairing',
      allowFrom: [],
      groupPolicy: 'allowlist',
      groupAllowFrom: [],
      approvedPairings: [],
      pendingPairings: {},
      mediaMaxMb: DEFAULT_MEDIA_MAX_MB,
      ...config
    } as LINEConfig;
  }

  /** Resolve token and secret (inline value takes priority over file). */
  private async resolveCredentials(): Promise<void> {
    this._token =
      this.config.channelAccessToken ||
      (this.config.tokenFile ? (await fs.readFile(this.config.tokenFile, 'utf8')).trim() : '');
    this._secret =
      this.config.channelSecret ||
      (this.config.secretFile ? (await fs.readFile(this.config.secretFile, 'utf8')).trim() : '');

    if (!this._token || !this._secret) {
      throw new Error(
        'LINE: channelAccessToken and channelSecret are required (or set tokenFile/secretFile).'
      );
    }
  }

  async connect(): Promise<void> {
    await this.resolveCredentials();
    await this.loadState();
    this.running = true;
    const wPath = this.config.webhookPath || '/line/webhook';
    console.log(chalk.green(`  🟩 LINE: connected (webhook mode — ${wPath})`));
    this.emit('connected', {});
  }

  disconnect(): void {
    this.running = false;
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  verifySignature(rawBody: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this._secret)
      .update(rawBody)
      .digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  // ── Webhook handler ────────────────────────────────────────────────────────

  async handleWebhook(rawBody: string, signature: string): Promise<void> {
    if (!this.verifySignature(rawBody, signature)) {
      console.log(chalk.yellow('  ⚠  LINE: invalid signature — check channelSecret'));
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return;
    }

    for (const event of payload.events || []) {
      await this.handleEvent(event);
    }
  }

  private async handleEvent(event: any): Promise<void> {
    const src = event.source || {};
    const sourceType: 'user' | 'group' | 'room' = src.type || 'user';
    const userId: string = src.userId || '';
    const groupId: string = src.groupId || src.roomId || '';
    const replyToken: string = event.replyToken || '';
    const isGroup = sourceType === 'group' || sourceType === 'room';

    // ── Postback (template confirm actions) ────────────────────────────────
    if (event.type === 'postback') {
      const data: string = event.postback?.data || '';
      if (!data || !userId) return;
      if (isGroup) {
        if (!this.isGroupAllowed(groupId, userId)) return;
      } else {
        if (!(await this.checkDMPolicy(userId, data, replyToken))) return;
      }
      this.emit('message', {
        channelId: 'line', chatId: isGroup ? groupId : userId,
        from: userId, text: data, replyToken, isDM: !isGroup
      });
      return;
    }

    // ── Only process message events beyond this point ──────────────────────
    if (event.type !== 'message') return;

    const msgType: string = event.message?.type || '';
    const messageId: string = event.message?.id || '';
    let text = '';

    switch (msgType) {
      case 'text':
        text = event.message.text || '';
        break;
      case 'location':
        text = [
          event.message.title,
          event.message.address,
          `${event.message.latitude},${event.message.longitude}`
        ]
          .filter(Boolean)
          .join(' | ');
        break;
      case 'sticker':
        text = `[sticker:${event.message.packageId}/${event.message.stickerId}]`;
        break;
      case 'image':
      case 'video':
      case 'audio':
      case 'file': {
        const maxBytes = (this.config.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB) * 1024 * 1024;
        const contentUrl = `/v2/bot/message/${messageId}/content`;
        text = `[${msgType}:${contentUrl} max:${maxBytes}b]`;
        break;
      }
      default:
        return;
    }

    if (!userId || !text) return;

    if (isGroup) {
      if (!this.isGroupAllowed(groupId, userId)) return;
      // Show loading indicator for group messages
      void lineLoadingIndicator(this._token, groupId);
      this.emit('message', {
        channelId: 'line', chatId: groupId, from: userId,
        text, replyToken, isDM: false
      });
    } else {
      const allowed = await this.checkDMPolicy(userId, text, replyToken);
      if (!allowed) return;
      // Show loading indicator for DMs
      void lineLoadingIndicator(this._token, userId);
      this.emit('message', {
        channelId: 'line', chatId: userId, from: userId,
        text, replyToken, isDM: true,
        timestamp: new Date(event.timestamp).toISOString()
      });
    }
  }

  // ── Access control ─────────────────────────────────────────────────────────

  private isGroupAllowed(groupId: string, userId: string): boolean {
    if (this.config.groupPolicy === 'disabled') return false;
    if (this.config.groupPolicy === 'open') return true;
    // allowlist
    const perGroup = this.config.groups?.[groupId]?.allowFrom;
    const list = perGroup ?? this.config.groupAllowFrom;
    return list.includes(userId) || list.includes(groupId);
  }

  private async checkDMPolicy(from: string, text: string, replyToken: string): Promise<boolean> {
    switch (this.config.dmPolicy) {
      case 'disabled':
        return false;
      case 'open':
        return true;
      case 'allowlist':
        if (this.config.allowFrom.includes(from)) return true;
        await this.replyMessage(replyToken, 'HyperClaw: Not on allowlist.');
        return false;
      case 'pairing': {
        if (this.config.approvedPairings.includes(from)) return true;
        const upper = text.trim().toUpperCase();
        if (this.config.pendingPairings[upper]) {
          this.config.approvedPairings.push(from);
          delete this.config.pendingPairings[upper];
          await this.saveState();
          await this.replyMessage(replyToken, 'Paired!');
          this.emit('pairing:approved', { userId: from, channelId: 'line' });
          return true;
        }
        const code = Array.from(
          { length: 6 },
          () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');
        this.config.pendingPairings[code] = from;
        await this.saveState();
        await this.replyMessage(
          replyToken,
          `Pairing code: ${code}\nApprove: hyperclaw pairing approve line ${code}`
        );
        return false;
      }
      default:
        return false;
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async replyMessage(replyToken: string, text: string, channelData?: LINEChannelData): Promise<void> {
    const messages = buildMessages(text, channelData).slice(0, 5);
    await lineReq(this._token, '/v2/bot/message/reply', { replyToken, messages });
  }

  async pushMessage(to: string, text: string, channelData?: LINEChannelData): Promise<void> {
    const messages = buildMessages(text, channelData).slice(0, 5);
    await lineReq(this._token, '/v2/bot/message/push', { to, messages });
  }

  /** Unified send — uses replyToken when available, falls back to push. */
  async sendMessage(chatId: string | number, text: string, replyToken?: string, channelData?: LINEChannelData): Promise<void> {
    const id = String(chatId);
    if (replyToken) {
      await this.replyMessage(replyToken, text, channelData);
    } else {
      await this.pushMessage(id, text, channelData);
    }
  }

  // ── Pairing ────────────────────────────────────────────────────────────────

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    void this.saveState();
    return true;
  }

  // ── State ──────────────────────────────────────────────────────────────────

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

  isRunning(): boolean {
    return this.running;
  }
}
