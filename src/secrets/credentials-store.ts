/**
 * src/secrets/credentials-store.ts
 * Per-provider credential files stored in credentials/ directory.
 * Each provider gets its own file: credentials/<provider>.json (mode 0o600)
 * Matches OpenClaw's credential isolation pattern.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

export interface ProviderCredential {
  providerId: string;
  apiKey?: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  baseUrl?: string;
  extra?: Record<string, string>;
  updatedAt: string;
}

export class CredentialsStore {
  private credsDir: string;

  constructor(baseDir?: string) {
    this.credsDir = path.join(baseDir || path.join(os.homedir(), '.hyperclaw'), 'credentials');
  }

  private filePath(providerId: string): string {
    // Sanitize provider ID to prevent path traversal
    const safe = providerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.credsDir, `${safe}.json`);
  }

  async set(providerId: string, creds: Omit<ProviderCredential, 'providerId' | 'updatedAt'>): Promise<void> {
    await fs.ensureDir(this.credsDir);
    // Protect credentials directory itself
    await fs.chmod(this.credsDir, 0o700);

    const record: ProviderCredential = {
      ...creds,
      providerId,
      updatedAt: new Date().toISOString()
    };

    const fpath = this.filePath(providerId);
    await fs.writeJson(fpath, record, { spaces: 2 });
    await fs.chmod(fpath, 0o600);
  }

  async get(providerId: string): Promise<ProviderCredential | null> {
    const fpath = this.filePath(providerId);
    if (!(await fs.pathExists(fpath))) return null;

    // Validate permissions
    const stat = await fs.stat(fpath);
    if ((stat.mode & 0o077) !== 0) {
      console.log(chalk.yellow(`  ⚠  Unsafe permissions on credentials/${providerId}.json — fixing...`));
      await fs.chmod(fpath, 0o600);
    }

    return fs.readJson(fpath) as Promise<ProviderCredential>;
  }

  async remove(providerId: string): Promise<void> {
    const fpath = this.filePath(providerId);
    await fs.remove(fpath);
    console.log(chalk.green(`  ✔  Credentials removed: ${providerId}`));
  }

  async list(): Promise<string[]> {
    if (!(await fs.pathExists(this.credsDir))) return [];
    const files = await fs.readdir(this.credsDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  async showList(): Promise<void> {
    const providers = await this.list();
    console.log(chalk.bold.cyan('\n  🔐 CREDENTIALS\n'));

    if (providers.length === 0) {
      console.log(chalk.gray('  No credentials stored.\n'));
      console.log(chalk.gray('  Add with: hyperclaw auth add <service_id>   (for any API key)\n'));
    console.log(chalk.gray('  Or:       hyperclaw secrets set KEY=value   (for .env vars)\n'));
      return;
    }

    for (const p of providers) {
      const cred = await this.get(p);
      const hasKey = !!(cred?.apiKey);
      const hasRefresh = !!(cred?.refreshToken);
      const expiry = cred?.expiresAt
        ? new Date(cred.expiresAt) > new Date()
          ? chalk.green('valid')
          : chalk.red('expired')
        : chalk.gray('no expiry');

      console.log(`  ${chalk.green('●')} ${chalk.white(p.padEnd(20))} ${hasKey ? chalk.cyan('api_key') : ''}${hasRefresh ? chalk.yellow(' refresh_token') : ''} ${expiry}`);
      console.log(`     ${chalk.gray(`Updated: ${cred?.updatedAt ? new Date(cred.updatedAt).toLocaleString() : 'unknown'}`)}`);
      console.log();
    }

    console.log(chalk.gray('  credentials/ — stored at ~/.hyperclaw/credentials/*.json (mode 0600)\n'));
  }
}
