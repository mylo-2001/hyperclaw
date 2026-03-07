/**
 * src/infra/device-pairing.ts
 * Node/device pairing — iOS, Android, macOS, headless nodes connect to the
 * gateway as devices with role: node. Each device must be approved before
 * it can send/receive messages.
 *
 * State files (under ~/.hyperclaw/devices/):
 *   pending.json  — short-lived requests, expire after PENDING_EXPIRY_MS
 *   paired.json   — approved devices + their tokens
 *
 * Setup code (for /pair Telegram command):
 *   base64-encoded JSON: { url: string, token: string }
 *   Treat like a password while valid.
 *
 * CLI: hyperclaw devices list / approve <requestId> / reject <requestId>
 */

import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEVICES_DIR = path.join(os.homedir(), '.hyperclaw', 'devices');
const PENDING_FILE = path.join(DEVICES_DIR, 'pending.json');
const PAIRED_FILE = path.join(DEVICES_DIR, 'paired.json');

const PENDING_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes for setup codes
const TOKEN_BYTES = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingDevice {
  requestId: string;
  /** Short-lived token embedded in the setup code */
  token: string;
  /** When this request expires */
  expiresAt: string;
  createdAt: string;
  /** Hint provided by the device (optional) */
  deviceName?: string;
  platform?: string;
}

export interface PairedDevice {
  deviceId: string;
  requestId: string;
  /** Long-lived auth token for this device */
  token: string;
  pairedAt: string;
  deviceName?: string;
  platform?: string;
  lastSeenAt?: string;
}

export interface SetupCode {
  /** Gateway WebSocket URL */
  url: string;
  /** Short-lived pairing token */
  token: string;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function readPending(): Promise<PendingDevice[]> {
  try {
    const data = await fs.readJson(PENDING_FILE);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writePending(entries: PendingDevice[]): Promise<void> {
  await fs.ensureDir(DEVICES_DIR);
  await fs.writeJson(PENDING_FILE, entries, { spaces: 2, mode: 0o600 });
}

async function readPaired(): Promise<PairedDevice[]> {
  try {
    const data = await fs.readJson(PAIRED_FILE);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writePaired(devices: PairedDevice[]): Promise<void> {
  await fs.ensureDir(DEVICES_DIR);
  await fs.writeJson(PAIRED_FILE, devices, { spaces: 2, mode: 0o600 });
}

// ---------------------------------------------------------------------------
// DevicePairingStore
// ---------------------------------------------------------------------------

export class DevicePairingStore {

  // ---- Create a new pending request + setup code --------------------------

  /**
   * Creates a pending pairing request and returns:
   *   - requestId: show to user for approve/reject
   *   - setupCode: base64-encoded JSON {url, token} — send to device
   */
  async createRequest(
    gatewayUrl: string,
    opts?: { deviceName?: string; platform?: string }
  ): Promise<{ requestId: string; setupCode: string; expiresAt: string }> {
    const now = Date.now();
    // Prune expired entries
    const all = (await readPending()).filter(e => new Date(e.expiresAt).getTime() > now);

    const requestId = crypto.randomBytes(6).toString('hex');
    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(now + PENDING_EXPIRY_MS).toISOString();

    const entry: PendingDevice = {
      requestId,
      token,
      expiresAt,
      createdAt: new Date().toISOString(),
      ...(opts?.deviceName ? { deviceName: opts.deviceName } : {}),
      ...(opts?.platform ? { platform: opts.platform } : {})
    };
    all.push(entry);
    await writePending(all);

    const payload: SetupCode = { url: gatewayUrl, token };
    const setupCode = Buffer.from(JSON.stringify(payload)).toString('base64');

    return { requestId, setupCode, expiresAt };
  }

  // ---- List pending requests -----------------------------------------------

  async listPending(): Promise<PendingDevice[]> {
    const now = Date.now();
    const all = await readPending();
    return all.filter(e => new Date(e.expiresAt).getTime() > now);
  }

  // ---- List paired devices -------------------------------------------------

  async listPaired(): Promise<PairedDevice[]> {
    return readPaired();
  }

  // ---- Approve a pending request -------------------------------------------

  async approve(requestId: string): Promise<PairedDevice | null> {
    const now = Date.now();
    const pending = await readPending();
    const idx = pending.findIndex(e =>
      e.requestId === requestId &&
      new Date(e.expiresAt).getTime() > now
    );
    if (idx === -1) return null;

    const entry = pending[idx];
    pending.splice(idx, 1);
    await writePending(pending);

    const deviceId = `device-${crypto.randomBytes(4).toString('hex')}`;
    const longToken = crypto.randomBytes(32).toString('hex');
    const device: PairedDevice = {
      deviceId,
      requestId: entry.requestId,
      token: longToken,
      pairedAt: new Date().toISOString(),
      ...(entry.deviceName ? { deviceName: entry.deviceName } : {}),
      ...(entry.platform ? { platform: entry.platform } : {})
    };

    const paired = await readPaired();
    paired.push(device);
    await writePaired(paired);

    return device;
  }

  // ---- Reject a pending request --------------------------------------------

  async reject(requestId: string): Promise<boolean> {
    const pending = await readPending();
    const idx = pending.findIndex(e => e.requestId === requestId);
    if (idx === -1) return false;
    pending.splice(idx, 1);
    await writePending(pending);
    return true;
  }

  // ---- Remove a paired device ---------------------------------------------

  async unpair(deviceId: string): Promise<boolean> {
    const paired = await readPaired();
    const idx = paired.findIndex(d => d.deviceId === deviceId);
    if (idx === -1) return false;
    paired.splice(idx, 1);
    await writePaired(paired);
    return true;
  }

  // ---- Verify a device token (called by gateway on WS connect) ------------

  async verifyToken(token: string): Promise<PairedDevice | null> {
    const now = Date.now();
    // Also accept short-lived tokens (pending requests, still valid)
    const pending = await readPending();
    const pendingMatch = pending.find(e =>
      e.token === token && new Date(e.expiresAt).getTime() > now
    );
    if (pendingMatch) {
      // Auto-approve on first connect if token is valid
      return this.approve(pendingMatch.requestId);
    }

    // Check paired devices
    const paired = await readPaired();
    return paired.find(d => d.token === token) ?? null;
  }

  // ---- Update lastSeenAt for a connected device ---------------------------

  async touchDevice(deviceId: string): Promise<void> {
    const paired = await readPaired();
    const device = paired.find(d => d.deviceId === deviceId);
    if (device) {
      device.lastSeenAt = new Date().toISOString();
      await writePaired(paired);
    }
  }

  // ---- Parse setup code (for device-side use) ------------------------------

  static parseSetupCode(setupCode: string): SetupCode | null {
    try {
      const json = Buffer.from(setupCode, 'base64').toString('utf8');
      const parsed = JSON.parse(json);
      if (typeof parsed.url === 'string' && typeof parsed.token === 'string') {
        return parsed as SetupCode;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---- CLI display ---------------------------------------------------------

  async showCLI(): Promise<void> {
    const now = Date.now();
    const pending = (await readPending()).filter(e => new Date(e.expiresAt).getTime() > now);
    const paired = await readPaired();

    console.log(chalk.bold.cyan('\n  📱 DEVICE PAIRING\n'));

    if (pending.length > 0) {
      console.log(chalk.yellow('  Pending requests:\n'));
      for (const e of pending) {
        const expiresIn = Math.round((new Date(e.expiresAt).getTime() - now) / 60000);
        const name = e.deviceName ? chalk.white(` "${e.deviceName}"`) : '';
        const plat = e.platform ? chalk.gray(` (${e.platform})`) : '';
        console.log(`  ${chalk.yellow('○')} ${chalk.bold(e.requestId)}${name}${plat}  ${chalk.gray(`expires in ${expiresIn}m`)}`);
      }
      console.log();
    }

    if (paired.length > 0) {
      console.log(chalk.green('  Paired devices:\n'));
      for (const d of paired) {
        const name = d.deviceName ? chalk.white(` "${d.deviceName}"`) : '';
        const plat = d.platform ? chalk.gray(` (${d.platform})`) : '';
        const seen = d.lastSeenAt ? chalk.gray(`  last seen: ${new Date(d.lastSeenAt).toLocaleDateString()}`) : '';
        console.log(`  ${chalk.green('●')} ${chalk.bold(d.deviceId)}${name}${plat}  ${chalk.gray(`paired: ${new Date(d.pairedAt).toLocaleDateString()}`)}${seen}`);
      }
      console.log();
    }

    if (pending.length === 0 && paired.length === 0) {
      console.log(chalk.gray('  No pending or paired devices.'));
      console.log(chalk.gray('  In Telegram, message your bot: /pair\n'));
    }
  }
}
