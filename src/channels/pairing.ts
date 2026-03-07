/**
 * src/channels/pairing.ts
 * DM pairing store — explicit owner approval for unknown inbound senders.
 *
 * Code format:  8 chars, uppercase, no ambiguous chars (0 O 1 I).
 * Expiry:       1 hour from creation.
 * Pending cap:  3 per channel (additional requests silently ignored).
 *
 * State files (under ~/.hyperclaw/credentials/):
 *   Pending:  <channel>-pairing.json
 *   Approved: <channel>-allowFrom.json            (default account)
 *             <channel>-<accountId>-allowFrom.json (non-default accounts)
 *
 * Supported channels: telegram, whatsapp, signal, imessage, discord, slack, feishu
 */

import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDENTIALS_DIR = path.join(os.homedir(), '.hyperclaw', 'credentials');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0 O 1 I
const CODE_LENGTH = 8;
const EXPIRY_MS = 60 * 60 * 1000;   // 1 hour
const MAX_PENDING_PER_CHANNEL = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingEntry {
  code: string;
  channelId: string;
  accountId: string;
  senderId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AllowFromStore {
  senderIds: string[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes).map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function pendingFile(channelId: string): string {
  return path.join(CREDENTIALS_DIR, `${channelId}-pairing.json`);
}

function allowFromFile(channelId: string, accountId = 'default'): string {
  const suffix = accountId === 'default' ? '' : `-${accountId}`;
  return path.join(CREDENTIALS_DIR, `${channelId}${suffix}-allowFrom.json`);
}

async function readPending(channelId: string): Promise<PendingEntry[]> {
  try {
    const data = await fs.readJson(pendingFile(channelId));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writePending(channelId: string, entries: PendingEntry[]): Promise<void> {
  await fs.ensureDir(CREDENTIALS_DIR);
  await fs.writeJson(pendingFile(channelId), entries, { spaces: 2, mode: 0o600 });
}

async function readAllowFrom(channelId: string, accountId = 'default'): Promise<AllowFromStore> {
  try {
    return await fs.readJson(allowFromFile(channelId, accountId));
  } catch {
    return { senderIds: [], updatedAt: new Date().toISOString() };
  }
}

async function writeAllowFrom(channelId: string, store: AllowFromStore, accountId = 'default'): Promise<void> {
  await fs.ensureDir(CREDENTIALS_DIR);
  await fs.writeJson(allowFromFile(channelId, accountId), store, { spaces: 2, mode: 0o600 });
}

// ---------------------------------------------------------------------------
// PairingStore — runtime API used by channel connectors
// ---------------------------------------------------------------------------

export class PairingStore {
  private channelId: string;
  private accountId: string;

  constructor(channelId: string, accountId = 'default') {
    this.channelId = channelId;
    this.accountId = accountId;
  }

  // ---- Check if sender is already approved ---------------------------------

  async isApproved(senderId: string): Promise<boolean> {
    const store = await readAllowFrom(this.channelId, this.accountId);
    return store.senderIds.includes(senderId);
  }

  // ---- Create a new pending request ----------------------------------------

  /**
   * Returns the pairing code to send to the user, or null if already pending
   * (code is resent only once per hour per sender).
   */
  async createRequest(senderId: string): Promise<string | null> {
    const now = Date.now();
    const entries = (await readPending(this.channelId)).filter(e => {
      // Prune expired entries
      return new Date(e.expiresAt).getTime() > now;
    });

    // Already have a pending request for this sender → resend existing code
    const existing = entries.find(e => e.senderId === senderId && e.channelId === this.channelId);
    if (existing) return existing.code;

    // Cap at MAX_PENDING_PER_CHANNEL (count only this channel + account)
    const channelPending = entries.filter(e => e.channelId === this.channelId && e.accountId === this.accountId);
    if (channelPending.length >= MAX_PENDING_PER_CHANNEL) {
      return null; // silently ignore — cap reached
    }

    const code = generateCode();
    const entry: PendingEntry = {
      code,
      channelId: this.channelId,
      accountId: this.accountId,
      senderId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now + EXPIRY_MS).toISOString()
    };
    entries.push(entry);
    await writePending(this.channelId, entries);
    return code;
  }

  // ---- Verify and approve a code -------------------------------------------

  /**
   * Called when a sender submits a code.
   * Returns true if the code was valid and the sender is now approved.
   */
  async verify(code: string, senderId: string): Promise<boolean> {
    const now = Date.now();
    const entries = await readPending(this.channelId);
    const idx = entries.findIndex(e =>
      e.code === code.toUpperCase() &&
      e.channelId === this.channelId &&
      e.accountId === this.accountId &&
      new Date(e.expiresAt).getTime() > now
    );
    if (idx === -1) return false;

    const entry = entries[idx];
    // Approve
    entries.splice(idx, 1);
    await writePending(this.channelId, entries);

    const store = await readAllowFrom(this.channelId, this.accountId);
    if (!store.senderIds.includes(entry.senderId)) {
      store.senderIds.push(entry.senderId);
    }
    store.updatedAt = new Date().toISOString();
    await writeAllowFrom(this.channelId, store, this.accountId);
    return true;
  }

  // ---- List pending (for CLI) ----------------------------------------------

  async listPending(): Promise<PendingEntry[]> {
    const now = Date.now();
    const entries = await readPending(this.channelId);
    return entries.filter(e =>
      e.channelId === this.channelId &&
      e.accountId === this.accountId &&
      new Date(e.expiresAt).getTime() > now
    );
  }

  // ---- CLI approve (by code, without knowing the senderId) -----------------

  async cliApprove(code: string): Promise<boolean> {
    const now = Date.now();
    const entries = await readPending(this.channelId);
    const idx = entries.findIndex(e =>
      e.code === code.toUpperCase() &&
      e.channelId === this.channelId &&
      e.accountId === this.accountId &&
      new Date(e.expiresAt).getTime() > now
    );
    if (idx === -1) return false;

    const entry = entries[idx];
    entries.splice(idx, 1);
    await writePending(this.channelId, entries);

    const store = await readAllowFrom(this.channelId, this.accountId);
    if (!store.senderIds.includes(entry.senderId)) {
      store.senderIds.push(entry.senderId);
    }
    store.updatedAt = new Date().toISOString();
    await writeAllowFrom(this.channelId, store, this.accountId);
    return true;
  }
}

// ---------------------------------------------------------------------------
// GlobalPairingManager — used by CLI commands (cross-channel)
// ---------------------------------------------------------------------------

const SUPPORTED_CHANNELS = ['telegram', 'whatsapp', 'signal', 'imessage', 'discord', 'slack', 'feishu'];

export class GlobalPairingManager {

  // ---- `hyperclaw pairing list [channel]` ----------------------------------

  async showList(channelFilter?: string): Promise<void> {
    const now = Date.now();
    const channels = channelFilter ? [channelFilter] : SUPPORTED_CHANNELS;
    console.log(chalk.bold.cyan('\n  🔑 PAIRING CODES\n'));

    let total = 0;
    for (const ch of channels) {
      let pending: PendingEntry[] = [];
      try {
        const raw = await readPending(ch);
        pending = raw.filter(e => new Date(e.expiresAt).getTime() > now);
      } catch {}

      if (pending.length === 0) continue;
      total += pending.length;

      console.log(chalk.yellow(`  ─── ${ch} ───`));
      for (const e of pending) {
        const expiresIn = Math.round((new Date(e.expiresAt).getTime() - now) / 60000);
        const acctSuffix = e.accountId !== 'default' ? chalk.gray(` [${e.accountId}]`) : '';
        console.log(
          `  ${chalk.yellow('○')} ${chalk.bold(e.code)}` +
          `  sender: ${chalk.white(e.senderId)}${acctSuffix}` +
          `  expires: ${chalk.gray(`${expiresIn}m`)}`
        );
      }
      console.log();
    }

    if (total === 0) {
      console.log(chalk.gray(`  No pending pairing requests${channelFilter ? ` for ${channelFilter}` : ''}.\n`));
    }
  }

  // ---- `hyperclaw pairing approve <channel> <code>` -------------------------

  async cliApprove(channelId: string, code: string, accountId = 'default'): Promise<void> {
    if (!SUPPORTED_CHANNELS.includes(channelId)) {
      console.log(chalk.red(`\n  ✖  Unknown channel: ${channelId}`));
      console.log(chalk.gray(`     Supported: ${SUPPORTED_CHANNELS.join(', ')}\n`));
      return;
    }
    const store = new PairingStore(channelId, accountId);
    const ok = await store.cliApprove(code);
    if (ok) {
      console.log(chalk.green(`\n  ✔  Pairing approved — ${channelId} code ${code.toUpperCase()}`));
      console.log(chalk.gray(`  Sender added to ${channelId}${accountId !== 'default' ? `-${accountId}` : ''}-allowFrom.json\n`));
    } else {
      console.log(chalk.red(`\n  ✖  Code not found, expired, or already used: ${channelId} ${code.toUpperCase()}\n`));
    }
  }

  // ---- Read approved allowFrom for a channel --------------------------------

  async getApprovedSenders(channelId: string, accountId = 'default'): Promise<string[]> {
    const store = await readAllowFrom(channelId, accountId);
    return store.senderIds;
  }
}
