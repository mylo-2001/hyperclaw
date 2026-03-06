/**
 * src/infra/developer-keys.ts
 * Developer API keys for managed hosting / embed-in-any-app.
 * Keys allow third-party apps to call the gateway via Authorization: Bearer <key>.
 */

import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { getHyperClawDir } from '../../packages/shared/src/paths';

export interface DeveloperKeyEntry {
  id: string;
  name: string;
  keyHash: string;
  /** Optional: tenant ID for multi-tenant SaaS */
  tenantId?: string;
  createdAt: string;
  lastUsedAt?: string;
}

const KEYS_FILE = 'developer-keys.json';

function getKeysPath(baseDir?: string): string {
  const root = baseDir ?? getHyperClawDir();
  return path.join(root, KEYS_FILE);
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

function generateKey(): string {
  return `hc_${crypto.randomBytes(24).toString('base64url')}`;
}

async function loadKeys(baseDir?: string): Promise<DeveloperKeyEntry[]> {
  const fp = getKeysPath(baseDir);
  if (!(await fs.pathExists(fp))) return [];
  try {
    const data = await fs.readJson(fp);
    return Array.isArray(data.keys) ? data.keys : [];
  } catch {
    return [];
  }
}

async function saveKeys(keys: DeveloperKeyEntry[], baseDir?: string): Promise<void> {
  const fp = getKeysPath(baseDir);
  const dir = path.dirname(fp);
  await fs.ensureDir(dir);
  await fs.writeJson(fp, { keys, updatedAt: new Date().toISOString() }, { spaces: 2 });
}

/** Create a new developer key. Returns the raw key (show once). Optional tenantId for multi-tenant. */
export async function createDeveloperKey(
  name: string,
  opts?: { tenantId?: string; baseDir?: string }
): Promise<{ id: string; key: string; name: string; tenantId?: string }> {
  const rawKey = generateKey();
  const keyHash = hashKey(rawKey);
  const id = `key_${crypto.randomBytes(8).toString('hex')}`;
  const entry: DeveloperKeyEntry = {
    id,
    name: name || 'Unnamed',
    keyHash,
    tenantId: opts?.tenantId,
    createdAt: new Date().toISOString()
  };
  const keys = await loadKeys(opts?.baseDir);
  keys.push(entry);
  await saveKeys(keys, opts?.baseDir);
  return { id, key: rawKey, name: entry.name, tenantId: entry.tenantId };
}

/** List developer keys (without raw keys). Optional tenantId filter. */
export async function listDeveloperKeys(opts?: { tenantId?: string; baseDir?: string }): Promise<Array<{ id: string; name: string; tenantId?: string; createdAt: string; lastUsedAt?: string }>> {
  let keys = await loadKeys(opts?.baseDir);
  if (opts?.tenantId) keys = keys.filter((k) => k.tenantId === opts.tenantId);
  return keys.map((k) => ({ id: k.id, name: k.name, tenantId: k.tenantId, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }));
}

/** Revoke a developer key by id. */
export async function revokeDeveloperKey(id: string): Promise<boolean> {
  const keys = await loadKeys();
  const before = keys.length;
  const filtered = keys.filter((k) => k.id !== id);
  if (filtered.length === before) return false;
  await saveKeys(filtered);
  return true;
}

/**
 * Validate a Bearer token. Returns { valid: true, tenantId?: string } or { valid: false }.
 * Use with gateway token check: valid = gatewayToken OR result.valid.
 */
export async function validateDeveloperKey(
  bearer: string,
  opts?: { baseDir?: string }
): Promise<{ valid: boolean; tenantId?: string }> {
  if (!bearer || bearer.length < 20) return { valid: false };
  const keys = await loadKeys(opts?.baseDir);
  const hash = hashKey(bearer);
  const idx = keys.findIndex((k) => k.keyHash === hash);
  if (idx < 0) return { valid: false };
  keys[idx].lastUsedAt = new Date().toISOString();
  await saveKeys(keys, opts?.baseDir).catch(() => {});
  return { valid: true, tenantId: keys[idx].tenantId };
}
