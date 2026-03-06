/**
 * src/infra/device-auth-store.ts
 * Secure credential store for gateway tokens and provider keys.
 * Mirrors OpenClaw's device-auth-store with mode 0o600 enforcement.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

export interface DeviceAuthStore {
  gatewayToken?: string;
  providers: Record<string, { apiKey?: string; refreshToken?: string; expiresAt?: number }>;
  createdAt: string;
  updatedAt: string;
}

export class AuthStore {
  private storePath: string;

  constructor(storeDir?: string) {
    const dir = storeDir || path.join(os.homedir(), '.hyperclaw');
    this.storePath = path.join(dir, 'auth.json');
  }

  private readStore(): DeviceAuthStore | null {
    try {
      // Validate permissions before reading
      const stat = fs.statSync(this.storePath);
      if ((stat.mode & 0o077) !== 0) {
        console.log(chalk.yellow('  ⚠  Auth store has unsafe permissions — fixing...'));
        fs.chmodSync(this.storePath, 0o600);
      }
      return fs.readJsonSync(this.storePath) as DeviceAuthStore;
    } catch {
      return null;
    }
  }

  private writeStore(store: DeviceAuthStore): void {
    fs.ensureDirSync(path.dirname(this.storePath));
    fs.writeFileSync(
      this.storePath,
      `${JSON.stringify(store, null, 2)}\n`,
      { mode: 0o600 }
    );
  }

  getGatewayToken(): string | undefined {
    return this.readStore()?.gatewayToken;
  }

  setGatewayToken(token: string): void {
    const store = this.readStore() || this.emptyStore();
    store.gatewayToken = token;
    store.updatedAt = new Date().toISOString();
    this.writeStore(store);
  }

  setProviderKey(providerId: string, apiKey: string): void {
    const store = this.readStore() || this.emptyStore();
    store.providers[providerId] = { apiKey };
    store.updatedAt = new Date().toISOString();
    this.writeStore(store);
  }

  getProviderKey(providerId: string): string | undefined {
    return this.readStore()?.providers[providerId]?.apiKey;
  }

  listProviders(): string[] {
    return Object.keys(this.readStore()?.providers || {});
  }

  scrubSensitive(): DeviceAuthStore | null {
    const store = this.readStore();
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
