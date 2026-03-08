/**
 * src/infra/device-auth-store.ts
 * Secure credential store for gateway tokens and provider keys.
 * Mirrors OpenClaw's device-auth-store with mode 0o600 enforcement.
 *
 * H-7: All I/O is async (no readJsonSync / writeFileSync).
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { getHyperClawDir } from './paths';

export interface DeviceAuthStore {
  gatewayToken?: string;
  providers: Record<string, { apiKey?: string; refreshToken?: string; expiresAt?: number }>;
  createdAt: string;
  updatedAt: string;
}

export class AuthStore {
  private storePath: string;

  constructor(storeDir?: string) {
    const dir = storeDir ?? getHyperClawDir();
    this.storePath = path.join(dir, 'auth.json');
  }

  private async readStore(): Promise<DeviceAuthStore | null> {
    try {
      // Validate permissions before reading
      const stat = await fs.stat(this.storePath);
      if ((stat.mode & 0o077) !== 0) {
        console.log(chalk.yellow('  ⚠  Auth store has unsafe permissions — fixing...'));
        await fs.chmod(this.storePath, 0o600);
      }
      return (await fs.readJson(this.storePath)) as DeviceAuthStore;
    } catch {
      return null;
    }
  }

  private async writeStore(store: DeviceAuthStore): Promise<void> {
    await fs.ensureDir(path.dirname(this.storePath));
    await fs.writeFile(
      this.storePath,
      `${JSON.stringify(store, null, 2)}\n`,
      { mode: 0o600 }
    );
  }

  async getGatewayToken(): Promise<string | undefined> {
    return (await this.readStore())?.gatewayToken;
  }

  async setGatewayToken(token: string): Promise<void> {
    const store = (await this.readStore()) || this.emptyStore();
    store.gatewayToken = token;
    store.updatedAt = new Date().toISOString();
    await this.writeStore(store);
  }

  async setProviderKey(providerId: string, apiKey: string): Promise<void> {
    const store = (await this.readStore()) || this.emptyStore();
    store.providers[providerId] = { apiKey };
    store.updatedAt = new Date().toISOString();
    await this.writeStore(store);
  }

  async getProviderKey(providerId: string): Promise<string | undefined> {
    return (await this.readStore())?.providers[providerId]?.apiKey;
  }

  async listProviders(): Promise<string[]> {
    return Object.keys((await this.readStore())?.providers || {});
  }

  async scrubSensitive(): Promise<DeviceAuthStore | null> {
    const store = await this.readStore();
    if (!store) return null;
    const scrubbed = JSON.parse(JSON.stringify(store));
    if (scrubbed.gatewayToken) scrubbed.gatewayToken = '***';
    for (const p of Object.keys(scrubbed.providers || {})) {
      if (scrubbed.providers[p].apiKey) scrubbed.providers[p].apiKey = '***';
      if (scrubbed.providers[p].refreshToken) scrubbed.providers[p].refreshToken = '***';
    }
    return scrubbed;
  }

  private emptyStore(): DeviceAuthStore {
    return {
      providers: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}
