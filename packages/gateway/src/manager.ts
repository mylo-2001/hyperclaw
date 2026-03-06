import chalk from 'chalk';
import crypto from 'crypto';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execAsync = promisify(exec);

export type GatewayBind = '127.0.0.1' | '0.0.0.0' | 'tailscale' | 'custom';
export type TailscaleExposure = 'off' | 'serve' | 'funnel';
export type GatewayRuntime = 'node' | 'bun' | 'deno';

export interface GatewayConfig {
  port: number;
  bind: GatewayBind;
  customBind?: string;
  authToken: string;
  tailscaleExposure: TailscaleExposure;
  runtime: GatewayRuntime;
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
  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async isRunning(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => resolve(false));
      try {
        socket.connect(port, '127.0.0.1');
      } catch {
        resolve(false);
      }
    });
  }

  async detectTailscale(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('tailscale ip -4 2>/dev/null');
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async detectRuntime(): Promise<GatewayRuntime> {
    for (const runtime of ['bun', 'deno', 'node'] as GatewayRuntime[]) {
      try {
        await execAsync(`which ${runtime}`);
        return runtime;
      } catch {}
    }
    return 'node';
  }

  bindLabel(bind: GatewayBind, custom?: string): string {
    const map: Record<GatewayBind, string> = {
      '127.0.0.1': 'Loopback only (this machine)',
      '0.0.0.0': 'All interfaces (LAN accessible)',
      'tailscale': 'Tailscale IP (VPN peers only)',
      'custom': `Custom: ${custom || '?'}`
    };
    return map[bind];
  }

  exposureLabel(e: TailscaleExposure): string {
    const map: Record<TailscaleExposure, string> = {
      'off': 'Off — no Tailscale exposure',
      'serve': 'Serve — accessible to your Tailscale devices',
      'funnel': 'Funnel — publicly accessible via Tailscale URL'
    };
    return map[e];
  }

  async applyTailscaleExposure(exposure: TailscaleExposure, port: number): Promise<void> {
    if (exposure === 'off') return;
    try {
      if (exposure === 'serve') {
        await execAsync(`tailscale serve ${port}`);
      } else if (exposure === 'funnel') {
        await execAsync(`tailscale funnel ${port}`);
      }
    } catch {
      console.log(chalk.yellow('⚠️  Tailscale exposure failed — check tailscale is running'));
    }
  }

  getWsUrl(config: GatewayConfig): string {
    const host = config.bind === '127.0.0.1' ? '127.0.0.1' :
                 config.bind === 'custom' ? (config.customBind || 'localhost') : 'localhost';
    return `ws://${host}:${config.port}`;
  }

  getHttpUrl(config: GatewayConfig): string {
    return `http://localhost:${config.port}`;
  }

  async showStatus(config: GatewayConfig): Promise<void> {
    const running = await this.isRunning(config.port);
    const statusIcon = running ? chalk.green('● RUNNING') : chalk.red('○ STOPPED');
    const ws = this.getWsUrl(config);

    console.log(chalk.cyan('\n╔══════════════════════════════════════╗'));
    console.log(chalk.cyan('║      🌐 GATEWAY STATUS               ║'));
    console.log(chalk.cyan('╠══════════════════════════════════════╣'));
    console.log(chalk.cyan(`║ Status:  ${statusIcon.padEnd(29)}║`));
    console.log(chalk.cyan(`║ Address: ${chalk.white(ws).padEnd(29)}║`));
    console.log(chalk.cyan(`║ Auth:    ${chalk.yellow('token (masked)').padEnd(29)}║`));
    console.log(chalk.cyan(`║ Bind:    ${chalk.gray(config.bind).padEnd(29)}║`));
    console.log(chalk.cyan(`║ Tailscale: ${chalk.gray(config.tailscaleExposure).padEnd(27)}║`));
    console.log(chalk.cyan('╚══════════════════════════════════════╝\n'));
  }
}
