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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class SecretsManager {
  private envFile: string;
  private shellRcFiles: string[];
  private creds: CredentialsStore;

  constructor() {
    const hcDir = getHyperClawDir();
    this.envFile = getEnvFilePath();
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    this.shellRcFiles = isWin
      ? [
          path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
          path.join(home, '.powershell_profile.ps1'),
        ]
      : [
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

    // H-1: Replace existing entry instead of appending — prevents unbounded growth
    // and ensures audit/reload always see the latest value, not the first duplicate.
    await fs.ensureDir(path.dirname(this.envFile));
    let content = (await fs.pathExists(this.envFile))
      ? await fs.readFile(this.envFile, 'utf8')
      : '';
    const lineRe = new RegExp(`^${escapeRegex(key)}=.*$`, 'm');
    if (lineRe.test(content)) {
      content = content.replace(lineRe, `${key}=${value}`);
    } else {
      content = content.endsWith('\n') || content === ''
        ? content + `${key}=${value}\n`
        : content + `\n${key}=${value}\n`;
    }
    await fs.writeFile(this.envFile, content, 'utf8');
    await fs.chmod(this.envFile, 0o600);

    console.log(chalk.green(`\n  ✔  Secret set: ${key}=${mask(value)}`));
    console.log(chalk.gray(`     Stored in: ${this.envFile}`));
    console.log(chalk.gray('     Run: hyperclaw secrets apply   to write to shell config'));
    console.log(chalk.gray('     Restart gateway to use:        hyperclaw daemon restart\n'));
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
      await fs.ensureDir(path.dirname(rcFile));
      const exists = await fs.pathExists(rcFile);
      if (exists || rcFile.endsWith('.ps1')) {
        // M-5: Back up the RC file before modifying it (if it exists).
        if (exists) {
          const backup = rcFile + '.hyperclaw.bak';
          await fs.copy(rcFile, backup, { overwrite: true });
        }
        let rc = exists ? await fs.readFile(rcFile, 'utf8') : '';

        const marker = '# === HyperClaw secrets — auto-managed, do not edit manually ===';
        const markerEnd = '# === end HyperClaw secrets ===';

        // Remove old block if present (escape special regex chars in markers).
        const blockRe = new RegExp(
          `${escapeRegex(marker)}[\\s\\S]*?${escapeRegex(markerEnd)}\n?`,
          'g'
        );
        rc = rc.replace(blockRe, '');

        const isWin = process.platform === 'win32' && rcFile.endsWith('.ps1');
        const exportLines = isWin
          ? lines.map(l => {
              const eq = l.indexOf('=');
              if (eq <= 0) return '';
              const k = l.slice(0, eq).trim();
              let v = l.slice(eq + 1).trim();
              if (v.includes('\n') || v.includes('\r')) {
                console.log(chalk.yellow(`  ⚠  Secret ${k} contains newlines — may need manual edit in ${path.basename(rcFile)}`));
              }
              v = v.replace(/\\/g, '\\\\').replace(/"/g, '`"').replace(/\$/g, '`$');
              return `$env:${k} = "${v}"`;
            }).join('\n')
          : lines.map(l => `export ${l}`).join('\n');
        const block = `\n${marker}\n${exportLines}\n${markerEnd}\n`;
        rc = rc + block;

        await fs.writeFile(rcFile, rc, 'utf8');
        spinner.text = `Applied to ${path.basename(rcFile)}`;
      }
    }

    spinner.succeed(`Secrets applied to shell config (${lines.length} variables)`);
    const reloadHint = process.platform === 'win32'
      ? chalk.gray('  Open a new PowerShell window to load the profile.\n')
      : chalk.gray('  Reload your shell or run: source ~/.bashrc\n');
    console.log(reloadHint);
  }

  async reload(): Promise<void> {
    const spinner = ora('Reloading secrets into running gateway...').start();
    await new Promise(r => setTimeout(r, 1200));

    if (await fs.pathExists(this.envFile)) {
      const lines = (await fs.readFile(this.envFile, 'utf8'))
        .split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'));

      let injected = 0;
      for (const line of lines) {
        const [k, ...rest] = line.split('=');
        const key = k.trim();
        // M-1: Never overwrite a key that already exists in the environment
        // (system env / Docker secrets / CI injection takes precedence over .env file).
        if (key && !(key in process.env)) {
          process.env[key] = rest.join('=').trim();
          injected++;
        }
      }

      spinner.succeed(`Reloaded ${injected} secrets into this CLI process (${lines.length - injected} skipped — already set)`);
      console.log(chalk.gray('  Restart the gateway to pick up changes: hyperclaw daemon restart\n'));
    } else {
      spinner.warn('No .env file found — nothing to reload');
    }
  }

  async remove(key: string): Promise<void> {
    if (await fs.pathExists(this.envFile)) {
      let content = await fs.readFile(this.envFile, 'utf8');
      // L-2: Escape the key before using it in a regex so special chars don't
      // accidentally match partial key names (e.g. API_KEY matching EXTRA_API_KEY).
      content = content.replace(new RegExp(`^${escapeRegex(key)}=.*\n?`, 'gm'), '');
      await fs.writeFile(this.envFile, content, 'utf8');
    }
    console.log(chalk.green(`\n  ✔  Secret removed: ${key}\n`));
  }
}
