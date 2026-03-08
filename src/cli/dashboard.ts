import chalk from 'chalk';
import { spawn } from 'child_process';
import path from 'path';
import { GatewayManager } from './gateway';
import { ConfigManager } from './config';
import { SkillHub } from '../plugins/hub';
import { checkForUpdates } from '../infra/update-check';
import fs from 'fs-extra';
import pathModule from 'path';

export class Dashboard {
  private liveInterval: ReturnType<typeof setInterval> | null = null;

  async launch(live: boolean): Promise<void> {
    console.clear();
    await this.drawDashboard();

    if (live) {
      console.log(chalk.hex('#06b6d4')('● LIVE MODE — Ctrl+C to exit\n'));
      this.startLiveUpdates();
    }

    // C2: Wire command shortcuts
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (key: string) => this.handleKey(key));
    }
  }

  private handleKey(key: string): void {
    const k = key.toLowerCase();
    if (k === 'q' || k === '\u0003') {
      this.cleanup();
      process.exit(0);
    }
    if (k === 'd') {
      this.runCommand(['daemon', 'status']);
    } else if (k === 'h') {
      this.runCommand(['hub']);
    } else if (k === 'g') {
      this.runCommand(['gateway', 'status']);
    } else if (k === 'm') {
      this.runCommand(['memory', 'show']);
    }
  }

  private runCommand(args: string[]): void {
    const entryDir = typeof require !== 'undefined' && require.main?.filename
      ? path.dirname(require.main.filename)
      : __dirname;
    const entry = path.join(entryDir, 'run-main.js');
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: 'inherit',
      env: process.env,
      cwd: process.cwd()
    });
    child.on('exit', () => {
      console.log(chalk.gray('\n  Press a key: [d] daemon  [h] hub  [g] gateway  [m] memory  [q] quit\n'));
    });
  }

  private cleanup(): void {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  }

  private async drawDashboard(): Promise<void> {
    const cfg = await (new ConfigManager()).load();
    const gm = new GatewayManager();
    const hub = new SkillHub();
    const installed = await hub.getInstalled();

    // Check for updates (with short timeout so dashboard isn't delayed)
    let updateNotice: string | null = null;
    try {
      const pkgPath = pathModule.join(__dirname, '../package.json');
      const pkg = await fs.readJson(pkgPath).catch(() => null);
      const current = pkg?.version ?? '0.0.0';
      const upd = await Promise.race([
        checkForUpdates(current),
        new Promise<null>(r => setTimeout(() => r(null), 2500))
      ]);
      if (upd?.available) {
        updateNotice = chalk.yellow(`⬆  Update available: ${upd.latest}`) + chalk.gray(`  →  npm i -g hyperclaw`);
      }
    } catch {}

    const port = cfg?.gateway?.port ?? 18789;
    const agent = cfg?.identity?.agentName || 'Hyper';
    const user = cfg?.identity?.userName || 'Boss';
    const model = cfg?.provider?.modelId || 'openrouter/auto';
    const channels = ((cfg as any)?.channels ?? cfg?.gateway?.enabledChannels ?? ['cli']).join(', ');
    const isRunning = await gm.isRunning(port);

    const statusDot = isRunning ? chalk.hex('#06b6d4')('●') : chalk.gray('○');
    const statusText = isRunning ? chalk.hex('#06b6d4')('Running') : chalk.gray('Stopped');
    const w = 72;
    const line = '='.repeat(w);

    const c = chalk.hex('#06b6d4');
    const row = (content: string) => {
      const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
      const pad = Math.max(0, w - stripped.length - 1);
      return c('│ ') + content + ' '.repeat(pad) + c('│');
    };

    const logRow = (content: string) => console.log(row(content));

    console.log(c('├' + line + '┤'));
    console.log(c('│') + chalk.bold.hex('#06b6d4')(`${'🦅 HYPERCLAW v5.2.1 — GATEWAY DASHBOARD'.padStart(45).padEnd(w)}`) + c('│'));
    console.log(c('├' + line + '┤'));
    logRow(`${statusDot} Gateway  ${statusText}   ${chalk.gray('│')}  ws://localhost:${port}   ${chalk.gray('│')}  Agent: ${c(agent)}`);
    logRow(`${c('●')} Model     ${chalk.gray(model.slice(0, 30))}   ${chalk.gray('│')}  User: ${c(user)}`);
    console.log(c('├' + '-'.repeat(w) + '┤'));
    logRow(chalk.bold('ACTIVE CHANNELS'));

    const chList = (channels || 'cli').split(', ');
    for (let i = 0; i < chList.length; i += 3) {
      const group = chList.slice(i, i + 3).map(ch => `  ${c('●')} ${ch.padEnd(12)}`).join('');
      logRow(group);
    }

    console.log(c('├' + '-'.repeat(w) + '┤'));
    logRow(chalk.bold('INSTALLED SKILLS'));

    if (installed.length === 0) {
      logRow(chalk.gray('  No skills installed. Run: hyperclaw hub'));
    } else {
      for (let i = 0; i < installed.length; i += 3) {
        const group = installed.slice(i, i + 3).map(s => `  ${c('●')} ${s.name.slice(0, 14).padEnd(14)}`).join('');
        logRow(group);
      }
    }

    console.log(c('├' + '-'.repeat(w) + '┤'));
    logRow(chalk.bold('STATUS'));
    const now = new Date().toLocaleTimeString();
    logRow(`  [${now}] Gateway: ${isRunning ? c('online') : chalk.gray('offline')}  Port: ${port}`);
    logRow(`  [${now}] Channels: ${channels || 'cli'}`);
    console.log(c('├' + '-'.repeat(w) + '┤'));
    if (updateNotice) {
      logRow(`  ${updateNotice}`);
    }
    logRow(chalk.gray('Commands: [d] ') + chalk.red('daemon') + chalk.gray('  [h] hub  [g] gateway  [m] memory  [q] quit'));
    console.log(c('└' + line + '┘\n'));
  }

  private startLiveUpdates(): void {
    const defaultPort = 18789;
    let tick = 0;
    this.liveInterval = setInterval(async () => {
      tick++;
      const t = new Date().toLocaleTimeString();
      // M4: Show real gateway status instead of fake rotating states
      const gm = new GatewayManager();
      const cfg = await (new ConfigManager()).load().catch(() => null);
      const p = cfg?.gateway?.port ?? defaultPort;
      const isRunning = await gm.isRunning(p);
      const status = isRunning ? chalk.hex('#06b6d4')('Running') : chalk.gray('Stopped');
      process.stdout.write(chalk.gray(`  [${t}] Heartbeat #${tick}: Gateway ${status}\n`));
    }, 3000);
  }
}
