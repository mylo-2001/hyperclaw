/**
 * extensions/irc/src/connector.ts
 * Real IRC connector — connect to IRC server, join channels, handle DMs and channel messages.
 * Uses irc npm package.
 */

import irc from 'irc';
import chalk from 'chalk';
import { EventEmitter } from 'events';

export interface IrcConfig {
  server: string;
  nick: string;
  channels?: string[];
  dmPolicy?: 'open' | 'allowlist' | 'pairing';
  allowFrom?: string[];
}

export class IrcConnector extends EventEmitter {
  private client: irc.Client | null = null;
  config: IrcConfig;

  constructor(config: IrcConfig) {
    super();
    this.config = {
      channels: [],
      dmPolicy: 'pairing',
      allowFrom: [],
      ...config
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const channels = (this.config.channels || [])
        .map((c: string) => (c.startsWith('#') ? c : `#${c}`));
      this.client = new irc.Client(this.config.server, this.config.nick, {
        channels,
        autoConnect: true,
        debug: false,
        showErrors: true,
        stripColors: true
      });

      this.client.on('registered', () => {
        console.log(chalk.green(`  🦅 IRC: ${this.config.nick} on ${this.config.server} connected`));
        this.emit('connected', { server: this.config.server, nick: this.config.nick });
        resolve();
      });

      this.client.on('error', (err: Error) => {
        console.log(chalk.yellow(`  ⚠ IRC error: ${err.message}`));
        reject(err);
      });

      this.client.on('message', (from: string, to: string, message: string) => {
        const isChannel = to.startsWith('#');
        const chatId = isChannel ? to : from;
        const text = message.trim();
        if (!text) return;
        if (!isChannel && (this.config.dmPolicy as string) === 'none') return;
        if (!isChannel && this.config.dmPolicy === 'allowlist' && this.config.allowFrom?.length) {
          if (!this.config.allowFrom.includes(from)) return;
        }
        this.emit('message', { chatId, text, from, to, isChannel });
      });

      this.client.on('pm', (from: string, message: string) => {
        const text = message.trim();
        if (!text) return;
        if (this.config.dmPolicy === 'allowlist' && this.config.allowFrom?.length) {
          if (!this.config.allowFrom.includes(from)) return;
        }
        this.emit('message', { chatId: from, text, from, to: from, isChannel: false });
      });
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('IRC not connected');
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      this.client.say(chatId, line);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}
