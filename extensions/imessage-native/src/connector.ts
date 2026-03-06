/**
 * extensions/imessage-native/src/connector.ts
 * iMessage via imsg CLI (github.com/steipete/imsg) — macOS native, no BlueBubbles.
 * Requires: imsg installed, Full Disk Access + Automation for Terminal/Node.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);
const IMSC_PATH = process.env.IMSG_PATH || 'imsg';
const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'imessage-native-state.json');

export interface IMessageNativeConfig {
  dmPolicy: 'open' | 'allowlist' | 'pairing' | 'none';
  allowFrom: string[];
  approvedPairings: string[];
  pendingPairings: Record<string, string>;
}

export class IMessageNativeConnector extends EventEmitter {
  config: IMessageNativeConfig;
  private watchProc: ReturnType<typeof spawn> | null = null;
  private running = false;
  private lastMessageTs = 0;

  constructor(config: Partial<IMessageNativeConfig> = {}) {
    super();
    this.config = {
      dmPolicy: config.dmPolicy ?? 'pairing',
      allowFrom: config.allowFrom ?? [],
      approvedPairings: config.approvedPairings ?? [],
      pendingPairings: config.pendingPairings ?? {}
    };
  }

  async connect(): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('imessage-native is macOS only. Use BlueBubbles on other platforms.');
    }
    await this.loadState();
    this.running = true;
    this.emit('connected', {});
    this.startWatch();
  }

  private startWatch(): void {
    if (!this.running) return;
    this.watchProc = spawn(IMSC_PATH, ['watch', '--output', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let buf = '';
    this.watchProc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.isFromMe) continue;
          const handle = msg.handle?.address || msg.sender || msg.chatId || msg.from;
          const text = msg.text || msg.body || msg.message;
          if (!handle || !text) continue;
          const ts = msg.dateCreated || msg.timestamp || Date.now();
          if (ts <= this.lastMessageTs) continue;
          this.lastMessageTs = ts;
          this.saveState();
          this.checkDMPolicyAndEmit(handle, text);
        } catch {}
      }
    });

    this.watchProc.stderr?.on('data', () => {});
    this.watchProc.on('error', () => {});
    this.watchProc.on('exit', (code) => {
      this.watchProc = null;
      if (this.running && code !== 0) setTimeout(() => this.startWatch(), 5000);
    });
  }

  private async checkDMPolicyAndEmit(from: string, text: string): Promise<void> {
    if (this.config.dmPolicy === 'none') return;
    if (this.config.dmPolicy === 'open') {
      this.emit('message', { chatId: from, text });
      return;
    }
    if (this.config.dmPolicy === 'allowlist') {
      if (this.config.allowFrom.includes(from)) this.emit('message', { chatId: from, text });
      else await this.sendMessage(from, 'HyperClaw: Not on allowlist.');
      return;
    }
    if (this.config.dmPolicy === 'pairing') {
      if (this.config.approvedPairings.includes(from)) {
        this.emit('message', { chatId: from, text });
        return;
      }
      const code = (text.trim().toUpperCase().match(/[A-Z0-9]{6}/) || [])[0];
      if (code && this.config.pendingPairings[code]) {
        this.config.approvedPairings.push(from);
        delete this.config.pendingPairings[code];
        await this.saveState();
        await this.sendMessage(from, 'Paired!');
        this.emit('pairing:approved', { userId: from, channelId: 'imessage-native' });
        this.emit('message', { chatId: from, text });
        return;
      }
      const newCode = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      this.config.pendingPairings[newCode] = from;
      await this.saveState();
      await this.sendMessage(from, `Pairing code: ${newCode}\nApprove: hyperclaw pairing approve imessage-native ${newCode}`);
    }
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    const to = String(chatId).trim();
    if (!to) return;
    const escaped = text.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    try {
      await execAsync(`"${IMSC_PATH}" send --to "${to}" --text "${escaped}"`, { timeout: 15000 });
    } catch (e: any) {
      throw new Error(`imsg send failed: ${e.message}`);
    }
  }

  disconnect(): void {
    this.running = false;
    this.watchProc?.kill();
    this.watchProc = null;
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      this.lastMessageTs = s.lastTs || 0;
      if (s.p) this.config.pendingPairings = s.p;
      if (s.a) this.config.approvedPairings = s.a;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, {
      lastTs: this.lastMessageTs,
      p: this.config.pendingPairings,
      a: this.config.approvedPairings
    }, { spaces: 2 });
  }
}
