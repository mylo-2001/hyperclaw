/**
 * @hyperclaw/shared — path resolution
 * Respects HYPERCLAW_HOME, HYPERCLAW_STATE_DIR, HYPERCLAW_CONFIG_PATH.
 */
import path from 'path';
import os from 'os';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') return path.join(os.homedir(), p.slice(1));
  return p;
}

export function getHyperClawDir(): string {
  const stateDir = process.env.HYPERCLAW_STATE_DIR;
  if (stateDir) return expandHome(stateDir);
  const home = process.env.HYPERCLAW_HOME;
  const base = home ? expandHome(home) : os.homedir();
  return path.join(base, '.hyperclaw');
}

export function getConfigPath(): string {
  const cfg = process.env.HYPERCLAW_CONFIG_PATH;
  if (cfg) return expandHome(cfg);
  return path.join(getHyperClawDir(), 'hyperclaw.json');
}

export function getEnvFilePath(): string {
  return path.join(getHyperClawDir(), '.env');
}
