/**
 * src/infra/update-check.ts
 * Check npm registry for available updates and notify the user.
 */

import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import https from 'https';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const PACKAGE_NAME = 'hyperclaw';

function parseVersion(v: string): number[] {
  const match = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

export async function checkForUpdates(currentVersion: string): Promise<{ latest: string; available: boolean } | null> {
  if (process.env.HYPERCLAW_NO_UPDATE_CHECK === '1') return null;

  return new Promise((resolve) => {
    const req = https.get(
      `${NPM_REGISTRY}/${PACKAGE_NAME}/latest`,
      { timeout: 3000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const latest = json?.version;
            if (!latest || typeof latest !== 'string') {
              resolve(null);
              return;
            }
            resolve({
              latest,
              available: isNewer(latest, currentVersion)
            });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export function notifyUpdateAvailable(current: string, latest: string): void {
  console.log(chalk.yellow(`  🦅 Update available: ${latest} (you have ${current})`));
  console.log(chalk.gray('     Run: npm i -g hyperclaw\n'));
}

/** Fire-and-forget: check for updates and notify user if available. Call after banner/startup. */
export function maybeShowUpdateNotice(skipInDaemon = false): void {
  if (skipInDaemon) return;
  (async () => {
    try {
      const pkgPath = path.join(__dirname, '../package.json');
      const pkg = await fs.readJson(pkgPath).catch(() => null);
      const current = pkg?.version ?? '0.0.0';
      const result = await checkForUpdates(current);
      if (result?.available) notifyUpdateAvailable(current, result.latest);
    } catch {}
  })().catch(() => {});
}
