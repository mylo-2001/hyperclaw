/**
 * src/channels/pairing.ts
 * DM pairing store — mirrors HyperClaw pairing flow.
 * Users DM /pair <code> → bot adds them to allowlist.
 */

import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface PairingEntry {
  code: string;
  channelId: string;
  userId?: string;
  generatedAt: string;
  approvedAt?: string;
  status: 'pending' | 'approved' | 'expired';
}

export class PairingStore {
  private storePath: string;
  private entries: PairingEntry[] = [];

  constructor() {
    this.storePath = path.join(os.homedir(), '.hyperclaw', 'pairing-store.json');
    this.load();
  }

  private load(): void {
    try {
      this.entries = fs.readJsonSync(this.storePath);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    fs.ensureDirSync(path.dirname(this.storePath));
    fs.writeJsonSync(this.storePath, this.entries, { spaces: 2 });
  }

  generateCode(channelId: string): string {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    this.entries.push({
      code,
      channelId,
      generatedAt: new Date().toISOString(),
      status: 'pending'
    });
    this.save();
    return code;
  }

  approve(channelId: string, code: string, userId?: string): boolean {
    const entry = this.entries.find(
      e => e.channelId === channelId && e.code === code && e.status === 'pending'
    );

    if (!entry) return false;

    entry.status = 'approved';
    entry.approvedAt = new Date().toISOString();
    if (userId) entry.userId = userId;
    this.save();
    return true;
  }

  listPending(channelId?: string): PairingEntry[] {
    return this.entries.filter(e =>
      e.status === 'pending' && (!channelId || e.channelId === channelId)
    );
  }

  listApproved(channelId?: string): PairingEntry[] {
    return this.entries.filter(e =>
      e.status === 'approved' && (!channelId || e.channelId === channelId)
    );
  }

  showList(): void {
    console.log(chalk.bold.cyan('\n  🔑 PAIRING CODES\n'));

    const pending = this.listPending();
    const approved = this.listApproved();

    if (pending.length > 0) {
      console.log(chalk.yellow('  Pending:\n'));
      for (const e of pending) {
        console.log(`  ${chalk.yellow('○')} ${chalk.bold(e.code)}  channel: ${e.channelId}  generated: ${new Date(e.generatedAt).toLocaleTimeString()}`);
      }
      console.log();
    }

    if (approved.length > 0) {
      console.log(chalk.green('  Approved:\n'));
      for (const e of approved) {
        const user = e.userId ? ` user: ${e.userId}` : '';
        console.log(`  ${chalk.green('●')} ${chalk.bold(e.code)}  channel: ${e.channelId}${user}  approved: ${e.approvedAt ? new Date(e.approvedAt).toLocaleDateString() : 'unknown'}`);
      }
      console.log();
    }

    if (pending.length === 0 && approved.length === 0) {
      console.log(chalk.gray('  No pairing entries yet.\n'));
    }
  }

  cliApprove(channelId: string, code: string): void {
    const ok = this.approve(channelId, code);
    if (ok) {
      console.log(chalk.green(`\n  ✔  Pairing approved — ${channelId} code ${code}`));
      console.log(chalk.gray('  User added to channel allowlist\n'));
    } else {
      console.log(chalk.red(`\n  ✖  Pairing not found or already processed: ${channelId} ${code}\n`));
    }
  }
}
