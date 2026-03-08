import chalk from 'chalk';
import { WebSocket } from 'ws';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { startGateway, getActiveServer } from '../gateway/server';
import { getHyperClawDir, getConfigPath } from './paths';

const execAsync = promisify(exec);

// H-1: Use path helpers so --profile and HYPERCLAW_STATE_DIR are respected
const getHCDir = () => getHyperClawDir();

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
      const port = server.getStatus().port;
      // C3: Readiness check — brief wait then probe WebSocket
      await new Promise(r => setTimeout(r, 400));
      const reachable = await this.probeGateway(port);
      const hcDir = getHCDir();
      const pidFile = path.join(hcDir, 'gateway.pid');
      await fs.ensureDir(hcDir);
      await fs.writeFile(pidFile, String(process.pid), 'utf8');
      if (reachable) {
        s.succeed(`🩸 Daemon started — ws://127.0.0.1:${port}`);
      } else {
        s.warn(`🩸 Daemon started (WebSocket probe pending) — ws://127.0.0.1:${port}`);
      }
      const shutdown = async () => {
        const active = getActiveServer();
        if (active) await active.stop();
        try { await fs.remove(path.join(getHCDir(), 'gateway.pid')); } catch {}
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
    const pidPath = path.join(getHCDir(), 'gateway.pid');
    if (!(await fs.pathExists(pidPath))) {
      console.log(chalk.gray('  Gateway not running (no PID file).'));
      console.log(chalk.gray('  Start it with: hyperclaw daemon start\n'));
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
    const pidPath = path.join(getHCDir(), 'gateway.pid');
    let pidAlive = false;
    let pid: number | null = null;
    let port = 18789;
    if (await fs.pathExists(pidPath)) {
      try {
        pid = parseInt(await fs.readFile(pidPath, 'utf8'), 10);
        process.kill(pid, 0);
        pidAlive = true;
      } catch (e) {
        // M11: Log instead of silent catch
        if (process.env.DEBUG) console.error('[daemon] status pid check:', (e as Error)?.message);
        await fs.remove(pidPath).catch(() => {});
      }
    }
    try {
      const cfg = await fs.readJson(getConfigPath());
      if (cfg?.gateway?.port) port = cfg.gateway.port;
    } catch (e) {
      if (process.env.DEBUG) console.error('[daemon] status config read:', (e as Error)?.message);
    }
    const portOpen = await this.isPortOpen(port);
    const running = pidAlive && portOpen;
    const c = chalk.hex('#06b6d4');
    console.log(c('\n  🩸 HyperClaw Daemon Status'));
    console.log(running ? c('  🩸 ● Running') + chalk.gray(' — gateway reachable') : pidAlive ? chalk.yellow('  🩸 ● Process alive') + chalk.gray(' — port unreachable (may be starting or stuck)') : chalk.gray('  ○ Stopped'));
    if (pid) console.log(chalk.gray(`  PID: ${pid}`));
    console.log(chalk.gray(`  Port: ${port}`));
    console.log(chalk.gray('  Runtime: node'));
    console.log();
  }

  private async isPortOpen(port: number): Promise<boolean> {
    const net = await import('net');
    return new Promise((resolve) => {
      const s = new net.Socket();
      s.setTimeout(500);
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => resolve(false));
      try { s.connect(port, '127.0.0.1'); } catch { resolve(false); }
    });
  }

  private probeGateway(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve(false); }, 2500);
        ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
        ws.on('error', () => { clearTimeout(t); resolve(false); });
      } catch { resolve(false); }
    });
  }

  async logs(): Promise<void> {
    // H-2: Read real log file instead of fake hardcoded output
    const logPath = path.join(getHCDir(), 'logs', 'gateway.log');
    if (await fs.pathExists(logPath)) {
      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.split('\n').slice(-80);
      console.log('\n' + chalk.gray(`  Last 80 lines of ${logPath}:\n`));
      console.log(lines.join('\n'));
    } else {
      let port = 18789;
      try {
        const cfg = await fs.readJson(getConfigPath());
        if (cfg?.gateway?.port) port = cfg.gateway.port;
      } catch (e) {
        if (process.env.DEBUG) console.error('[daemon] logs config read:', (e as Error)?.message);
      }
      console.log(chalk.yellow(`\n  No log file found at ${logPath}`));
      console.log(chalk.gray(`  Start the daemon first: hyperclaw daemon start`));
      console.log(chalk.gray(`  Logs will appear at ${logPath}\n`));
    }
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
    const hcDir = getHCDir();
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
${process.env.HYPERCLAW_STATE_DIR ? `Environment=HYPERCLAW_STATE_DIR=${process.env.HYPERCLAW_STATE_DIR}\n` : ''}${process.env.HYPERCLAW_CONFIG_PATH ? `Environment=HYPERCLAW_CONFIG_PATH=${process.env.HYPERCLAW_CONFIG_PATH}\n` : ''}# Load .env from HyperClaw home if exists
EnvironmentFile=-${path.join(hcDir, '.env')}

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
      // L-4: Catch enable-linger failure (requires systemd 230+ and root-free lingering enabled).
      try {
        await execAsync(`loginctl enable-linger ${username}`);
      } catch (lingerErr: any) {
        console.log(chalk.yellow('  ⚠  Could not enable lingering (service may stop at logout):'));
        console.log(chalk.gray(`     ${lingerErr?.message?.trim() || 'unknown error'}`));
        console.log(chalk.gray('     Run manually as root: loginctl enable-linger ' + username));
      }
      try { await execAsync('systemctl --user daemon-reload'); } catch {}
      try { await execAsync('systemctl --user enable hyperclaw.service'); } catch {}

      console.log(chalk.red('  🩸 Systemd user service installed'));
      console.log(chalk.gray('  ℹ  Lingering enables the service to run without being logged in'));
      console.log(chalk.gray(`  Unit: ${unitFile}`));
    } catch (err) {
      console.log(chalk.yellow('  ⚠  Could not install systemd service — run manually:'));
      console.log(chalk.gray(`  sudo cp hyperclaw.service /etc/systemd/system/`));
    }
  }

  private async installMacOS(): Promise<void> {
    const home = os.homedir();
    const hcDir = getHCDir();
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
  <string>${hcDir}/logs/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>${hcDir}/logs/gateway.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathEscaped}</string>
    <key>HOME</key>
    <string>${home}</string>${process.env.HYPERCLAW_STATE_DIR ? `
    <key>HYPERCLAW_STATE_DIR</key>
    <string>${process.env.HYPERCLAW_STATE_DIR.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</string>` : ''}${process.env.HYPERCLAW_CONFIG_PATH ? `
    <key>HYPERCLAW_CONFIG_PATH</key>
    <string>${process.env.HYPERCLAW_CONFIG_PATH.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</string>` : ''}
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
    const hcDir = getHCDir();
    const nodePath = process.execPath; // e.g. C:\Program Files\nodejs\node.exe
    // Resolve the main script. Order:
    // - flatScript: bundled layout (npm package) — __dirname = dist/, run-main.js same dir
    // - distScript: monorepo dev — daemon at src/infra, dist at project/dist/
    // - fallback: flatScript (assumes published layout)
    const flatScript = path.resolve(__dirname, 'run-main.js');
    const distScript = path.resolve(__dirname, '../../dist/run-main.js');
    const mainScript = (await fs.pathExists(flatScript))
      ? flatScript
      : (await fs.pathExists(distScript))
        ? distScript
        : flatScript;

    const logDir     = path.join(hcDir, 'logs');
    const logFile    = path.join(logDir, 'gateway.log');
    const taskXmlPath = path.join(hcDir, '_task.xml');
    const launcherPath = path.join(hcDir, '_daemon_launcher.cmd');
    const taskName   = 'HyperClaw Gateway';

    await fs.ensureDir(logDir);

    // H3: Emit HYPERCLAW_* env in the installed service — Task Scheduler doesn't support env,
    // so we use a launcher .cmd that sets vars and runs node
    const stateDir = process.env.HYPERCLAW_STATE_DIR;
    const configPath = process.env.HYPERCLAW_CONFIG_PATH;
    const cmdLines: string[] = ['@echo off'];
    if (stateDir) cmdLines.push(`set HYPERCLAW_STATE_DIR=${stateDir.replace(/%/g, '%%')}`);
    if (configPath) cmdLines.push(`set HYPERCLAW_CONFIG_PATH=${configPath.replace(/%/g, '%%')}`);
    cmdLines.push(`"${nodePath.replace(/"/g, '""')}" "${mainScript.replace(/"/g, '""')}" daemon start`);
    await fs.writeFile(launcherPath, cmdLines.join('\r\n'), 'utf8');

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
      <Command>${xmlEsc(launcherPath)}</Command>
      <Arguments></Arguments>
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
