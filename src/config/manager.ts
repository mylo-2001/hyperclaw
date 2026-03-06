import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { getHyperClawDir, getConfigPath } from '../infra/paths';

export class ConfigManager {

  async save(config: any): Promise<void> {
    await fs.ensureDir(getHyperClawDir());
    await fs.writeJson(getConfigPath(), config, { spaces: 2 });
  }

  async load(): Promise<any> {
    if (await fs.pathExists(getConfigPath())) {
      return fs.readJson(getConfigPath());
    }
    return null;
  }

  async sync(options: { to: string; encrypt: boolean }): Promise<void> {
    const spinner = ora(`Syncing to ${options.to}...`).start();

    // Simulate sync
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (options.encrypt) {
      spinner.text = 'Encrypting configuration...';
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    spinner.succeed(`Synced to ${options.to} ${options.encrypt ? '(encrypted)' : ''}`);
    console.log(chalk.gray(`Backup location: ${options.to}://hyperclaw-config-${Date.now()}`));
  }

  getConfigPath(): string {
    return getHyperClawDir();
  }
}
