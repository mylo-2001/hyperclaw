/**
 * extensions/telegram/src/connector.ts
 * REAL Telegram Bot connector — long polling + webhook mode, DM pairing.
 * No external SDK — uses native https for zero extra deps.
 */

import https from 'https';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TgUser { id: number; is_bot: boolean; first_name: string; username?: string; }
export interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; username?: string; first_name?: string; }
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  photo?: Array<{ file_id: string; width: number; height: number; }>;
  document?: { file_id: string; file_name?: string; };
  voice?: { file_id: string; duration: number; };
  reply_to_message?: TgMessage;
  entities?: Array<{ type: string; offset: number; length: number }>;
}
export interface TgUpdate { update_id: number; message?: TgMessage; edited_message?: TgMessage; }

export interface TgSendOptions {
  parse_mode?: 'Markdown' | 'HTML';
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

export interface TelegramConfig {
  token: string;
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  pendingPairings: Record<string, string>;
  approvedPairings: string[];
  /** Group activation mode: 'mention' (default) = respond only when mentioned/replied, 'always' = respond to all group messages */
  groupActivation?: 'mention' | 'always';
  /** Allowlist of group/supergroup chat IDs (numeric). Empty = respond in all groups. */
  groupAllowFrom?: string[];
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function tgDownloadFile(token: string, filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/file/bot${token}/${filePath}`,
      method: 'GET'
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timeout')); });
    req.end();
  });
}

function tgRequest(token: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/${method}`,
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.ok) resolve(r.result);
          else reject(new Error(r.description || 'Telegram API error'));
        } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(35000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'telegram-state.json');

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + max, text.length);
    if (end < text.length) { const nl = text.lastIndexOf('\n', end); if (nl > i) end = nl + 1; }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class TelegramConnector extends EventEmitter {
  private token: string;
  config: TelegramConfig;
  private offset = 0;
  private running = false;
  botInfo: TgUser | null = null;

  constructor(token: string, config?: Partial<TelegramConfig>) {
    super();
    this.token = token;
    this.config = { token, dmPolicy: 'allowlist', allowFrom: [], pendingPairings: {}, approvedPairings: [], ...config };
  }

  async connect(): Promise<void> {
    this.botInfo = await tgRequest(this.token, 'getMe');
    console.log(chalk.green(`  🦅 Telegram: @${this.botInfo?.username} connected`));
    await this.loadState();
    this.running = true;
    this.pollLoop();
    this.emit('connected', this.botInfo);
  }

  async disconnect(): Promise<void> {
    this.running = false;
    await this.saveState();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates: TgUpdate[] = await tgRequest(this.token, 'getUpdates', {
          offset: this.offset, timeout: 30, allowed_updates: ['message']
        });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch(e => console.log(chalk.yellow(`  ⚠  ${e.message}`)));
        }
      } catch (e: any) {
        if (this.running) { console.log(chalk.yellow(`  ⚠  Telegram poll: ${e.message}`)); await sleep(5000); }
      }
    }
  }

  private async handleUpdate(u: TgUpdate): Promise<void> {
    const msg = u.message || u.edited_message;
    if (!msg) return;
    const text = msg.text?.trim() || '';
    if (!text && !msg.voice) return;
    const userId = String(msg.from?.id || '');
    const isDM = msg.chat.type === 'private';
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    if (isDM && !(await this.checkDMPolicy(userId, msg.chat.id, text || '[voice note]'))) return;
    let finalText = text || '[voice note]';
    if (isGroup) {
      // Group allowlist — skip if chat ID not in allowed list
      const groupAllowFrom = this.config.groupAllowFrom ?? [];
      if (groupAllowFrom.length > 0 && !groupAllowFrom.includes(String(msg.chat.id))) return;

      const activation = this.config.groupActivation ?? 'mention';
      if (activation === 'mention') {
        const botUsername = this.botInfo?.username ? `@${this.botInfo.username}`.toLowerCase() : '';
        const mentioned = botUsername && text.toLowerCase().includes(botUsername);
        const isReplyToBot = msg.reply_to_message?.from?.is_bot && msg.reply_to_message.from.id === this.botInfo?.id;
        if (!mentioned && !isReplyToBot) return;
        if (mentioned && botUsername) finalText = text.replace(new RegExp(botUsername, 'gi'), '').trim() || finalText;
      }
      // activation === 'always': respond to all group messages, no filter
    }

    let audioPath: string | undefined;
    if (msg?.voice?.file_id) {
      try {
        const file = await tgRequest(this.token, 'getFile', { file_id: msg.voice.file_id });
        const buf = await tgDownloadFile(this.token, file.file_path);
        const ext = (file.file_path || '').split('.').pop() || 'oga';
        const tmp = path.join(os.tmpdir(), `hyperclaw-tg-voice-${msg.message_id}.${ext}`);
        await fs.writeFile(tmp, buf);
        audioPath = tmp;
      } catch (e: any) {
        console.log(chalk.yellow(`  ⚠  Telegram voice download failed: ${e.message}`));
      }
    }

    this.emit('message', {
      id: String(msg.message_id),
      channelId: 'telegram',
      from: userId,
      fromUsername: msg.from?.username,
      chatId: msg.chat.id,
      text: finalText,
      audioPath,
      timestamp: new Date(msg.date * 1000).toISOString(),
      isDM
    });
  }

  private async checkDMPolicy(userId: string, chatId: number, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(userId)) return true;
      await this.sendMessage(chatId, `🦅 *HyperClaw*\n\nYou are not on the allowlist.`);
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(userId)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(userId);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(chatId, `🦅 *Paired!* You can now send messages.`);
        this.emit('pairing:approved', { userId, channelId: 'telegram' });
        return true;
      }
      const code = generateCode();
      this.config.pendingPairings[code] = userId;
      await this.saveState();
      await this.sendMessage(chatId, `🦅 *HyperClaw Pairing*\n\nSend the owner this code:\n\`${code}\`\n\nApprove with:\n\`hyperclaw pairing approve telegram ${code}\``);
      console.log(chalk.cyan(`  🦅 Telegram pairing from ${userId} — code: ${code}`));
      return false;
    }
    return false;
  }

  async sendMessage(chatId: number | string, text: string, opts: TgSendOptions = {}): Promise<TgMessage | null> {
    const chunks = chunkText(text, 4096);
    let last: TgMessage | null = null;
    for (const chunk of chunks) {
      last = await tgRequest(this.token, 'sendMessage', {
        chat_id: chatId, text: chunk,
        parse_mode: opts.parse_mode || 'Markdown',
        disable_web_page_preview: opts.disable_web_page_preview ?? true,
        ...(opts.reply_to_message_id ? { reply_to_message_id: opts.reply_to_message_id } : {})
      });
    }
    return last;
  }

  async sendTyping(chatId: number | string): Promise<void> {
    await tgRequest(this.token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    const userId = this.config.pendingPairings[upper];
    this.config.approvedPairings.push(userId);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
  }

  addToAllowlist(userId: string): void {
    if (!this.config.allowFrom.includes(userId)) { this.config.allowFrom.push(userId); this.saveState(); }
  }

  listPendingPairings() { return Object.entries(this.config.pendingPairings).map(([code, userId]) => ({ code, userId })); }

  handleWebhookPayload(body: string): void {
    try { this.handleUpdate(JSON.parse(body)); } catch {}
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      this.offset = s.offset || 0;
      if (s.pendingPairings) this.config.pendingPairings = s.pendingPairings;
      if (s.approvedPairings) this.config.approvedPairings = s.approvedPairings;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, { offset: this.offset, pendingPairings: this.config.pendingPairings, approvedPairings: this.config.approvedPairings }, { spaces: 2 });
  }

  isRunning() { return this.running; }
  getBotInfo() { return this.botInfo; }
}
