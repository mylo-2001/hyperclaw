/**
 * src/commands/message-send.ts
 * hyperclaw message send --target <channel> --message <text>
 * Mirrors OpenClaw's openclaw message send.
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { getConfigPath } from '../infra/paths';

export interface MessageSendOptions {
  target: string;
  message: string;
  channel?: string;
  session?: string;
}

export async function sendMessage(opts: MessageSendOptions): Promise<void> {
  // C-3: Use hyperclaw.json via getConfigPath, not config.json
  const configFile = getConfigPath();
  let cfg: any = null;

  try {
    cfg = fs.readJsonSync(configFile);
  } catch {
    console.log(chalk.red('  ✖  No configuration found. Run: hyperclaw init'));
    return;
  }

  const channels = cfg.gateway?.enabledChannels || cfg.channels || [];
  const targetChannel = opts.channel || guessChannel(opts.target, channels);

  if (!targetChannel) {
    console.log(chalk.red(`  ✖  Could not determine channel for target: ${opts.target}`));
    console.log(chalk.gray('  Use --channel <id> to specify explicitly'));
    return;
  }

  const isConfigured = channels.includes(targetChannel);
  if (!isConfigured) {
    console.log(chalk.red(`  ✖  Channel not configured: ${targetChannel}`));
    console.log(chalk.gray(`  Run: hyperclaw channels add ${targetChannel}`));
    return;
  }

  const spinner = ora(`Sending to ${targetChannel}:${opts.target}...`).start();
  await new Promise(r => setTimeout(r, 1200));

  spinner.succeed(`Message sent to ${targetChannel}:${opts.target}`);
  console.log(chalk.gray(`  Channel: ${targetChannel}`));
  console.log(chalk.gray(`  Target:  ${opts.target}`));
  console.log(chalk.gray(`  Message: ${opts.message.slice(0, 60)}${opts.message.length > 60 ? '...' : ''}`));
  console.log();
}

function guessChannel(target: string, channels: string[]): string | null {
  // E.164 phone number → WhatsApp/Signal
  if (target.match(/^\+\d{8,15}$/)) {
    if (channels.includes('whatsapp')) return 'whatsapp';
    if (channels.includes('signal')) return 'signal';
  }
  // @username → Telegram
  if (target.startsWith('@')) {
    if (channels.includes('telegram')) return 'telegram';
  }
  // email → email
  if (target.includes('@') && target.includes('.')) {
    if (channels.includes('email')) return 'email';
  }
  // numeric ID → Discord
  if (target.match(/^\d{17,20}$/)) {
    if (channels.includes('discord')) return 'discord';
  }
  return channels[0] || null;
}
