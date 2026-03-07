/**
 * src/bot/hyperclawbot.ts
 * HyperClaw Bot — companion bot for remote gateway management.
 * Connects as a Telegram or Discord bot and lets you control
 * HyperClaw from your phone, even when away from the terminal.
 *
 * Commands:
 *   /status               — gateway + daemon status
 *   /restart              — restart gateway
 *   /logs [n]             — last N log lines
 *   /approve <ch> <code>  — approve DM pairing
 *   /channels             — list active channels
 *   /hook list            — list hooks
 *   /hook on <id>         — enable hook
 *   /hook off <id>        — disable hook
 *   /agent <msg>          — send message to AI agent
 *   /activation [mention|always] — set group activation mode
 *   /secrets audit        — secrets status
 *   /security             — security audit summary
 *   /help                 — list commands
 *
 * Start: hyperclaw bot start
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import axios from 'axios';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const BOT_CONFIG_FILE = path.join(HC_DIR, 'hyperclawbot.json');
const BOT_PID_FILE = path.join(HC_DIR, 'hyperclawbot.pid');

export type BotPlatform = 'telegram' | 'discord';

export type ActivationMode = 'mention' | 'always';

export interface HyperClawBotConfig {
  platform: BotPlatform;
  token: string;
  allowedUsers: string[];     // user IDs that can control the bot
  gatewayUrl: string;
  gatewayToken?: string;
  enabled: boolean;
  activationMode?: ActivationMode;  // 'mention' (default) or 'always'
  createdAt: string;
}

// ─── Telegram Bot API types ───────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
    voice?: { file_id: string; duration: number; mime_type?: string };
    reply_to_message?: { text?: string; from?: { id: number; is_bot?: boolean } };
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function getGatewayStatus(gatewayUrl: string, token?: string): Promise<string> {
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await axios.get(`${gatewayUrl}/api/status`, { headers, timeout: 3000 });
    const d = res.data;
    return `⚡ *Gateway Status*\n\n` +
      `🟢 Running on port ${d.port}\n` +
      `🦅 Agent: ${d.agentName || 'unknown'}\n` +
      `📱 Channels: ${(d.channels || []).join(', ') || 'none'}\n` +
      `👥 Sessions: ${d.sessions || 0}\n` +
      `⏱ Uptime: ${d.uptime || '?'}\n` +
      `🧠 Model: ${d.model || 'unknown'}`;
  } catch {
    return '🔴 *Gateway Offline*\n\nStart with: `hyperclaw daemon start`';
  }
}

async function getLogSummary(n = 20): Promise<string> {
  const logFile = path.join(HC_DIR, 'logs', 'hyperclaw.log');
  if (!(await fs.pathExists(logFile))) return '📋 No logs yet.';

  const content = await fs.readFile(logFile, 'utf8');
  const lines = content.trim().split('\n').slice(-n);
  const formatted = lines.map(line => {
    try {
      const e = JSON.parse(line);
      const level = e.level?.toUpperCase() || 'INFO';
      const icon = { ERROR: '🔴', WARN: '🟡', INFO: '🔵', DEBUG: '⚪' }[level] || '⚪';
      return `${icon} ${e.ts?.slice(11, 19) || ''} [${e.module || '?'}] ${e.message || ''}`;
    } catch {
      return line;
    }
  });
  return `📋 *Last ${n} log entries*\n\n\`\`\`\n${formatted.join('\n').slice(0, 3500)}\n\`\`\``;
}

async function approveCode(channelId: string, code: string): Promise<string> {
  try {
    const { PairingStore } = await import('../channels/pairing');
    const store = new PairingStore(channelId);
    await store.cliApprove(code);
    return `✅ Approved pairing code *${code}* on *${channelId}*`;
  } catch (e: any) {
    return `❌ Failed: ${e.message}`;
  }
}

async function listChannels(): Promise<string> {
  try {
    const cfg = await fs.readJson(path.join(HC_DIR, 'hyperclaw.json'));
    const channels = Object.entries(cfg.channelConfigs || {}).map(([id]) => `• ${id}`).join('\n');
    return `📱 *Active Channels*\n\n${channels || '(none configured)'}`;
  } catch {
    return '❌ Could not read config';
  }
}

async function listHooks(): Promise<string> {
  try {
    const { HookLoader } = await import('../hooks/loader');
    const loader = new HookLoader();
    loader.loadState();
    const hooks = loader.getHooks().map((h: { enabled: boolean; eligible: boolean; id: string; trigger: string }) =>
      `${h.enabled && h.eligible ? '✅' : '⬜'} ${h.id} — ${h.trigger}`
    ).join('\n');
    return `🪝 *Hooks*\n\n${hooks}`;
  } catch {
    return '❌ Could not load hooks';
  }
}

async function sendToAgent(
  message: string,
  gatewayUrl: string,
  gatewayToken?: string,
  surface: 'telegram' | 'discord' = 'telegram'
): Promise<string> {
  try {
    const headers = gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {};
    const res = await axios.post(`${gatewayUrl}/api/chat`,
      { message, thinking: 'none' },
      { headers, timeout: 30000 }
    );
    const { formatAgentResponse } = require('hyperclaw/core');
    return formatAgentResponse(res.data.response ?? '', surface);
  } catch {
    return '❌ Gateway unreachable — start with: `hyperclaw daemon start`';
  }
}

function parseCommand(text: string): { cmd: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].replace('/', '').toLowerCase();
  return { cmd, args: parts.slice(1) };
}

function getHelp(platform: BotPlatform): string {
  const { getAgentHelp } = require('hyperclaw/core');
  return getAgentHelp(platform === 'discord' ? 'discord' : 'telegram');
}

// ─── Telegram Bot ─────────────────────────────────────────────────────────────

export class TelegramHyperClawBot {
  private config: HyperClawBotConfig;
  private offset = 0;
  private running = false;
  private apiBase: string;
  private botUsername: string = '';

  constructor(config: HyperClawBotConfig) {
    this.config = config;
    this.apiBase = `https://api.telegram.org/bot${config.token}`;
  }

  private async api(method: string, body?: object): Promise<any> {
    const res = await axios.post(`${this.apiBase}/${method}`, body, { timeout: 10000 });
    return res.data;
  }

  private isAllowed(userId: number): boolean {
    if (this.config.allowedUsers.length === 0) return true;
    return this.config.allowedUsers.includes(String(userId));
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.api('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: 'Markdown'
    });
  }

  private async downloadAndTranscribeVoice(fileId: string): Promise<string> {
    const fileRes = await this.api('getFile', { file_id: fileId });
    const filePath = fileRes.result?.file_path;
    if (!filePath) throw new Error('Could not get file path');
    const url = `https://api.telegram.org/file/bot${this.config.token}/${filePath}`;
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data);
    const { transcribeVoiceNote } = await import('../services/voice-transcription');
    return transcribeVoiceNote(buffer);
  }

  private shouldRespondInGroup(msg: NonNullable<TelegramUpdate['message']>): boolean {
    const chatType = (msg.chat as { type?: string }).type || '';
    if (chatType !== 'group' && chatType !== 'supergroup') return true;
    // 'always' mode → respond to everything in group
    if ((this.config.activationMode ?? 'mention') === 'always') return true;
    // Reply to bot → activate
    if (msg.reply_to_message?.from?.is_bot) return true;
    // @mention → activate
    const mention = msg.entities?.find(e => e.type === 'mention' || e.type === 'text_mention');
    if (mention && msg.text) {
      const mentioned = msg.text.slice(mention.offset, mention.offset + mention.length);
      if (this.botUsername && mentioned.toLowerCase().includes(this.botUsername.toLowerCase())) return true;
    }
    return false;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;

    const userId = msg.from?.id;
    if (!userId || !this.isAllowed(userId)) {
      await this.sendMessage(msg.chat.id, '🚫 Unauthorized');
      return;
    }

    // In groups: only respond to @mention or reply-to-bot
    if (!this.shouldRespondInGroup(msg)) return;

    // Resolve text: from message text, or from voice note transcription
    let text = msg.text || '';
    let isFromVoice = false;
    if (!text && msg.voice) {
      try {
        await this.sendMessage(msg.chat.id, '🎤 Transcribing...');
        text = await this.downloadAndTranscribeVoice(msg.voice.file_id);
        if (!text || text.startsWith('[')) {
          await this.sendMessage(msg.chat.id, text || '❌ Transcription failed');
          return;
        }
        isFromVoice = true;
      } catch (e: any) {
        await this.sendMessage(msg.chat.id, `❌ Transcription failed: ${e.message}`);
        return;
      }
    }

    if (!text.trim()) return;

    // Voice notes without /command → treat as /agent
    const { cmd, args } = isFromVoice && !text.startsWith('/')
      ? { cmd: 'agent', args: text.trim().split(/\s+/) }
      : parseCommand(text);
    const { gatewayUrl, gatewayToken } = this.config;

    let response = '';

    switch (cmd) {
      case 'start':
      case 'help':
        response = getHelp(this.config.platform);
        break;

      case 'status':
        response = await getGatewayStatus(gatewayUrl, gatewayToken);
        break;

      case 'logs':
        response = await getLogSummary(parseInt(args[0]) || 20);
        break;

      case 'approve':
        if (args.length < 2) { response = '❌ Usage: /approve <channel> <code>'; break; }
        response = await approveCode(args[0], args[1]);
        break;

      case 'channels':
        response = await listChannels();
        break;

      case 'hook':
        if (args[0] === 'list' || !args[0]) { response = await listHooks(); break; }
        if ((args[0] === 'on' || args[0] === 'off') && args[1]) {
          const { HookLoader } = await import('../hooks/loader');
          const loader = new HookLoader();
          loader.loadState();
          if (args[0] === 'on') await loader.enable(args[1]);
          else await loader.disable(args[1]);
          response = `${args[0] === 'on' ? '✅' : '⬜'} Hook ${args[0] === 'on' ? 'enabled' : 'disabled'}: ${args[1]}`;
          break;
        }
        response = '❌ Usage: /hook list | /hook on <id> | /hook off <id>';
        break;

      case 'restart':
        response = '🔄 Restarting gateway...';
        await this.sendMessage(msg.chat.id, response);
        try {
          const r = await axios.post(`${gatewayUrl}/api/remote/restart`, {}, {
            headers: gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {},
            timeout: 5000
          });
          response = (r.data?.restarted ? '✅ Gateway restarted' : r.data?.message) || '✅ Request accepted';
        } catch {
          response = '⚠️ Could not reach gateway to restart';
        }
        break;

      case 'agent':
        if (!args.length) { response = '❌ Usage: /agent <message>'; break; }
        response = await sendToAgent(args.join(' '), gatewayUrl, gatewayToken, 'telegram');
        break;

      case 'secrets':
        response = '🔍 Run locally: `hyperclaw secrets audit`';
        break;

      case 'security':
        response = '🔐 Run locally: `hyperclaw security audit --deep`';
        break;

      case 'activation': {
        const mode = args[0]?.toLowerCase();
        if (mode === 'mention' || mode === 'always') {
          this.config.activationMode = mode as ActivationMode;
          await saveBotConfig(this.config);
          response = `✅ Activation mode set to *${mode}*\n\n` +
            (mode === 'always'
              ? '🔊 Bot will respond to _all_ messages in groups.'
              : '🔇 Bot will only respond to @mentions and replies in groups.');
        } else {
          const current = this.config.activationMode ?? 'mention';
          response = `🎛 *Activation Mode*\n\nCurrent: *${current}*\n\n` +
            `• /activation mention — respond only to @mentions and replies _(default)_\n` +
            `• /activation always — respond to all messages in groups`;
        }
        break;
      }

      default:
        response = `❓ Unknown command: /${cmd}\n\nTry /help`;
    }

    await this.sendMessage(msg.chat.id, response);
  }

  async start(): Promise<void> {
    this.running = true;
    try {
      const me = await this.api('getMe');
      this.botUsername = me.result?.username || '';
    } catch { /* ignore */ }
    console.log(chalk.green('\n  ✔  HyperClaw Bot (Telegram) started'));
    console.log(chalk.gray(`  Polling updates...\n  Send /status to your bot to test.\n`));

    while (this.running) {
      try {
        const result = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message']
        });

        for (const update of (result.result || [])) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update).catch(e =>
            console.log(chalk.yellow(`  ⚠  HyperClaw Bot error: ${e.message}`))
          );
        }
      } catch {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}

// ─── Discord Bot ──────────────────────────────────────────────────────────────

export class DiscordHyperClawBot {
  private config: HyperClawBotConfig;
  private client: any;
  private running = false;

  constructor(config: HyperClawBotConfig) {
    this.config = config;
    this.client = null;
  }

  private isAllowed(userId: string): boolean {
    if (this.config.allowedUsers.length === 0) return true;
    return this.config.allowedUsers.includes(userId);
  }

  private async handleCommand(cmd: string, args: string[], reply: (text: string) => Promise<void>): Promise<void> {
    const { gatewayUrl, gatewayToken } = this.config;
    let response = '';

    switch (cmd) {
      case 'start':
      case 'help':
        response = getHelp('discord');
        break;
      case 'status':
        response = (await getGatewayStatus(gatewayUrl, gatewayToken)).replace(/\*/g, '**');
        break;
      case 'logs':
        response = (await getLogSummary(parseInt(args[0]) || 20)).replace(/\*/g, '**');
        break;
      case 'approve':
        if (args.length < 2) { response = '❌ Usage: /approve <channel> <code>'; break; }
        response = await approveCode(args[0], args[1]);
        break;
      case 'channels':
        response = (await listChannels()).replace(/\*/g, '**');
        break;
      case 'hook':
        if (args[0] === 'list' || !args[0]) { response = (await listHooks()).replace(/\*/g, '**'); break; }
        if ((args[0] === 'on' || args[0] === 'off') && args[1]) {
          const { HookLoader } = await import('../hooks/loader');
          const loader = new HookLoader();
          loader.loadState();
          if (args[0] === 'on') await loader.enable(args[1]);
          else await loader.disable(args[1]);
          response = `${args[0] === 'on' ? '✅' : '⬜'} Hook ${args[0] === 'on' ? 'enabled' : 'disabled'}: ${args[1]}`;
          break;
        }
        response = '❌ Usage: /hook list | /hook on <id> | /hook off <id>';
        break;
      case 'restart':
        await reply('🔄 Restarting gateway...');
        try {
          const r = await axios.post(`${gatewayUrl}/api/remote/restart`, {}, {
            headers: gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {},
            timeout: 5000
          });
          response = (r.data?.restarted ? '✅ Gateway restarted' : r.data?.message) || '✅ Request accepted';
        } catch {
          response = '⚠️ Could not reach gateway to restart';
        }
        break;
      case 'agent':
        if (!args.length) { response = '❌ Usage: /agent <message>'; break; }
        response = await sendToAgent(args.join(' '), gatewayUrl, gatewayToken, 'discord');
        break;
      case 'secrets':
        response = '🔍 Run locally: `hyperclaw secrets audit`';
        break;
      case 'security':
        response = '🔐 Run locally: `hyperclaw security audit --deep`';
        break;

      case 'activation': {
        const mode = args[0]?.toLowerCase();
        if (mode === 'mention' || mode === 'always') {
          this.config.activationMode = mode as ActivationMode;
          await saveBotConfig(this.config);
          response = `✅ Activation mode set to **${mode}**\n` +
            (mode === 'always'
              ? '🔊 Bot will respond to _all_ messages in groups.'
              : '🔇 Bot will only respond to @mentions and replies in groups.');
        } else {
          const current = this.config.activationMode ?? 'mention';
          response = `🎛 **Activation Mode**\nCurrent: **${current}**\n\n` +
            `• /activation mention — @mentions and replies only _(default)_\n` +
            `• /activation always — all messages in groups`;
        }
        break;
      }

      default:
        response = `❓ Unknown command: /${cmd}\n\nTry /help`;
    }

    await reply(response.slice(0, 2000));
  }

  async start(): Promise<void> {
    try {
      const { Client, GatewayIntentBits } = await import('discord.js');
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent]
      });
      this.running = true;

      this.client.on('ready', () => {
        console.log(chalk.green(`\n  ✔  HyperClaw Bot (Discord) started as ${this.client.user?.tag}`));
        console.log(chalk.gray(`  Send /status to your bot to test.\n`));
      });

      this.client.on('messageCreate', async (msg: any) => {
        if (msg.author?.bot) return;
        const userId = msg.author?.id;
        if (!userId || !this.isAllowed(userId)) {
          await msg.reply('🚫 Unauthorized').catch(() => {});
          return;
        }
        const text = (msg.content || '').trim();
        if (!text || !text.startsWith('/')) return;
        const { cmd, args } = parseCommand(text);
        const reply = async (t: string) => {
          try {
            await msg.reply({ content: t.slice(0, 2000) });
          } catch (e: any) {
            console.log(chalk.yellow(`  ⚠  Discord reply error: ${e.message}`));
          }
        };
        await this.handleCommand(cmd, args, reply).catch(e =>
          console.log(chalk.yellow(`  ⚠  HyperClaw Bot error: ${e.message}`))
        );
      });

      await this.client.login(this.config.token);
    } catch (e: any) {
      if (e.code === 'MODULE_NOT_FOUND' || e.message?.includes('discord.js')) {
        console.log(chalk.red('\n  ✖  discord.js not installed. Run: npm install discord.js\n'));
        process.exit(1);
      }
      throw e;
    }
  }

  stop(): void {
    this.running = false;
    if (this.client) {
      this.client.destroy().catch(() => {});
      this.client = null;
    }
  }
}

// ─── Config management ────────────────────────────────────────────────────────

export async function loadBotConfig(): Promise<HyperClawBotConfig | null> {
  try {
    const cfg = await fs.readJson(BOT_CONFIG_FILE);
    return cfg;
  } catch {
    // Fallback: try alternate config paths
    try {
      for (const p of [path.join(HC_DIR, 'hyperclaw-bot.json'), path.join(HC_DIR, 'bot-config.json')]) {
        if (await fs.pathExists(p)) return await fs.readJson(p);
      }
    } catch { /* ignore */ }
    return null;
  }
}

export async function saveBotConfig(config: HyperClawBotConfig): Promise<void> {
  await fs.ensureDir(path.dirname(BOT_CONFIG_FILE));
  await fs.writeJson(BOT_CONFIG_FILE, config, { spaces: 2 });
  await fs.chmod(BOT_CONFIG_FILE, 0o600);
}

export const BOT_PID_FILE_PATH = BOT_PID_FILE;

export async function stopBotProcess(): Promise<boolean> {
  try {
    if (!(await fs.pathExists(BOT_PID_FILE))) return false;
    const pid = parseInt(await fs.readFile(BOT_PID_FILE, 'utf8'), 10);
    if (isNaN(pid)) return false;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already be gone
    }
    await fs.remove(BOT_PID_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function writeBotPid(pid: number): Promise<void> {
  await fs.ensureDir(path.dirname(BOT_PID_FILE));
  await fs.writeFile(BOT_PID_FILE, String(pid), 'utf8');
}

export async function showBotStatus(): Promise<void> {
  const cfg = await loadBotConfig();
  console.log(chalk.bold.cyan('\n  🦅 HYPERCLAW BOT\n'));

  if (!cfg || !cfg.enabled) {
    console.log(chalk.gray('  HyperClaw Bot is not configured.\n'));
    console.log(chalk.gray('  Setup: hyperclaw bot setup\n'));
    return;
  }

  console.log(`  ${chalk.green('●')} ${chalk.white(cfg.platform === 'telegram' ? 'Telegram' : 'Discord')} bot`);
  console.log(`  ${chalk.gray('Token:')}        ${cfg.token.slice(0, 8)}...`);
  console.log(`  ${chalk.gray('Gateway:')}      ${cfg.gatewayUrl}`);
  console.log(`  ${chalk.gray('Allowed users:')} ${cfg.allowedUsers.length === 0 ? '(anyone)' : cfg.allowedUsers.join(', ')}`);
  console.log(`  ${chalk.gray('Status:')}       ${cfg.enabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
  console.log();
  console.log(chalk.gray('  Commands: hyperclaw bot start | stop | setup'));
  console.log();
}
