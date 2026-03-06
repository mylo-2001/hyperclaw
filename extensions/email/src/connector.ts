/**
 * extensions/email/src/connector.ts
 * REAL Email connector — IMAP polling + SMTP sending.
 * No SDK. Native TLS sockets. Works with Gmail, Outlook, Fastmail, etc.
 *
 * Gmail setup:
 * 1. Enable 2FA → App Passwords → generate password
 * 2. IMAP host: imap.gmail.com:993, SMTP: smtp.gmail.com:587
 *
 * Outlook:
 * 1. IMAP: outlook.office365.com:993, SMTP: smtp.office365.com:587
 */

import tls from 'tls';
import net from 'net';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EventEmitter } from 'events';

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'email-state.json');

export interface EmailConfig {
  // IMAP (incoming)
  imapHost: string;
  imapPort: number;       // usually 993 (TLS) or 143 (STARTTLS)
  // SMTP (outgoing)
  smtpHost: string;
  smtpPort: number;       // usually 587 (STARTTLS) or 465 (TLS)
  // Auth
  username: string;       // full email address
  password: string;       // app password
  // Behavior
  pollIntervalMs: number; // default 30000 (30s)
  inboxFolder: string;    // default INBOX
  markAsRead: boolean;    // default true
  subjectPrefix: string;  // only process emails with this prefix, empty = all
  fromAllowlist: string[]; // empty = allow all
}

// ─── IMAP client (minimal, RFC 3501) ─────────────────────────────────────────

class IMAPClient {
  private sock: tls.TLSSocket | null = null;
  private buffer = '';
  private tag = 0;
  private pendingCallbacks = new Map<string, (response: string) => void>();

  async connect(host: string, port: number, username: string, password: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.sock = tls.connect({ host, port, rejectUnauthorized: true }, () => resolve());
      this.sock.on('error', reject);
      this.sock.on('data', (chunk) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });
    });
    // Read greeting
    await this.waitForUntagged('OK');
    await this.command(`LOGIN "${this.escapeQuoted(username)}" "${this.escapeQuoted(password)}"`);
  }

  disconnect(): void {
    this.sock?.end();
    this.sock = null;
  }

  async selectFolder(folder: string): Promise<{ exists: number; unseen: number }> {
    const resp = await this.command(`SELECT "${folder}"`);
    const existsMatch = resp.match(/\* (\d+) EXISTS/);
    const unseenMatch = resp.match(/UNSEEN (\d+)/);
    return {
      exists: existsMatch ? parseInt(existsMatch[1]) : 0,
      unseen: unseenMatch ? parseInt(unseenMatch[1]) : 0
    };
  }

  async searchUnseen(): Promise<number[]> {
    const resp = await this.command('SEARCH UNSEEN');
    const match = resp.match(/\* SEARCH ([\d ]+)/);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(' ').map(Number).filter(Boolean);
  }

  async fetchEmail(uid: number): Promise<{ from: string; subject: string; body: string; messageId: string } | null> {
    const resp = await this.command(`FETCH ${uid} (RFC822.HEADER BODY[TEXT])`);

    const fromMatch = resp.match(/^From:\s*(.+)$/im);
    const subjectMatch = resp.match(/^Subject:\s*(.+)$/im);
    const msgIdMatch = resp.match(/^Message-ID:\s*(.+)$/im);

    // Extract body (after headers)
    const bodyMatch = resp.match(/BODY\[TEXT\] \{(\d+)\}([\s\S]+?)(?:\* \d+ FETCH|\w+ OK)/);

    if (!fromMatch) return null;

    // Decode simple quoted-printable
    const body = bodyMatch ? decodeQP(bodyMatch[2].trim()) : '';

    return {
      from: fromMatch[1].trim(),
      subject: decodeHeader(subjectMatch ? subjectMatch[1].trim() : '(no subject)'),
      body: body.slice(0, 4000),
      messageId: msgIdMatch ? msgIdMatch[1].trim() : ''
    };
  }

  async markSeen(uid: number): Promise<void> {
    await this.command(`STORE ${uid} +FLAGS (\\Seen)`);
  }

  private async command(cmd: string): Promise<string> {
    const tag = `HC${++this.tag}`;
    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(tag, resolve);
      this.sock?.write(`${tag} ${cmd}\r\n`);
      setTimeout(() => {
        this.pendingCallbacks.delete(tag);
        reject(new Error(`IMAP timeout: ${tag} ${cmd.slice(0, 30)}`));
      }, 15000);
    });
  }

  private async waitForUntagged(keyword: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.buffer.includes(`* ${keyword}`) || this.buffer.includes(`OK ${keyword}`)) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const tagMatch = line.match(/^(HC\d+) (OK|NO|BAD)/);
      if (tagMatch) {
        const cb = this.pendingCallbacks.get(tagMatch[1]);
        if (cb) {
          this.pendingCallbacks.delete(tagMatch[1]);
          cb(this.buffer + line);
        }
      }
    }
  }

  private escapeQuoted(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}

// ─── SMTP client (RFC 5321, STARTTLS) ────────────────────────────────────────

class SMTPClient {
  async send(config: EmailConfig, to: string, subject: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(config.smtpPort, config.smtpHost);
      let buf = '';
      let tlsSock: tls.TLSSocket | null = null;
      let upgraded = false;
      let authenticated = false;

      const write = (s: string) => {
        const target = tlsSock || sock;
        target.write(s + '\r\n');
      };

      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\r\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          const code = parseInt(line.slice(0, 3));
          if (line.startsWith('220') && !upgraded) {
            write(`EHLO hyperclaw.ai`);
          } else if (line.includes('250') && line.includes('STARTTLS') && !upgraded) {
            write('STARTTLS');
          } else if (line.startsWith('220') && !upgraded) {
            // Upgrade to TLS
            upgraded = true;
            tlsSock = tls.connect({ socket: sock, servername: config.smtpHost });
            tlsSock.on('data', onData);
            tlsSock.on('error', reject);
            write(`EHLO hyperclaw.ai`);
          } else if (line.startsWith('250') && upgraded && !authenticated) {
            write(`AUTH LOGIN`);
          } else if (line.startsWith('334') && !authenticated) {
            const b64user = Buffer.from(config.username).toString('base64');
            const b64pass = Buffer.from(config.password).toString('base64');
            if (line.includes('VXNlcm5hbWU')) {
              write(b64user);
            } else {
              write(b64pass);
              authenticated = true;
            }
          } else if (line.startsWith('235')) {
            write(`MAIL FROM:<${config.username}>`);
          } else if (line.startsWith('250') && authenticated) {
            if (buf.includes('RCPT') || !buf) {
              write(`RCPT TO:<${to}>`);
            } else {
              write(`DATA`);
            }
          } else if (line.startsWith('354')) {
            const date = new Date().toUTCString();
            const msg =
              `From: ${config.username}\r\n` +
              `To: ${to}\r\n` +
              `Subject: ${subject}\r\n` +
              `Date: ${date}\r\n` +
              `Content-Type: text/plain; charset=utf-8\r\n` +
              `\r\n` +
              body + '\r\n.';
            write(msg);
          } else if (line.startsWith('250') && buf.includes('.')) {
            write('QUIT');
          } else if (line.startsWith('221')) {
            sock.destroy();
            resolve();
          } else if (code >= 400) {
            sock.destroy();
            reject(new Error(`SMTP error: ${line}`));
          }
        }
      };

      sock.on('data', onData);
      sock.on('error', reject);
      sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('SMTP timeout')); });
    });
  }
}

function decodeQP(text: string): string {
  return text
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeHeader(text: string): string {
  return text.replace(/=\?UTF-8\?[BQ]\?([^?]+)\?=/gi, (_, enc) => {
    try { return Buffer.from(enc, 'base64').toString('utf8'); } catch { return enc; }
  });
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/) || from.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  return match ? match[1] || match[0] : from;
}

// ─── Main connector ───────────────────────────────────────────────────────────

export class EmailConnector extends EventEmitter {
  config: EmailConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  private lastSeenUid = 0;
  private smtp = new SMTPClient();

  constructor(config: Partial<EmailConfig> & { username: string; password: string; imapHost: string; smtpHost: string }) {
    super();
    this.config = {
      imapPort: 993, smtpPort: 587,
      pollIntervalMs: 30000,
      inboxFolder: 'INBOX',
      markAsRead: true,
      subjectPrefix: '',
      fromAllowlist: [],
      ...config
    } as EmailConfig;
  }

  async connect(): Promise<void> {
    await this.loadState();
    // Test connection
    const imap = new IMAPClient();
    await imap.connect(this.config.imapHost, this.config.imapPort, this.config.username, this.config.password);
    const { exists } = await imap.selectFolder(this.config.inboxFolder);
    imap.disconnect();

    console.log(chalk.green(`  🦅 Email: ${this.config.username} — ${exists} messages in inbox`));
    this.running = true;
    this.emit('connected', { username: this.config.username });
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

  /** Trigger immediate poll (e.g. from Gmail Pub/Sub webhook) */
  triggerPoll(): void {
    if (this.running) this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    const imap = new IMAPClient();
    try {
      await imap.connect(this.config.imapHost, this.config.imapPort, this.config.username, this.config.password);
      await imap.selectFolder(this.config.inboxFolder);

      const unseenUids = await imap.searchUnseen();
      const newUids = unseenUids.filter(uid => uid > this.lastSeenUid);

      for (const uid of newUids) {
        const email = await imap.fetchEmail(uid);
        if (!email) continue;

        const fromAddr = extractEmail(email.from);

        // Subject prefix filter
        if (this.config.subjectPrefix && !email.subject.startsWith(this.config.subjectPrefix)) {
          continue;
        }

        // From allowlist filter
        if (this.config.fromAllowlist.length > 0 && !this.config.fromAllowlist.includes(fromAddr)) {
          continue;
        }

        if (this.config.markAsRead) await imap.markSeen(uid);

        this.lastSeenUid = Math.max(this.lastSeenUid, uid);
        await this.saveState();

        this.emit('message', {
          id: email.messageId || String(uid),
          channelId: 'email',
          from: fromAddr,
          chatId: fromAddr,
          text: `Subject: ${email.subject}\n\n${email.body}`,
          timestamp: new Date().toISOString(),
          isDM: true
        });
      }
    } catch (err: any) {
      if (this.running) console.log(chalk.yellow(`  ⚠  Email poll error: ${err.message}`));
    } finally {
      imap.disconnect();
    }
  }

  async sendMessage(to: string, text: string, subject?: string): Promise<void> {
    await this.smtp.send(
      this.config, to,
      subject || `🦅 HyperClaw`,
      text
    );
  }

  async reply(to: string, originalSubject: string, text: string): Promise<void> {
    const replySubject = originalSubject.startsWith('Re: ') ? originalSubject : `Re: ${originalSubject}`;
    await this.sendMessage(to, text, replySubject);
  }

  private async loadState(): Promise<void> {
    try {
      const s = await fs.readJson(STATE_FILE);
      this.lastSeenUid = s.lastSeenUid || 0;
    } catch {}
  }

  private async saveState(): Promise<void> {
    await fs.ensureDir(path.dirname(STATE_FILE));
    await fs.writeJson(STATE_FILE, { lastSeenUid: this.lastSeenUid }, { spaces: 2 });
  }

  isRunning() { return this.running; }
}
