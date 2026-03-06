/**
 * src/cli/gateway.ts
 * GatewayManager — Tailscale, bind, hatch, systemd/LaunchAgent, ws ping.
 */
import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { WebSocket } from 'ws';

const execAsync = promisify(exec);
const HC_DIR = path.join(os.homedir(), '.hyperclaw');

export interface GatewayConfig {
  port: number;
  bind: '127.0.0.1' | '0.0.0.0' | 'tailscale' | string;
  authToken: string;
  tailscaleExposure: 'off' | 'serve' | 'funnel';
  runtime: 'node' | 'bun' | 'deno';
  enabledChannels: string[];
  hooks: boolean;
}

export const GATEWAY_DEFAULTS: GatewayConfig = {
  port: 18789,
  bind: '127.0.0.1',
  authToken: '',
  tailscaleExposure: 'off',
  runtime: 'node',
  enabledChannels: [],
  hooks: true
};

export class GatewayManager {

  async isRunning(port = 18789): Promise<boolean> {
    return this.detect(port);
  }

  async detectRuntime(): Promise<'node' | 'bun' | 'deno'> {
    for (const r of ['bun', 'deno', 'node'] as const) {
      try { await execAsync(`which ${r}`); return r; } catch {}
    }
    return 'node';
  }

  exposureLabel(e: string): string {
    const m: Record<string, string> = { off: 'Off', serve: 'Serve (Tailscale)', funnel: 'Funnel (public)' };
    return m[e] || e;
  }

  async detect(port = 18789): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const t = setTimeout(() => { ws.terminate(); resolve(false); }, 1500);
        ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
        ws.on('error', () => { clearTimeout(t); resolve(false); });
      } catch { resolve(false); }
    });
  }

  async showStatus(cfg: GatewayConfig): Promise<void> {
    const running = await this.detect(cfg.port);
    const bindLabel = {
      '127.0.0.1': 'loopback (localhost only)',
      '0.0.0.0': 'all interfaces (LAN)',
      'tailscale': 'Tailscale VPN only'
    }[cfg.bind] || cfg.bind;

    console.log(chalk.bold.cyan('\n  💻 GATEWAY\n'));
    console.log(`  ${running ? chalk.green('● Running') : chalk.gray('○ Stopped')}  ws://127.0.0.1:${cfg.port}`);
    console.log(`  Bind:     ${bindLabel}`);
    console.log(`  Runtime:  ${cfg.runtime}${cfg.runtime === 'node' ? chalk.gray(' (recommended)') : ''}`);
    if (cfg.tailscaleExposure !== 'off') console.log(`  Tailscale: ${chalk.yellow(cfg.tailscaleExposure)}`);
    console.log(`  Token:    ${cfg.authToken ? chalk.green('set') : chalk.yellow('none (open)')}`);
    console.log(`  Channels: ${cfg.enabledChannels.join(', ') || chalk.gray('none')}`);
    console.log();
  }

  async applyTailscaleExposure(mode: 'serve' | 'funnel', port: number): Promise<void> {
    try {
      if (mode === 'serve') await execAsync(`tailscale serve https / http://localhost:${port}`);
      else await execAsync(`tailscale funnel ${port}`);
      console.log(chalk.green(`  ✅ Tailscale ${mode} enabled`));
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠  Tailscale: ${e.message.slice(0, 60)}`));
    }
  }

  generateToken(): string {
    return require('crypto').randomBytes(32).toString('base64url');
  }

  async resolveBindAddress(bind: string): Promise<string> {
    if (['127.0.0.1', '0.0.0.0'].includes(bind)) return bind;
    if (bind === 'tailscale') {
      try {
        const { stdout } = await execAsync('tailscale ip -4 2>/dev/null');
        return stdout.trim();
      } catch { return '127.0.0.1'; }
    }
    return bind;
  }

  async installService(cfg: GatewayConfig): Promise<void> {
    const platform = os.platform();
    if (platform === 'linux') await this.installSystemd(cfg);
    else if (platform === 'darwin') await this.installLaunchAgent(cfg);
    else console.log(chalk.yellow('  Windows: Use NSSM or Task Scheduler'));
  }

  private async installSystemd(cfg: GatewayConfig): Promise<void> {
    const binary = process.execPath;
    const content = `[Unit]
Description=HyperClaw Gateway
After=network.target

[Service]
Type=simple
ExecStart=${binary} ${path.join(__dirname, '../../dist/cli/run-main.js')} gateway start
Restart=on-failure
RestartSec=5
Environment=PORT=${cfg.port}

[Install]
WantedBy=default.target
`;
    const serviceDir = path.join(os.homedir(), '.config/systemd/user');
    const serviceFile = path.join(serviceDir, 'hyperclaw.service');
    try {
      await fs.ensureDir(serviceDir);
      await fs.writeFile(serviceFile, content);
      await execAsync('systemctl --user daemon-reload');
      await execAsync('systemctl --user enable hyperclaw');
      await execAsync(`loginctl enable-linger ${os.userInfo().username}`).catch(() => {});
      console.log(chalk.green('  ✅ systemd service installed (lingering enabled)'));
    } catch (e: any) {
      console.log(chalk.gray(`  Service file: ${serviceFile}`));
    }
  }

  private async installLaunchAgent(cfg: GatewayConfig): Promise<void> {
    const binary = process.execPath;
    const plistDir = path.join(os.homedir(), 'Library/LaunchAgents');
    const plistPath = path.join(plistDir, 'ai.hyperclaw.gateway.plist');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.hyperclaw.gateway</string>
  <key>ProgramArguments</key><array>
    <string>${binary}</string>
    <string>${path.join(__dirname, '../../dist/cli/run-main.js')}</string>
    <string>gateway</string><string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HC_DIR}/gateway.log</string>
  <key>StandardErrorPath</key><string>${HC_DIR}/gateway.err</string>
</dict></plist>`;
    await fs.ensureDir(plistDir);
    await fs.writeFile(plistPath, content);
    try {
      await execAsync(`launchctl load ${plistPath}`);
      console.log(chalk.green('  ✅ LaunchAgent installed'));
    } catch { console.log(chalk.gray(`  Written: ${plistPath}`)); }
  }

  async reload(port: number, authToken?: string): Promise<void> {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          if (authToken) ws.send(JSON.stringify({ type: 'auth', token: authToken }));
          ws.send(JSON.stringify({ type: 'config:reload' }));
          setTimeout(() => { ws.close(); resolve(); }, 400);
        });
        ws.on('error', reject);
        setTimeout(() => { ws.terminate(); resolve(); }, 2000);
      });
      console.log(chalk.green('  ✅ Gateway reloaded'));
    } catch {
      console.log(chalk.yellow('  ⚠  Gateway not running — changes apply on next start'));
    }
  }
}
