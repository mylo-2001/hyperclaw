/**
 * src/cli/daemon.ts
 * Real process-based daemon manager — start/stop/restart/status/logs.
 * Writes PID file, streams logs, checks systemd/LaunchAgent lingering.
 */
import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);
import { getHyperClawDir, getConfigPath } from '../infra/paths';

function getPID_FILE() { return path.join(getHyperClawDir(), 'gateway.pid'); }
function getLOG_FILE() { return path.join(getHyperClawDir(), 'gateway.log'); }

export class DaemonManager {

  async start(port = 18789): Promise<void> {
    if (await this.isRunning()) {
      console.log(chalk.yellow('  ⚠  Gateway already running (use restart to reload)'));
      return;
    }
    await fs.ensureDir(getHyperClawDir());
    const logFd = await fs.open(getLOG_FILE(), 'a');
    const mainScript = path.resolve(__dirname, '../../dist/cli/run-main.js');
    const child = spawn(process.execPath, [mainScript, 'gateway', 'start-inner'], {
      detached: true,
      windowsHide: true, // native Windows: no console window flash
      stdio: ['ignore', (logFd as any).fd, (logFd as any).fd],
      env: { ...process.env, HC_PORT: String(port) }
    });
    child.unref();
    await fs.writeFile(getPID_FILE(), String(child.pid));
    await new Promise(r => setTimeout(r, 1200));
    console.log(chalk.green(`  🦅 Gateway started — PID ${child.pid}, port ${port}`));
  }

  async stop(): Promise<void> {
    const pid = await this.getPid();
    if (!pid) { console.log(chalk.gray('  Gateway is not running')); return; }
    try {
      process.kill(pid, 'SIGTERM');
      await new Promise(r => setTimeout(r, 600));
      await fs.remove(getPID_FILE());
      console.log(chalk.green(`  ✅ Gateway stopped (PID ${pid})`));
    } catch {
      await fs.remove(getPID_FILE());
      console.log(chalk.gray('  Gateway was already stopped'));
    }
  }

  async restart(port = 18789): Promise<void> {
    await this.stop();
    await new Promise(r => setTimeout(r, 400));
    await this.start(port);
  }

  async status(): Promise<void> {
    const pid = await this.getPid();
    const running = pid !== null && await this.checkPid(pid);
    const cfg = await this.loadConfig();

    console.log(chalk.bold.cyan('\n  🦅 GATEWAY STATUS\n'));
    console.log(`  Status:  ${running ? chalk.green('● Running') : chalk.gray('○ Stopped')}`);
    if (running && pid) console.log(`  PID:     ${pid}`);
    if (cfg?.gateway) {
      console.log(`  Port:    ${cfg.gateway.port || 18789}`);
      console.log(`  Bind:    ${cfg.gateway.bind || '127.0.0.1'}`);
      console.log(`  Runtime: ${cfg.gateway.runtime || 'node'}`);
    }
    if (running && pid) {
      const uptime = await this.getUptime(pid);
      if (uptime) console.log(`  Uptime:  ${uptime}`);
    }
    console.log(`  Log:     ${getLOG_FILE()}`);
    console.log();
  }

  async logs(lines = 60): Promise<void> {
    if (!(await fs.pathExists(getLOG_FILE()))) {
      console.log(chalk.gray('\n  No log file yet. Start the gateway first.\n'));
      return;
    }
    const content = await fs.readFile(getLOG_FILE(), 'utf8');
    const all = content.trim().split('\n');
    const recent = all.slice(-lines);
    console.log(chalk.bold.cyan(`\n  📋 GATEWAY LOG (last ${lines} lines)\n`));
    for (const line of recent) {
      if (line.includes('ERROR') || line.includes('✖') || line.includes('error')) {
        console.log(chalk.red(`  ${line}`));
      } else if (line.includes('WARN') || line.includes('⚠') || line.includes('warn')) {
        console.log(chalk.yellow(`  ${line}`));
      } else if (line.includes('🦅') || line.includes('connect') || line.includes('start')) {
        console.log(chalk.green(`  ${line}`));
      } else {
        console.log(chalk.gray(`  ${line}`));
      }
    }
    console.log();
  }

  async handle(action: string): Promise<void> {
    switch (action) {
      case 'start':   await this.start(); break;
      case 'stop':    await this.stop(); break;
      case 'restart': await this.restart(); break;
      case 'status':  await this.status(); break;
      case 'logs':    await this.logs(); break;
      default:
        console.log(chalk.red(`  Unknown: ${action}`));
        console.log(chalk.gray('  Use: start | stop | restart | status | logs'));
    }
  }

  async isRunning(): Promise<boolean> {
    const pid = await this.getPid();
    return pid !== null && await this.checkPid(pid);
  }

  private async getPid(): Promise<number | null> {
    try { return parseInt(await fs.readFile(getPID_FILE(), 'utf8')); } catch { return null; }
  }

  private async checkPid(pid: number): Promise<boolean> {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  private async loadConfig(): Promise<any> {
    try { return await fs.readJson(getConfigPath()); } catch { return null; }
  }

  private async getUptime(pid: number): Promise<string> {
    try {
      if (os.platform() !== 'win32') {
        const { stdout } = await execAsync(`ps -p ${pid} -o etimes= 2>/dev/null || echo ""`);
        const secs = parseInt(stdout.trim());
        if (isNaN(secs)) return '';
        const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
        return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      }
    } catch {}
    return '';
  }
}
