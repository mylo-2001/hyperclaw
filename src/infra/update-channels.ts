/**
 * src/infra/update-channels.ts
 * Update channel management — matches OpenClaw's resolveEffectiveUpdateChannel logic.
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export type UpdateChannel = 'stable' | 'beta' | 'dev';
export type InstallKind = 'npm' | 'git' | 'nix' | 'docker';

export interface UpdateChannelParams {
  installKind: InstallKind;
  git?: { tag?: string; branch?: string };
  requestedChannel?: UpdateChannel;
  storedChannel?: UpdateChannel;
}

export interface EffectiveChannel {
  channel: UpdateChannel;
  source: 'requested' | 'stored' | 'git-tag' | 'git-branch' | 'default';
}

const DEFAULT_GIT_CHANNEL: UpdateChannel = 'dev';
const DEFAULT_PACKAGE_CHANNEL: UpdateChannel = 'stable';

function isBetaTag(tag: string): boolean {
  return tag.includes('beta') || tag.includes('rc') || tag.includes('alpha');
}

export function resolveEffectiveUpdateChannel(params: UpdateChannelParams): EffectiveChannel {
  // Explicit request always wins
  if (params.requestedChannel) {
    return { channel: params.requestedChannel, source: 'requested' };
  }

  // For git installs, detect from tag/branch
  if (params.installKind === 'git') {
    const tag = params.git?.tag;
    if (tag) {
      return {
        channel: isBetaTag(tag) ? 'beta' : 'stable',
        source: 'git-tag'
      };
    }
    const branch = params.git?.branch;
    if (branch) {
      if (branch === 'main' || branch === 'dev') return { channel: 'dev', source: 'git-branch' };
      if (branch.startsWith('beta') || branch.startsWith('rc')) return { channel: 'beta', source: 'git-branch' };
    }
  }

  // Stored preference
  if (params.storedChannel) {
    return { channel: params.storedChannel, source: 'stored' };
  }

  // Default
  const def = params.installKind === 'git' ? DEFAULT_GIT_CHANNEL : DEFAULT_PACKAGE_CHANNEL;
  return { channel: def, source: 'default' };
}

export async function detectInstallKind(): Promise<InstallKind> {
  // Check if we're in a git repo
  try {
    await execAsync('git rev-parse --git-dir 2>/dev/null');
    return 'git';
  } catch {}

  // Check if inside Docker
  if (await fs.pathExists('/.dockerenv')) return 'docker';

  // Check nix
  try {
    await execAsync('which nix 2>/dev/null');
    if (process.env.NIX_STORE) return 'nix';
  } catch {}

  return 'npm';
}

export async function getCurrentGitInfo(): Promise<{ tag?: string; branch?: string }> {
  try {
    const tag = (await execAsync('git describe --tags --exact-match 2>/dev/null')).stdout.trim();
    if (tag) return { tag };
  } catch {}

  try {
    const branch = (await execAsync('git rev-parse --abbrev-ref HEAD 2>/dev/null')).stdout.trim();
    if (branch && branch !== 'HEAD') return { branch };
  } catch {}

  return {};
}

export async function performUpdate(channel: UpdateChannel, installKind: InstallKind): Promise<void> {
  const channelDisplay = {
    stable: chalk.green('stable'),
    beta: chalk.yellow('beta'),
    dev: chalk.red('dev (bleeding edge)')
  }[channel];

  console.log(chalk.cyan(`\n  🔄 Updating HyperClaw — channel: ${channelDisplay}\n`));

  if (installKind === 'git') {
    const branch = channel === 'stable' ? 'main' : channel === 'beta' ? 'beta' : 'dev';
    console.log(chalk.gray(`  git checkout ${branch} && git pull --rebase origin ${branch}`));
    console.log(chalk.gray('  pnpm install && pnpm build'));
    console.log(chalk.yellow('\n  ⚠  Run the above commands manually in your hyperclaw directory'));
  } else {
    const tag = channel === 'stable' ? '' : channel === 'beta' ? '@beta' : '@dev';
    console.log(chalk.gray(`  npm install -g hyperclaw${tag}`));
    console.log(chalk.yellow('\n  ⚠  Run the above command to update'));
  }

  // Save channel preference
  const { getHyperClawDir } = await import('./paths');
  const storedPath = path.join(getHyperClawDir(), 'update-channel');
  await fs.ensureDir(path.dirname(storedPath));
  await fs.writeFile(storedPath, channel);
  console.log(chalk.green(`\n  ✔  Preferred channel saved: ${channel}`));
}

export async function getStoredChannel(): Promise<UpdateChannel | undefined> {
  const { getHyperClawDir } = await import('./paths');
  const storedPath = path.join(getHyperClawDir(), 'update-channel');
  try {
    const ch = (await fs.readFile(storedPath, 'utf8')).trim() as UpdateChannel;
    if (['stable', 'beta', 'dev'].includes(ch)) return ch;
  } catch {}
  return undefined;
}
