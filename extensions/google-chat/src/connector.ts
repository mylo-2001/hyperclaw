/**
 * extensions/google-chat/src/connector.ts
 * Google Chat HTTP app connector — receives events from Chat API, sync reply.
 *
 * Setup:
 * 1. console.cloud.google.com → APIs → Chat API
 * 2. Configuration → App URL: https://your-server/webhook/gchat
 * 3. Add bot to a space or DM
 */

import http from 'http';
import chalk from 'chalk';
import { EventEmitter } from 'events';

export interface GoogleChatConfig {
  baseUrl: string;  // e.g. http://127.0.0.1:3210
}

export class GoogleChatConnector extends EventEmitter {
  private config: GoogleChatConfig;

  constructor(config: GoogleChatConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    console.log(chalk.green(`  🦅 Google Chat: HTTP app listening at ${this.config.baseUrl}/webhook/gchat`));
    this.emit('connected', {});
  }

  disconnect(): void {}

  /**
   * Handle incoming Chat event. Returns JSON string for sync reply, or void.
   */
  async handleWebhook(body: string): Promise<string | void> {
    let event: any;
    try {
      event = JSON.parse(body);
    } catch {
      return;
    }

    const type = event.type;
    if (type === 'ADDED_TO_SPACE' || type === 'REMOVED_FROM_SPACE') {
      return JSON.stringify({ text: type === 'ADDED_TO_SPACE' ? '🦅 HyperClaw connected.' : 'Goodbye.' });
    }

    if (type !== 'MESSAGE') return;

    const msg = event.message;
    const text = (msg?.argumentText || msg?.text || '').trim();
    if (!text) return JSON.stringify({ text: '' });

    const spaceName = event.space?.name || 'unknown';
    const userName = event.user?.displayName || event.user?.name || 'User';

    try {
      const response = await this.postChat(text);
      return JSON.stringify({ text: response || '(no response)' });
    } catch (e: any) {
      console.error(chalk.yellow(`  ⚠ Google Chat: ${e.message}`));
      return JSON.stringify({ text: `Error: ${e.message}` });
    }
  }

  private postChat(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ message });
      const url = new URL(`${this.config.baseUrl}/api/chat`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
          'X-HyperClaw-Source': 'gchat'
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.error) reject(new Error(j.error));
            else resolve(j.response || '');
          } catch {
            reject(new Error('Invalid response'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.write(payload);
      req.end();
    });
  }
}
