/**
 * extensions/whatsapp-baileys/src/connector.ts
 * WhatsApp via Baileys (WhatsApp Web) — alternative to Cloud API.
 * No Meta Business account needed. Uses personal WhatsApp via QR scan.
 *
 * Setup:
 * 1. npm install @whiskeysockets/baileys
 * 2. hyperclaw channels add whatsapp-baileys
 * 3. Scan QR code on first run (auth state saved in ~/.hyperclaw/baileys-auth)
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const AUTH_DIR = path.join(os.homedir(), '.hyperclaw', 'baileys-auth');
const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'whatsapp-baileys-state.json');

export interface WhatsAppBaileysConfig {
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

export class WhatsAppBaileysConnector extends EventEmitter {
  config: WhatsAppBaileysConfig;
  private sock: any = null;
  private running = false;
  private qrCallback?: (qr: string) => void;

  constructor(config: Partial<WhatsAppBaileysConfig> = {}) {
    super();
    this.config = {
      dmPolicy: 'allowlist',
      allowFrom: [],
      approvedPairings: [],
      pendingPairings: {},
      ...config
    } as WhatsAppBaileysConfig;
  }

  onQR(cb: (qr: string) => void): void {
    this.qrCallback = cb;
  }

  async connect(): Promise<void> {
    try {
      const makeWASocket = require('@whiskeysockets/baileys');
      const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
    } catch {
      throw new Error('Baileys not installed. Run: npm install @whiskeysockets/baileys');
    }

    const makeWASocket = require('@whiskeysockets/baileys').default;
    const { useMultiFileAuthState } = require('@whiskeysockets/baileys');

    await fs.ensureDir(AUTH_DIR);
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    await this.loadState();

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      generateHighQualityLinkPreview: false
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (upd: any) => {
      if (upd.qr) this.qrCallback?.(upd.qr);
      if (upd.connection === 'open') {
        console.log(chalk.green('  🦅 WhatsApp Baileys: connected'));
        this.emit('connected', {});
      }
      if (upd.connection === 'close') this.emit('disconnected', upd);
    });

    this.sock.ev.on('messages.upsert', async ({ messages }: any) => {
      for (const m of messages) {
        if (m.key.fromMe) continue;
        const msg = m.message;
        if (!msg) continue;

        let text = msg.conversation || msg.extendedTextMessage?.text || '';
        const from = (m.key.remoteJid || '').replace(/@.*/, '');

        // Voice note: download to temp, emit with audioPath for transcription hook
        if (msg.audioMessage || msg.pttMessage) {
          let audioPath: string | undefined;
          try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buf = await downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: this.sock?.updateMessageSent });
            const tmp = path.join(os.tmpdir(), `hyperclaw-voice-${m.key.id}.ogg`);
            await fs.writeFile(tmp, buf);
            audioPath = tmp;
          } catch {}
          this.emit('message', {
            id: m.key.id,
            channelId: 'whatsapp-baileys',
            from,
            chatId: m.key.remoteJid,
            text: '[voice note]',
            audioPath,
            timestamp: new Date(parseInt(m.messageTimestamp || '0') * 1000).toISOString(),
            isDM: true
          });
          continue;
        }

        if (!text) continue;

        const allowed = await this.checkDMPolicy(from, text);
        if (!allowed) continue;

        this.emit('message', {
          id: m.key.id,
          channelId: 'whatsapp-baileys',
          from,
          chatId: m.key.remoteJid,
          text,
          timestamp: new Date(parseInt(m.messageTimestamp) * 1000).toISOString(),
          isDM: true
        });
      }
    });

    this.running = true;
  }

  private async checkDMPolicy(from: string, text: string): Promise<boolean> {
    if (this.config.dmPolicy === 'none') return false;
    if (this.config.dmPolicy === 'open') return true;
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) return true;
      await this.sendMessage(from, '🦅 HyperClaw: Not on allowlist.').catch(() => {});
      return false;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) return true;
      const upper = text.trim().toUpperCase();
      if (this.config.pendingPairings[upper]) {
        this.config.approvedPairings.push(from);
        delete this.config.pendingPairings[upper];
        await this.saveState();
        await this.sendMessage(from, '🦅 Paired!').catch(() => {});
        this.emit('pairing:approved', { userId: from, channelId: 'whatsapp-baileys' });
        return true;
      }
      const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[code] = from;
      await this.saveState();
      await this.sendMessage(from, `🦅 Code: ${code}\nApprove: hyperclaw pairing approve whatsapp-baileys ${code}`).catch(() => {});
      return false;
    }
    return false;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock) return;
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text: text.slice(0, 4096) });
  }

  disconnect(): void {
    this.running = false;
    this.sock?.end?.();
    this.sock = null;
  }

  approvePairing(code: string): boolean {
    const upper = code.toUpperCase();
    if (!this.config.pendingPairings[upper]) return false;
    this.config.approvedPairings.push(this.config.pendingPairings[upper]);
    delete this.config.pendingPairings[upper];
    this.saveState();
    return true;
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
    await fs.writeJson(STATE_FILE, { p: this.config.pendingPairings, a: this.config.approvedPairings }, { spaces: 2 });
  }
  isRunning(): boolean { return this.running; }
}
