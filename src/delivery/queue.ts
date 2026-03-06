/**
 * src/delivery/queue.ts
 * Message delivery queue with exponential backoff retry.
 * Matches OpenClaw's delivery reliability pattern.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead';

export interface DeliveryItem {
  id: string;
  channelId: string;
  target: string;
  payload: string;
  createdAt: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  status: DeliveryStatus;
  deliveredAt?: string;
}

const BACKOFF_SECONDS = [5, 30, 120, 600, 3600]; // 5s, 30s, 2m, 10m, 1h

function nextBackoff(attemptCount: number): Date {
  const seconds = BACKOFF_SECONDS[Math.min(attemptCount, BACKOFF_SECONDS.length - 1)];
  return new Date(Date.now() + seconds * 1000);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class DeliveryQueue {
  private queueFile: string;
  private items: DeliveryItem[] = [];
  private processing = false;

  constructor() {
    this.queueFile = path.join(os.homedir(), '.hyperclaw', 'delivery-queue.json');
    this.load();
  }

  private load(): void {
    try {
      this.items = fs.readJsonSync(this.queueFile);
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    fs.ensureDirSync(path.dirname(this.queueFile));
    fs.writeJsonSync(this.queueFile, this.items, { spaces: 2 });
  }

  enqueue(channelId: string, target: string, payload: string, maxAttempts = 5): DeliveryItem {
    const item: DeliveryItem = {
      id: randomId(),
      channelId,
      target,
      payload,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      maxAttempts,
      nextAttemptAt: new Date().toISOString(),
      status: 'pending'
    };

    this.items.push(item);
    this.save();
    return item;
  }

  async process(
    deliverFn: (item: DeliveryItem) => Promise<void>
  ): Promise<{ delivered: number; failed: number; pending: number }> {
    if (this.processing) return { delivered: 0, failed: 0, pending: this.pending().length };

    this.processing = true;
    let delivered = 0, failed = 0;

    const now = new Date();
    const ready = this.items.filter(
      i => i.status === 'pending' && new Date(i.nextAttemptAt) <= now
    );

    for (const item of ready) {
      item.status = 'delivering';
      item.attemptCount++;
      this.save();

      try {
        await deliverFn(item);
        item.status = 'delivered';
        item.deliveredAt = new Date().toISOString();
        delivered++;
      } catch (err: any) {
        item.lastError = err.message || String(err);

        if (item.attemptCount >= item.maxAttempts) {
          item.status = 'dead';
          failed++;
          console.log(chalk.red(`  ✖  Delivery dead-lettered: ${item.id} (${item.channelId}:${item.target})`));
          console.log(chalk.red(`     Last error: ${item.lastError}`));
        } else {
          item.status = 'pending';
          item.nextAttemptAt = nextBackoff(item.attemptCount).toISOString();
          const backoffSec = BACKOFF_SECONDS[Math.min(item.attemptCount, BACKOFF_SECONDS.length - 1)];
          console.log(chalk.yellow(`  ⚠  Delivery retry #${item.attemptCount} in ${backoffSec}s: ${item.id}`));
        }
      }

      this.save();
    }

    // Prune delivered items older than 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.items = this.items.filter(i =>
      i.status !== 'delivered' || new Date(i.deliveredAt!) > cutoff
    );
    this.save();

    this.processing = false;
    return { delivered, failed, pending: this.pending().length };
  }

  pending(): DeliveryItem[] {
    return this.items.filter(i => i.status === 'pending');
  }

  dead(): DeliveryItem[] {
    return this.items.filter(i => i.status === 'dead');
  }

  showStatus(): void {
    const pending = this.pending();
    const dead = this.dead();
    const delivered = this.items.filter(i => i.status === 'delivered');

    console.log(chalk.bold.cyan('\n  📬 DELIVERY QUEUE\n'));
    console.log(`  ${chalk.green(`${delivered.length} delivered`)}  ${chalk.yellow(`${pending.length} pending`)}  ${chalk.red(`${dead.length} dead-lettered`)}`);
    console.log();

    if (pending.length > 0) {
      console.log(chalk.yellow('  Pending:\n'));
      for (const i of pending.slice(0, 5)) {
        const nextIn = Math.max(0, Math.floor((new Date(i.nextAttemptAt).getTime() - Date.now()) / 1000));
        console.log(`  ${chalk.yellow('○')} ${i.id}  ${i.channelId}:${i.target}  attempt ${i.attemptCount}/${i.maxAttempts}  retry in ${nextIn}s`);
      }
      console.log();
    }

    if (dead.length > 0) {
      console.log(chalk.red('  Dead-lettered (manual intervention required):\n'));
      for (const i of dead) {
        console.log(`  ${chalk.red('✖')} ${i.id}  ${i.channelId}:${i.target}  ${chalk.gray(i.lastError || 'unknown error')}`);
      }
      console.log();
    }
  }

  retry(id: string): void {
    const item = this.items.find(i => i.id === id);
    if (!item) { console.log(chalk.red(`  ✖  Item not found: ${id}`)); return; }
    item.status = 'pending';
    item.attemptCount = 0;
    item.nextAttemptAt = new Date().toISOString();
    delete item.lastError;
    this.save();
    console.log(chalk.green(`  ✔  Queued for immediate retry: ${id}`));
  }
}
