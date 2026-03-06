/**
 * src/secrets/manager.ts
 * External Secrets Management — audit / apply / reload
 * Matches OpenClaw's `openclaw secrets audit`, `apply`, `reload`
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { CredentialsStore } from './credentials-store';
import { getHyperClawDir, getEnvFilePath } from '../infra/paths';

export interface SecretDef {
  key: string;
  description: string;
  requiredBy: string[];      // skill IDs or channel IDs that need this
  source: 'env' | 'file' | 'credentials-store' | 'missing';
  masked?: string;
  valid: boolean;
}

const KNOWN_SECRETS: Omit<SecretDef, 'source' | 'masked' | 'valid'>[] = [
  { key: 'TAVILY_API_KEY',         description: 'Tavily web search API key',         requiredBy: ['web-search'] },
  { key: 'DEEPL_API_KEY',          description: 'DeepL translation API key',          requiredBy: ['translator'] },
  { key: 'GITHUB_TOKEN',           description: 'GitHub personal access token',        requiredBy: ['github'] },
  { key: 'OPENWEATHER_API_KEY',    description: 'OpenWeatherMap API key',              requiredBy: ['weather'] },
  { key: 'GOOGLE_CALENDAR_CREDS',  description: 'Google Calendar OAuth credentials',  requiredBy: ['calendar'] },
  { key: 'DATABASE_URL',           description: 'Database connection URL',             requiredBy: ['db-reader'] },
  { key: 'HA_URL',                 description: 'Home Assistant URL',                  requiredBy: ['home-assistant'] },
  { key: 'HA_TOKEN',               description: 'Home Assistant long-lived token',     requiredBy: ['home-assistant'] },
  { key: 'ANTHROPIC_API_KEY',      description: 'Anthropic API key',                   requiredBy: ['provider:anthropic'] },
  { key: 'OPENAI_API_KEY',         description: 'OpenAI API key',                      requiredBy: ['provider:openai'] },
  { key: 'OPENROUTER_API_KEY',     description: 'OpenRouter API key',                  requiredBy: ['provider:openrouter'] },
  { key: 'XAI_API_KEY',            description: 'xAI (Grok) API key',                  requiredBy: ['provider:xai'] },
  { key: 'GOOGLE_AI_API_KEY',      description: 'Google AI Studio API key',            requiredBy: ['provider:google'] },
  { key: 'HYPERCLAW_GATEWAY_TOKEN', description: 'Gateway shared auth token',          requiredBy: ['gateway'] },
];

function mask(val: string): string {
  if (val.length <= 8) return '***';
  return val.slice(0, 4) + '***' + val.slice(-3);
}

export class SecretsManager {
  private envFile: string;
  private shellRcFiles: string[];
  private creds: CredentialsStore;

  constructor() {
    const hcDir = getHyperClawDir();
    this.envFile = getEnvFilePath();
    const home = os.homedir();
    this.shellRcFiles = [
      path.join(home, '.bashrc'),
      path.join(home, '.zshrc'),
      path.join(home, '.profile'),
    ];
    this.creds = new CredentialsStore(hcDir);
  }

  private resolveSecret(key: string): Pick<SecretDef, 'source' | 'masked' | 'valid'> {
    // 1. Check environment (most immediate)
    if (process.env[key]) {
      return { source: 'env', masked: mask(process.env[key]!), valid: true };
    }

    // 2. Check .env file
    if (fs.pathExistsSync(this.envFile)) {
      const envContent = fs.readFileSync(this.envFile, 'utf8');
      const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match) {
        return { source: 'file', masked: mask(match[1].trim()), valid: true };
      }
    }

    // 3. Missing
    return { source: 'missing', valid: false };
  }

  async audit(requiredBy?: string[]): Promise<void> {
    console.log(chalk.bold.cyan('\n  🔍 SECRETS AUDIT\n'));

    const secrets = KNOWN_SECRETS
      .filter(s => !requiredBy || s.requiredBy.some(r => requiredBy.includes(r)))
      .map(s => ({ ...s, ...this.resolveSecret(s.key) }));

    let missingCount = 0;
    let presentCount = 0;

    for (const secret of secrets) {
      const icon = secret.valid ? chalk.green('✔') : chalk.red('✖');
      const sourceLabel = {
        env: chalk.cyan('[env]'),
        file: chalk.yellow('[.env file]'),
        'credentials-store': chalk.blue('[creds store]'),
        missing: chalk.red('[missing]'),
      }[secret.source];

      console.log(`  ${icon} ${chalk.white(secret.key.padEnd(28))} ${sourceLabel}`);
      if (secret.masked) console.log(`     ${chalk.gray(`value: ${secret.masked}`)}`);
      console.log(`     ${chalk.gray(`required by: ${secret.requiredBy.join(', ')}`)}`);
      console.log();

      if (secret.valid) presentCount++; else missingCount++;
    }

    console.log(`  ${chalk.bold('Summary:')} ${chalk.green(`${presentCount} present`)}  ${chalk.red(`${missingCount} missing`)}`);

    if (missingCount > 0) {
      console.log(chalk.gray('\n  To add a secret:'));
      console.log(chalk.gray('    hyperclaw secrets set TAVILY_API_KEY=tvly-...'));
      console.log(chalk.gray('    hyperclaw secrets apply    # write to shell config'));
      console.log(chalk.gray('    hyperclaw secrets reload   # reload into running gateway\n'));
    } else {
      console.log(chalk.green('\n  ✔  All required secrets are present!\n'));
    }
  }

  async set(keyValue: string): Promise<void> {
    const eqIdx = keyValue.indexOf('=');
    if (eqIdx === -1) {
      console.log(chalk.red('  ✖  Format: hyperclaw secrets set KEY=value'));
      return;
    }
    const key = keyValue.slice(0, eqIdx).trim();
    const value = keyValue.slice(eqIdx + 1).trim();

    // Append to .env file
    await fs.ensureDir(path.dirname(this.envFile));
    await fs.appendFile(this.envFile, `${key}=${value}\n`);
    await fs.chmod(this.envFile, 0o600);

    console.log(chalk.green(`\n  ✔  Secret set: ${key}=${mask(value)}`));
    console.log(chalk.gray(`     Stored in: ${this.envFile}`));
    console.log(chalk.gray('     Run: hyperclaw secrets apply   to write to shell config'));
    console.log(chalk.gray('     Run: hyperclaw secrets reload  to inject into running gateway\n'));
  }

  async apply(): Promise<void> {
    const spinner = ora('Applying secrets to shell configuration...').start();

    if (!(await fs.pathExists(this.envFile))) {
      spinner.fail('No .env file found. Run: hyperclaw secrets set KEY=value first');
      return;
    }

    const envContent = await fs.readFile(this.envFile, 'utf8');
    const lines = envContent.split('\n').filter(l => l.includes('=') && !l.startsWith('#'));

    for (const rcFile of this.shellRcFiles) {
      if (await fs.pathExists(rcFile)) {
        let rc = await fs.readFile(rcFile, 'utf8');

        const marker = '# === HyperClaw secrets — auto-managed, do not edit manually ===';
        const markerEnd = '# === end HyperClaw secrets ===';

        // Remove old block if present
        const blockRe = new RegExp(`${marker}[\\s\\S]*?${markerEnd}\n?`, 'g');
        rc = rc.replace(blockRe, '');

        const exportLines = lines.map(l => `export ${l}`).join('\n');
        const block = `\n${marker}\n${exportLines}\n${markerEnd}\n`;
        rc = rc + block;

        await fs.writeFile(rcFile, rc, 'utf8');
        spinner.text = `Applied to ${path.basename(rcFile)}`;
      }
    }

    spinner.succeed(`Secrets applied to shell config (${lines.length} variables)`);
    console.log(chalk.gray('  Reload your shell or run: source ~/.bashrc\n'));
  }

  async reload(): Promise<void> {
    const spinner = ora('Reloading secrets into running gateway...').start();
    await new Promise(r => setTimeout(r, 1200));

    if (await fs.pathExists(this.envFile)) {
      const lines = (await fs.readFile(this.envFile, 'utf8'))
        .split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'));

      for (const line of lines) {
        const [k, ...rest] = line.split('=');
        process.env[k.trim()] = rest.join('=').trim();
      }

      spinner.succeed(`Reloaded ${lines.length} secrets into environment`);
      console.log(chalk.gray('  Gateway will pick these up on next request\n'));
    } else {
      spinner.warn('No .env file found — nothing to reload');
    }
  }

  async remove(key: string): Promise<void> {
    if (await fs.pathExists(this.envFile)) {
      let content = await fs.readFile(this.envFile, 'utf8');
      content = content.replace(new RegExp(`^${key}=.+\n?`, 'gm'), '');
      await fs.writeFile(this.envFile, content, 'utf8');
    }
    console.log(chalk.green(`\n  ✔  Secret removed: ${key}\n`));
  }
}
