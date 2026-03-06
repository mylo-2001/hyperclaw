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

  async uninstall(): Promise<void> {
    const platform = os.platform();
    if (platform === 'darwin') {
      const plistPath = path.join(os.homedir(), 'Library/LaunchAgents/ai.hyperclaw.gateway.plist');
      try { await execAsync(`launchctl unload ${plistPath}`); } catch {}
      await fs.remove(plistPath).catch(() => {});
      console.log(chalk.green('  ✅ LaunchAgent removed'));
    } else if (platform === 'linux') {
      try { await execAsync('systemctl --user disable --now hyperclaw.service'); } catch {}
      const unitFile = path.join(os.homedir(), '.config', 'systemd', 'user', 'hyperclaw.service');
      await fs.remove(unitFile).catch(() => {});
      try { await execAsync('systemctl --user daemon-reload'); } catch {}
      console.log(chalk.green('  ✅ Systemd user service removed'));
    } else if (platform === 'win32') {
      try {
        await execAsync(`schtasks /end /tn "HyperClaw Gateway"`).catch(() => {});
        await execAsync(`schtasks /delete /tn "HyperClaw Gateway" /f`);
        console.log(chalk.green('  ✅ Task Scheduler entry removed'));
      } catch (e: any) {
        console.log(chalk.yellow('  ⚠  Could not remove task:'), e.message);
        console.log(chalk.gray('  Run manually: schtasks /delete /tn "HyperClaw Gateway" /f'));
      }
    }
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
      start:     () => this.start(),
      stop:      () => this.stop(),
      restart:   () => this.restart(),
      status:    () => this.status(),
      logs:      () => this.logs(),
      install:   () => this.install(),
      uninstall: () => this.uninstall(),
    };
    const fn = actions[action];
    if (fn) await fn();
    else console.log(chalk.red(`Unknown action: ${action}`) + chalk.gray('\n  🩸 Use: start, stop, restart, status, logs, install, uninstall'));
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
    const home = os.homedir();
    const nodePath = process.execPath; // e.g. C:\Program Files\nodejs\node.exe
    // Resolve the main script — works both from source (ts-node) and after npm install (dist/)
    const fromDist = path.resolve(__dirname, '../../dist/cli/run-main.js');
    const fromSrc  = path.resolve(__dirname, '../cli/run-main.js');
    const mainScript = require('fs').existsSync(fromDist) ? fromDist : fromSrc;

    const logDir     = path.join(home, '.hyperclaw', 'logs');
    const logFile    = path.join(logDir, 'gateway.log');
    const taskXmlPath = path.join(home, '.hyperclaw', '_task.xml');
    const taskName   = 'HyperClaw Gateway';

    await fs.ensureDir(logDir);

    // Current user in DOMAIN\User format (required by LogonTrigger/Principal)
    const username   = os.userInfo().username;
    const userdomain = process.env.USERDOMAIN || os.hostname();
    const userId     = `${userdomain}\\${username}`;

    const xmlEsc = (s: string) => s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // User-level task — no elevation (LeastPrivilege), runs in interactive session
    // so it has full desktop access: clipboard, screenshots, UI, correct HOME
    const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>HyperClaw AI Gateway — auto-start on logon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xmlEsc(userId)}</UserId>
      <Delay>PT30S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEsc(userId)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEsc(nodePath)}</Command>
      <Arguments>${xmlEsc(mainScript)} daemon start</Arguments>
      <WorkingDirectory>${xmlEsc(home)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;

    // schtasks /xml requires UTF-16 LE with BOM
    const buf = Buffer.from('\ufeff' + taskXml, 'utf16le');
    await fs.writeFile(taskXmlPath, buf);

    try {
      await execAsync(`schtasks /delete /tn "${taskName}" /f`).catch(() => {});
      await execAsync(`schtasks /create /tn "${taskName}" /xml "${taskXmlPath}" /f`);
      await fs.remove(taskXmlPath).catch(() => {});
      // Start immediately — no need to wait for next logon
      await execAsync(`schtasks /run /tn "${taskName}"`).catch(() => {});

      console.log(chalk.green('  ✅ Task Scheduler entry created — starts on every logon'));
      console.log(chalk.gray(`  User:    ${userId}`));
      console.log(chalk.gray(`  Node:    ${nodePath}`));
      console.log(chalk.gray(`  Script:  ${mainScript}`));
      console.log(chalk.gray(`  Log:     ${logFile}`));
      console.log(chalk.gray(`  Manage:  Task Scheduler → Task Scheduler Library → "${taskName}"`));
      console.log(chalk.gray(`  Remove:  schtasks /delete /tn "${taskName}" /f`));
    } catch (e: any) {
      await fs.remove(taskXmlPath).catch(() => {});
      console.log(chalk.yellow('\n  ⚠  Could not create Task Scheduler entry automatically'));
      console.log(chalk.gray('  Run in PowerShell (no admin needed):'));
      console.log(chalk.cyan(`  schtasks /create /tn "${taskName}" /tr "\\"${nodePath}\\" \\"${mainScript}\\" daemon start" /sc onlogon /f`));
      console.log(chalk.gray('\n  Or start manually (runs until reboot):'));
      console.log(chalk.cyan('  hyperclaw daemon start'));
      console.log(chalk.gray(`\n  Error: ${e.message}`));
    }
  }
}
