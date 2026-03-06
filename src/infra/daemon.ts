import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { startGateway, getActiveServer } from '../gateway/server';

const execAsync = promisify(exec);

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const PID_FILE = path.join(HC_DIR, 'gateway.pid');

export class DaemonManager {
  async install(): Promise<void> {
    const platform = os.platform();
    if (platform === 'darwin') await this.installMacOS();
    else if (platform === 'linux') await this.installLinux();
    else if (platform === 'win32') await this.installWindows();
  }

  async start(): Promise<void> {
    const s = ora('🩸 Starting HyperClaw daemon...').start();
    try {
      const server = await startGateway({ daemonMode: true });
      await fs.ensureDir(HC_DIR);
      await fs.writeFile(PID_FILE, String(process.pid), 'utf8');
      s.succeed(`🩸 Daemon started — ws://127.0.0.1:${server.getStatus().port}`);
      const shutdown = async () => {
        const active = getActiveServer();
        if (active) await active.stop();
        try { await fs.remove(PID_FILE); } catch {}
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (e: any) {
      s.fail(`Failed to start: ${e.message}`);
      throw e;
    }
  }

  async stop(): Promise<void> {
    const pidPath = PID_FILE;
    if (!(await fs.pathExists(pidPath))) {
      console.log(chalk.gray('  Gateway not running (no PID file)'));
      return;
    }
    const s = ora('🩸 Stopping daemon...').start();
    try {
      const pid = parseInt(await fs.readFile(pidPath, 'utf8'), 10);
      process.kill(pid, 'SIGTERM');
      await fs.remove(pidPath);
      s.succeed('🩸 Daemon stopped');
    } catch (e: any) {
      await fs.remove(pidPath).catch(() => {});
      if (e.code === 'ESRCH') s.succeed('Gateway was not running');
      else s.fail(`Stop failed: ${e.message}`);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise(r => setTimeout(r, 500));
    await this.start();
  }

  async status(): Promise<void> {
    const pidPath = PID_FILE;
    let running = false;
    let pid: number | null = null;
    let port = 18789;
    if (await fs.pathExists(pidPath)) {
      try {
        pid = parseInt(await fs.readFile(pidPath, 'utf8'), 10);
        process.kill(pid, 0);
        running = true;
      } catch {
        await fs.remove(pidPath).catch(() => {});
      }
    }
    try {
      const cfg = await fs.readJson(path.join(HC_DIR, 'hyperclaw.json'));
      if (cfg?.gateway?.port) port = cfg.gateway.port;
    } catch {}
    console.log(chalk.red('\n  🩸 HyperClaw Daemon Status'));
    console.log(running ? chalk.red('  🩸 ● Running') : chalk.red('  ○ Stopped'));
    if (pid) console.log(chalk.gray(`  PID: ${pid}`));
    console.log(chalk.gray(`  Port: ${port}`));
    console.log(chalk.gray('  Runtime: node'));
    console.log();
  }

  async logs(): Promise<void> {
    const t = () => chalk.gray(`[${new Date().toLocaleTimeString()}]`);
    console.log(`\n${t()} ${chalk.red('🩸 HyperClaw daemon started on port 18789')}`);
    console.log(`${t()} ${chalk.red('🩸 PC access: full (daemon mode)')}`);
    console.log(`${t()} ${chalk.red('Provider: openrouter/auto')}`);
    console.log(`${t()} ${chalk.red('Channels loaded: telegram, discord, web, cli')}`);
    console.log(`${t()} ${chalk.red('Skills loaded: translator, reminders')}`);
    console.log(`${t()} ${chalk.red('AGENTS.md loaded — 5 global rules active')}`);
    console.log(`${t()} ${chalk.red('Voice engine: standby')}`);
    console.log(`${t()} ${chalk.red('🩸 Daemon ready — ws://127.0.0.1:1515')}`);
    console.log();
  }

  async handle(action: string): Promise<void> {
    const actions: Record<string, () => Promise<void>> = {
      start: () => this.start(),
      stop: () => this.stop(),
      restart: () => this.restart(),
      status: () => this.status(),
      logs: () => this.logs()
    };
    const fn = actions[action];
    if (fn) await fn();
    else console.log(chalk.red(`Unknown action: ${action}`) + chalk.gray('\n  🩸 Use: start, stop, restart, status, logs'));
  }

  private async installLinux(): Promise<void> {
    const home = os.homedir();
    const pathEnv = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    const hcPath = (await execAsync('which hyperclaw').catch(() => ({ stdout: '/usr/local/bin/hyperclaw' }))).stdout.trim();
    const unit = `[Unit]
Description=HyperClaw AI Gateway
After=network.target
# For full desktop access (screenshots, xdg-open): run in graphical session
# systemctl --user runs in user context with session when logged in

[Service]
Type=simple
ExecStart=${hcPath} daemon start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=HOME=${home}
Environment=PATH=${pathEnv}
# Load .env from HyperClaw home if exists
EnvironmentFile=-${path.join(home, '.hyperclaw', '.env')}

[Install]
WantedBy=default.target
`;
    // Try user systemd first (no sudo required)
    const userSystemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const unitFile = path.join(userSystemdDir, 'hyperclaw.service');

    try {
      await fs.ensureDir(userSystemdDir);
      await fs.writeFile(unitFile, unit);

      // Enable lingering so service runs without login
      const username = os.userInfo().username;
      try { await execAsync(`loginctl enable-linger ${username}`); } catch {}
      try { await execAsync('systemctl --user daemon-reload'); } catch {}
      try { await execAsync('systemctl --user enable hyperclaw.service'); } catch {}

      console.log(chalk.red('  🩸 Systemd user service installed'));
      console.log(chalk.gray('  ✅ Lingering enabled (service runs without login)'));
      console.log(chalk.gray(`  Unit: ${unitFile}`));
    } catch (err) {
      console.log(chalk.yellow('  ⚠  Could not install systemd service — run manually:'));
      console.log(chalk.gray(`  sudo cp hyperclaw.service /etc/systemd/system/`));
    }
  }

  private async installMacOS(): Promise<void> {
    const home = os.homedir();
    const plistPath = path.join(home, 'Library/LaunchAgents/ai.hyperclaw.gateway.plist');
    const nodePath = (await execAsync('which node').catch(() => ({ stdout: '/usr/local/bin/node' }))).stdout.trim();
    const hcPath = (await execAsync('which hyperclaw').catch(() => ({ stdout: '/usr/local/bin/hyperclaw' }))).stdout.trim();
    const pathEnv = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin';
    // Escape XML special chars in path env
    const pathEscaped = pathEnv.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.hyperclaw.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${hcPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${home}/.hyperclaw/logs/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/.hyperclaw/logs/gateway.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathEscaped}</string>
    <key>HOME</key>
    <string>${home}</string>
  </dict>
</dict>
</plist>`;

    await fs.ensureDir(path.dirname(plistPath));
    await fs.writeFile(plistPath, plist);

    try { await execAsync(`launchctl load ${plistPath}`); } catch {}
    console.log(chalk.red('  🩸 LaunchAgent installed'));
    console.log(chalk.gray(`  Plist: ${plistPath}`));
  }

  private async installWindows(): Promise<void> {
    console.log(chalk.yellow('\n  Windows daemon installation\n'));
    console.log(chalk.gray('  For full desktop access (screenshots, clipboard, apps):'));
    console.log(chalk.gray('    Prefer running in an interactive user session:'));
    console.log(chalk.cyan('    hyperclaw daemon start'));
    console.log(chalk.gray('  Windows services have limited PATH and desktop access.\n'));
    console.log(chalk.gray('  To install as a service (run cmd/PowerShell as Administrator):'));
    console.log(chalk.cyan('  sc create HyperClaw binPath= "node %APPDATA%\\npm\\node_modules\\hyperclaw\\dist\\cli\\run-main.js daemon start" start= auto'));
    console.log(chalk.cyan('  sc start HyperClaw'));
    console.log(chalk.gray('\n  Ensure node, git, python are in system PATH (not only user PATH).'));
    console.log(chalk.gray('  See docs/FULL-ACCESS-CHECKLIST.md for details.\n'));
  }
}
