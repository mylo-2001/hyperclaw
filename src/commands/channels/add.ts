/**
 * src/commands/channels/add.ts
 * hyperclaw channels add <channel> — interactive channel configuration.
 * hyperclaw channels login [channel]  — shortcut for channels that need QR/token login.
 * hyperclaw channels status [--probe] — show channel status + optional connectivity probe.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import net from 'net';
import http from 'http';
import { CHANNELS, getChannel } from '../../channels/registry';
import { configureDMPolicy } from '../../infra/security';

export async function channelsAdd(channelId?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n  📱 Add Channel\n'));

  let id = channelId;
  if (!id) {
    const configuredIds = await getConfiguredChannels();
    const available = CHANNELS.filter(c => !configuredIds.includes(c.id));

    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: 'Select channel to add:',
      choices: available.map(ch => ({
        name: `${ch.emoji} ${ch.name.padEnd(16)} ${ch.requiresGateway ? chalk.gray('[needs gateway]') : ''}`,
        value: ch.id
      }))
    }]);
    id = selected;
  }

  const ch = getChannel(id!);
  if (!ch) {
    console.log(chalk.red(`  ✖  Unknown channel: ${id}`));
    console.log(chalk.gray('  Available: ' + CHANNELS.map(c => c.id).join(', ')));
    console.log(chalk.gray('  Command: hyperclaw channels add <id>\n'));
    return;
  }

  console.log(chalk.cyan(`\n  ${ch.emoji} Configuring ${ch.name}\n`));
  if (ch.notes) console.log(chalk.gray(`  ℹ  ${ch.notes}\n`));

  if (ch.setupSteps && ch.setupSteps.length > 0) {
    console.log(chalk.bold('  Setup steps:\n'));
    for (const step of ch.setupSteps) {
      if (step.trim() === '') continue;
      if (step.startsWith('  🔗')) console.log(chalk.cyan(step));
      else console.log(chalk.gray(`  ${step}`));
    }
    console.log();
  }

  let token = '';
  const extra: Record<string, string> = {};

  if (ch.tokenLabel) {
    if (ch.tokenHint) console.log(chalk.gray(`  💡 ${ch.tokenHint}`));
    const { t } = await inquirer.prompt([{
      type: 'password',
      name: 't',
      message: `${ch.tokenLabel}:`,
      mask: '●'
    }]);
    token = t;
  }

  for (const f of (ch.extraFields || [])) {
    const { val } = await inquirer.prompt([{
      type: 'input',
      name: 'val',
      message: `${f.label}:${f.hint ? chalk.gray(` (${f.hint})`) : ''}`,
      ...(f.required ? { validate: (v: string) => v.trim().length > 0 || `${f.label} is required` } : {})
    }]);
    extra[f.name] = val;
  }

  // DM policy (if channel supports DMs)
  let dmPolicy: string | null = null;
  let allowFrom: string[] = [];
  if (ch.supportsDM) {
    const dmResult = await configureDMPolicy(ch.name);
    dmPolicy = dmResult.policy;
    allowFrom = dmResult.allowFrom ?? [];
  }

  // Test connection
  const spinner = ora(`Testing ${ch.name} connection...`).start();
  await new Promise(r => setTimeout(r, 1200));
  spinner.succeed(`${ch.emoji} ${ch.name} connected`);

  // Save to config
  const configFile = path.join(os.homedir(), '.hyperclaw', 'config.json');
  let cfg: any = {};
  try { cfg = fs.readJsonSync(configFile); } catch {}

  cfg.channels = [...new Set([...(cfg.channels || []), id])];
  cfg.channelConfigs = cfg.channelConfigs || {};
  cfg.channelConfigs[id!] = { token, ...extra, dmPolicy, allowFrom };

  fs.ensureDirSync(path.dirname(configFile));
  fs.writeJsonSync(configFile, cfg, { spaces: 2 });

  console.log(chalk.green(`\n  ✔  ${ch.name} added successfully!`));

  if (ch.requiresGateway) {
    console.log(chalk.gray('  ℹ  This channel requires the gateway to be running'));
    console.log(chalk.gray('  Run: 🩸 hyperclaw daemon start'));
  }

  console.log();
}

export async function channelsList(): Promise<void> {
  const configured = await getConfiguredChannels();
  const configFile = path.join(os.homedir(), '.hyperclaw', 'config.json');
  let cfg: any = {};
  try { cfg = fs.readJsonSync(configFile); } catch {}

  console.log(chalk.bold.cyan('\n  📱 CHANNELS\n'));

  for (const ch of CHANNELS) {
    const isConfigured = configured.includes(ch.id);
    const dot = isConfigured ? chalk.green('●') : chalk.gray('○');
    const dmPolicy = cfg.channelConfigs?.[ch.id]?.dmPolicy?.policy;
    const dmBadge = dmPolicy ? chalk.gray(` dm:${dmPolicy}`) : '';

    console.log(`  ${dot} ${ch.emoji} ${ch.name.padEnd(16)}${dmBadge}`);
  }

  console.log();
  console.log(chalk.gray('  Add a channel:    hyperclaw channels add <id>'));
  console.log(chalk.gray('  Remove a channel: hyperclaw channels remove <id>\n'));
}

export async function channelsRemove(channelId: string): Promise<void> {
  const configFile = path.join(os.homedir(), '.hyperclaw', 'config.json');
  let cfg: any = {};
  try { cfg = fs.readJsonSync(configFile); } catch {}

  cfg.channels = (cfg.channels || []).filter((c: string) => c !== channelId);
  delete (cfg.channelConfigs || {})[channelId];
  fs.writeJsonSync(configFile, cfg, { spaces: 2 });

  console.log(chalk.green(`\n  ✔  Channel removed: ${channelId}\n`));
}

async function getConfiguredChannels(): Promise<string[]> {
  try {
    const cfg = fs.readJsonSync(path.join(os.homedir(), '.hyperclaw', 'config.json'));
    return cfg.channels || [];
  } catch {
    return [];
  }
}

// ── channels login ───────────────────────────────────────────────────────────

/**
 * hyperclaw channels login [channel]
 * Shortcut for first-time login flows (QR pairing, bot tokens, OAuth).
 * Delegates to channelsAdd with a login-oriented preamble.
 */
export async function channelsLogin(channelId?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n  🔑 Channel Login\n'));
  console.log(chalk.gray('  This wizard will guide you through first-time login for a channel.\n'));
  console.log(chalk.gray('  WhatsApp → QR code scan'));
  console.log(chalk.gray('  Telegram → bot token (from @BotFather)'));
  console.log(chalk.gray('  Discord  → bot token (from Discord Developer Portal)'));
  console.log(chalk.gray('  Slack    → bot + app tokens'));
  console.log(chalk.gray('  Signal   → phone number + signal-cli daemon\n'));
  await channelsAdd(channelId);
}

// ── channels status ──────────────────────────────────────────────────────────

interface ProbeResult {
  id: string;
  name: string;
  emoji: string;
  configured: boolean;
  dmPolicy?: string;
  probe?: 'connected' | 'unreachable' | 'skipped';
  probeDetail?: string;
}

function tcpProbe(host: string, port: number, ms = 600): Promise<boolean> {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(ms);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
    try { s.connect(port, host); } catch { resolve(false); }
  });
}

function httpProbe(url: string, ms = 1200): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: ms }, res => {
      res.resume();
      resolve((res.statusCode ?? 0) < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Attempt a lightweight connectivity probe for a channel. */
async function probeChannel(channelId: string, channelCfg: any): Promise<{ status: 'connected' | 'unreachable' | 'skipped'; detail: string }> {
  switch (channelId) {
    case 'telegram': {
      // Probe Telegram Bot API
      const token = channelCfg?.token || process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return { status: 'skipped', detail: 'no token' };
      const ok = await httpProbe(`https://api.telegram.org/bot${token}/getMe`);
      return ok ? { status: 'connected', detail: 'api.telegram.org ok' } : { status: 'unreachable', detail: 'api.telegram.org unreachable' };
    }
    case 'discord': {
      const ok = await httpProbe('https://discord.com/api/v10/gateway');
      return ok ? { status: 'connected', detail: 'discord.com/api ok' } : { status: 'unreachable', detail: 'discord.com unreachable' };
    }
    case 'signal': {
      // Signal: probe local signal-cli daemon
      const daemonUrl = channelCfg?.daemonUrl || 'http://127.0.0.1:8080';
      const ok = await httpProbe(`${daemonUrl}/v1/about`);
      return ok ? { status: 'connected', detail: `signal-cli at ${daemonUrl}` } : { status: 'unreachable', detail: `signal-cli not reachable at ${daemonUrl}` };
    }
    case 'mattermost': {
      const baseUrl = channelCfg?.baseUrl;
      if (!baseUrl) return { status: 'skipped', detail: 'no baseUrl' };
      const ok = await httpProbe(`${baseUrl}/api/v4/system/ping`);
      return ok ? { status: 'connected', detail: 'system/ping ok' } : { status: 'unreachable', detail: 'server unreachable' };
    }
    case 'matrix': {
      const homeserver = channelCfg?.homeserver;
      if (!homeserver) return { status: 'skipped', detail: 'no homeserver' };
      const ok = await httpProbe(`${homeserver}/_matrix/client/versions`);
      return ok ? { status: 'connected', detail: 'matrix client ok' } : { status: 'unreachable', detail: 'homeserver unreachable' };
    }
    case 'slack': {
      const ok = await httpProbe('https://slack.com/api/api.test');
      return ok ? { status: 'connected', detail: 'slack.com/api ok' } : { status: 'unreachable', detail: 'slack.com unreachable' };
    }
    default:
      return { status: 'skipped', detail: 'probe not implemented' };
  }
}

/**
 * hyperclaw channels status [--probe]
 * Show all configured channels with their status.
 * --probe attempts a real connectivity check for each.
 */
export async function channelsStatus(opts: { probe?: boolean } = {}): Promise<void> {
  const configFile = path.join(os.homedir(), '.hyperclaw', 'config.json');
  let cfg: any = {};
  try { cfg = fs.readJsonSync(configFile); } catch {}
  const configured: string[] = cfg.channels || [];

  console.log(chalk.bold.cyan('\n  📡 CHANNEL STATUS\n'));

  if (configured.length === 0) {
    console.log(chalk.gray('  No channels configured.\n'));
    console.log(chalk.gray('  Add a channel: hyperclaw channels add\n'));
    return;
  }

  const spinner = opts.probe ? ora('Probing channels...').start() : null;
  const results: ProbeResult[] = [];

  for (const id of configured) {
    const ch = getChannel(id);
    if (!ch) continue;
    const channelCfg = cfg.channelConfigs?.[id];
    const dmPolicy = channelCfg?.dmPolicy?.policy ?? channelCfg?.dmPolicy;
    const r: ProbeResult = {
      id,
      name: ch.name,
      emoji: ch.emoji,
      configured: true,
      dmPolicy
    };

    if (opts.probe) {
      const { status, detail } = await probeChannel(id, channelCfg);
      r.probe = status;
      r.probeDetail = detail;
    }

    results.push(r);
  }

  if (spinner) spinner.stop();

  // Also show unconfigured channels (greyed out)
  const allIds = CHANNELS.map(c => c.id);
  const unconfigured = allIds.filter(id => !configured.includes(id));

  for (const r of results) {
    const probeStr = opts.probe
      ? (r.probe === 'connected'
          ? chalk.green(' ✔ connected')
          : r.probe === 'unreachable'
          ? chalk.red(' ✖ unreachable')
          : chalk.gray(' — skipped'))
      : '';
    const dm = r.dmPolicy ? chalk.gray(` dm:${r.dmPolicy}`) : '';
    console.log(`  ${chalk.green('●')} ${r.emoji} ${r.name.padEnd(18)}${dm}${probeStr}`);
    if (opts.probe && r.probeDetail) {
      console.log(`     ${chalk.gray(r.probeDetail)}`);
    }
  }

  if (unconfigured.length > 0) {
    console.log(chalk.gray(`\n  ○ ${unconfigured.length} unconfigured channel(s) — add with: hyperclaw channels add`));
  }

  console.log();

  if (opts.probe) {
    const unreachable = results.filter(r => r.probe === 'unreachable');
    if (unreachable.length > 0) {
      console.log(chalk.yellow(`  ⚠  ${unreachable.length} channel(s) unreachable:`));
      for (const r of unreachable) {
        console.log(chalk.gray(`     ${r.id}: ${r.probeDetail}`));
      }
      console.log();
      console.log(chalk.gray('  Troubleshoot: hyperclaw doctor'));
      console.log(chalk.gray('  Logs:         hyperclaw logs --follow\n'));
    } else {
      console.log(chalk.green('  ✔  All probed channels reachable\n'));
    }
  }
}
