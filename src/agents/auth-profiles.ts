/**
 * src/agents/auth-profiles.ts
 * Auth profiles — per-agent identity sets for different contexts.
 * E.g. "work" profile uses work Google account, "personal" uses personal.
 * Matches OpenClaw's agents/auth-profiles pattern.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { getHyperClawDir, getConfigPath } from '../infra/paths';

export interface AuthProfile {
  id: string;
  name: string;
  description?: string;
  provider: string;
  modelId: string;
  systemPromptOverride?: string;
  channelOverrides?: Record<string, { token?: string; dmPolicy?: any }>;
  secretsProfile?: string;   // Which .env profile to load
  active: boolean;
  createdAt: string;
}

const getProfilesFile = () => path.join(getHyperClawDir(), 'auth-profiles.json');

export class AuthProfileManager {
  private profiles: AuthProfile[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      this.profiles = fs.readJsonSync(getProfilesFile());
    } catch {
      this.profiles = [];
    }
  }

  private save(): void {
    const f = getProfilesFile();
    fs.ensureDirSync(path.dirname(f));
    fs.writeJsonSync(f, this.profiles, { spaces: 2 });
  }

  list(): void {
    console.log(chalk.bold.cyan('\n  👤 AUTH PROFILES\n'));

    if (this.profiles.length === 0) {
      console.log(chalk.gray('  No profiles configured.\n'));
      console.log(chalk.gray('  Create one: hyperclaw profiles create\n'));
      return;
    }

    for (const p of this.profiles) {
      const activeBadge = p.active ? chalk.green(' [active]') : '';
      console.log(`  ${p.active ? chalk.green('●') : chalk.gray('○')} ${chalk.white(p.name)}${activeBadge}  ${chalk.gray(p.id)}`);
      console.log(`     provider: ${p.provider}  model: ${p.modelId}`);
      if (p.description) console.log(`     ${chalk.gray(p.description)}`);
      console.log();
    }

    console.log(chalk.gray('  Switch: hyperclaw profiles use <id|name>'));
    console.log(chalk.gray('  Create: hyperclaw profiles create\n'));
  }

  async create(): Promise<void> {
    console.log(chalk.bold.cyan('\n  👤 Create Auth Profile\n'));

    // Load current config for defaults
    let cfg: any = {};
    try { cfg = fs.readJsonSync(getConfigPath()); } catch {}

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Profile name (e.g. "work", "personal", "testing"):',
        validate: (v: string) => v.trim().length > 0 || 'Required'
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):'
      },
      {
        type: 'input',
        name: 'provider',
        message: 'AI provider:',
        default: cfg.provider?.providerId || 'openrouter'
      },
      {
        type: 'input',
        name: 'modelId',
        message: 'Model ID:',
        default: cfg.provider?.modelId || 'openrouter/auto'
      },
      {
        type: 'editor',
        name: 'systemPromptOverride',
        message: 'System prompt override (optional, blank to skip):'
      }
    ]);

    const profile: AuthProfile = {
      id: answers.name.toLowerCase().replace(/\s+/g, '-'),
      name: answers.name,
      description: answers.description || undefined,
      provider: answers.provider,
      modelId: answers.modelId,
      systemPromptOverride: answers.systemPromptOverride?.trim() || undefined,
      active: this.profiles.length === 0,  // First profile is active by default
      createdAt: new Date().toISOString()
    };

    this.profiles.push(profile);
    this.save();

    console.log(chalk.green(`\n  ✔  Profile created: ${profile.name}`));
    if (profile.active) console.log(chalk.cyan('  Set as active profile'));
    console.log(chalk.gray('\n  Switch: hyperclaw profiles use ' + profile.id + '\n'));
  }

  use(idOrName: string): void {
    const profile = this.profiles.find(p =>
      p.id === idOrName || p.name.toLowerCase() === idOrName.toLowerCase()
    );

    if (!profile) {
      console.log(chalk.red(`\n  ✖  Profile not found: ${idOrName}\n`));
      return;
    }

    // Deactivate all, activate chosen
    this.profiles.forEach(p => { p.active = false; });
    profile.active = true;
    this.save();

    console.log(chalk.green(`\n  ✔  Active profile: ${profile.name}`));
    console.log(chalk.gray(`     provider: ${profile.provider}  model: ${profile.modelId}\n`));
  }

  getActive(): AuthProfile | undefined {
    return this.profiles.find(p => p.active) || this.profiles[0];
  }

  delete(id: string): void {
    const before = this.profiles.length;
    this.profiles = this.profiles.filter(p => p.id !== id);
    if (this.profiles.length < before) {
      this.save();
      console.log(chalk.green(`\n  ✔  Profile deleted: ${id}\n`));
    } else {
      console.log(chalk.red(`\n  ✖  Profile not found: ${id}\n`));
    }
  }
}
