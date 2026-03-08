/**
 * src/webhooks/manager.ts
 * Webhook endpoint management.
 * Each registered webhook creates a route: POST /webhook/<id>
 * Incoming webhooks are routed to channels or triggers.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { getHyperClawDir } from '../infra/paths';

const getWebhooksFile = () => path.join(getHyperClawDir(), 'webhooks.json');

export type WebhookFormat = 'raw' | 'json' | 'github' | 'stripe' | 'linear' | 'notion' | 'custom';

export interface Webhook {
  id: string;
  name: string;
  secret?: string;          // HMAC signature secret
  format: WebhookFormat;
  routeTo: {
    type: 'channel' | 'trigger' | 'hook';
    target: string;         // channel id, trigger name, or hook id
  };
  enabled: boolean;
  createdAt: string;
  hitCount: number;
  lastHitAt?: string;
  filterPath?: string;      // JSON path to extract message text, e.g. "body.text"
  template?: string;        // message template, e.g. "New commit: {{body.head_commit.message}}"
}

function generateSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

function generateId(): string {
  return crypto.randomBytes(6).toString('hex');
}

export class WebhookManager {
  private webhooks: Webhook[] = [];

  async load(): Promise<void> {
    try { this.webhooks = await fs.readJson(getWebhooksFile()); }
    catch { this.webhooks = []; }
  }

  async save(): Promise<void> {
    const f = getWebhooksFile();
    await fs.ensureDir(path.dirname(f));
    await fs.writeJson(f, this.webhooks, { spaces: 2 });
  }

  async add(opts: {
    name: string;
    format?: WebhookFormat;
    routeTo: Webhook['routeTo'];
    template?: string;
    filterPath?: string;
    withSecret?: boolean;
  }): Promise<Webhook> {
    await this.load();
    const wh: Webhook = {
      id: generateId(),
      name: opts.name,
      secret: opts.withSecret ? generateSecret() : undefined,
      format: opts.format || 'json',
      routeTo: opts.routeTo,
      enabled: true,
      createdAt: new Date().toISOString(),
      hitCount: 0,
      filterPath: opts.filterPath,
      template: opts.template
    };
    this.webhooks.push(wh);
    await this.save();
    return wh;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    this.webhooks = this.webhooks.filter(w => w.id !== id);
    await this.save();
  }

  async toggle(id: string): Promise<void> {
    await this.load();
    const wh = this.webhooks.find(w => w.id === id);
    if (wh) { wh.enabled = !wh.enabled; await this.save(); }
  }

  async recordHit(id: string): Promise<void> {
    const wh = this.webhooks.find(w => w.id === id);
    if (wh) { wh.hitCount++; wh.lastHitAt = new Date().toISOString(); await this.save(); }
  }

  verifySignature(webhook: Webhook, payload: string, sig: string): boolean {
    if (!webhook.secret) return true;
    const expected = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(sig.replace('sha256=', ''), 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

  extractMessage(webhook: Webhook, rawBody: string): string {
    if (!webhook.filterPath && !webhook.template) return rawBody;

    let body: any;
    try { body = JSON.parse(rawBody); } catch { body = { text: rawBody }; }

    // Template rendering
    if (webhook.template) {
      return webhook.template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const parts = key.trim().split('.');
        let val: any = body;
        for (const p of parts) { val = val?.[p]; }
        return val !== undefined ? String(val) : '';
      });
    }

    // Simple JSON path
    if (webhook.filterPath) {
      const parts = webhook.filterPath.split('.');
      let val: any = body;
      for (const p of parts) { val = val?.[p]; }
      return val !== undefined ? String(val) : rawBody;
    }

    return rawBody;
  }

  showList(gatewayPort = 18789): void {
    console.log(chalk.bold.cyan('\n  🪝 WEBHOOKS\n'));
    if (this.webhooks.length === 0) {
      console.log(chalk.gray('  No webhooks configured.\n'));
      console.log(chalk.gray('  Add with: hyperclaw webhooks add\n'));
      return;
    }

    for (const wh of this.webhooks) {
      const dot = wh.enabled ? chalk.green('●') : chalk.gray('○');
      const url = chalk.underline.cyan(`http://localhost:${gatewayPort}/webhook/${wh.id}`);
      console.log(`  ${dot} ${chalk.white(wh.name)} ${chalk.gray(`[${wh.format}]`)}`);
      console.log(`    ${chalk.gray('URL:')}    ${url}`);
      console.log(`    ${chalk.gray('Route:')}  ${wh.routeTo.type} → ${wh.routeTo.target}`);
      if (wh.secret) console.log(`    ${chalk.gray('Secret:')} ${wh.secret.slice(0, 8)}...`);
      if (wh.template) console.log(`    ${chalk.gray('Template:')} ${wh.template.slice(0, 50)}`);
      console.log(`    ${chalk.gray(`Hits: ${wh.hitCount}  Last: ${wh.lastHitAt ? new Date(wh.lastHitAt).toLocaleString() : 'never'}`)}`);
      console.log();
    }
  }
}
