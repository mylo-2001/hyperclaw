import fs from 'fs-extra';
import { getHyperClawDir, getConfigPath } from '../infra/paths';

export class ConfigManager {

  async save(config: any): Promise<void> {
    const target = getConfigPath();
    const tmp = target + '.tmp';
    await fs.ensureDir(getHyperClawDir());
    await fs.writeJson(tmp, config, { spaces: 2 });
    await fs.chmod(tmp, 0o600).catch(() => {});
    await fs.rename(tmp, target);
  }

  async load(): Promise<any> {
    if (await fs.pathExists(getConfigPath())) {
      return fs.readJson(getConfigPath());
    }
    return null;
  }

  // M-9: sync() was a fake stub that simulated work with setTimeout.
  // Replaced with an honest not-implemented error so callers fail clearly instead
  // of silently doing nothing while printing a success message.
  async sync(_options: { to: string; encrypt: boolean }): Promise<void> {
    throw new Error(
      'ConfigManager.sync() is not implemented. ' +
      'To back up your config, copy ~/.hyperclaw/hyperclaw.json manually.'
    );
  }

  getConfigPath(): string {
    return getConfigPath();
  }
}
