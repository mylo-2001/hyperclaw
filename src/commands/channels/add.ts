/**
 * src/commands/channels/add.ts
 * hyperclaw channels add <channel> — interactive channel configuration.
 * hyperclaw channels add with plugin onboarding hooks.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
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
