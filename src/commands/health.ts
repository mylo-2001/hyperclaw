/**
 * src/commands/health.ts
 * hyperclaw health — quick gateway health probe.
 *
 * Checks (in order):
 *   1. Runtime: is the gateway TCP port open?
 *   2. RPC probe: GET /api/health on the gateway HTTP server
 *   3. Channel count: how many channels are configured?
 *   4. Environment overrides (HYPERCLAW_HOME / HYPERCLAW_STATE_DIR / HYPERCLAW_CONFIG_PATH)
 *
 * Healthy baseline output (matches OpenClaw docs):
 *   Runtime: running
 *   RPC probe: ok
 *   Channels: 3 configured
 *
 * Exit code 0 = all ok, 1 = any check failed.
 */

import chalk from 'chalk';
import http from 'http';
import net from 'net';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { getConfigPath, getHyperClawDir } from '../infra/paths';

// ── Probe helpers ────────────────────────────────────────────────────────────

function tcpOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeoutMs);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
    try { s.connect(port, host); } catch { resolve(false); }
  });
}

function httpGet(url: string, timeoutMs = 1500): Promise<{ ok: boolean; status?: number; body?: string }> {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ ok: (res.statusCode ?? 0) < 400, status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
  });
}

// ── Run health check ─────────────────────────────────────────────────────────

export interface HealthResult {
  runtime: 'running' | 'stopped';
  rpcProbe: 'ok' | 'unreachable' | 'error';
  rpcStatus?: number;
  channels: number;
  port: number;
  gatewayUrl: string;
  envOverrides: Record<string, string>;
  allOk: boolean;
}

/** Resolve gateway base URL for health/status probes. Uses gateway.remote when mode is "remote". */
export function resolveGatewayUrl(cfg: any): { gatewayUrl: string; port: number } {
  const port = cfg?.gateway?.port ?? 18789;
  if (cfg?.gateway?.mode === 'remote' && cfg?.gateway?.remote?.url) {
    let u = cfg.gateway.remote.url;
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
    return { gatewayUrl: u.replace(/\/+$/, ''), port: new URL(u).port ? parseInt(new URL(u).port, 10) || port : port };
  }
  return { gatewayUrl: `http://127.0.0.1:${port}`, port };
}

export async function runHealth(opts: { json?: boolean; verbose?: boolean } = {}): Promise<HealthResult> {
  let cfg: any = null;
  try { cfg = await fs.readJson(getConfigPath()); } catch {}
  const { gatewayUrl, port } = resolveGatewayUrl(cfg);

  // Count configured channels
  const channels: string[] = cfg?.gateway?.enabledChannels ?? cfg?.channels ?? [];

  // Detect env overrides
  const envOverrides: Record<string, string> = {};
  if (process.env.HYPERCLAW_HOME) envOverrides.HYPERCLAW_HOME = process.env.HYPERCLAW_HOME;
  if (process.env.HYPERCLAW_STATE_DIR) envOverrides.HYPERCLAW_STATE_DIR = process.env.HYPERCLAW_STATE_DIR;
  if (process.env.HYPERCLAW_CONFIG_PATH) envOverrides.HYPERCLAW_CONFIG_PATH = process.env.HYPERCLAW_CONFIG_PATH;

  // 1. TCP probe (skip when remote URL is non-loopback)
  const u = new URL(gatewayUrl);
  const host = u.hostname || '127.0.0.1';
  const tcpPort = u.port ? parseInt(u.port, 10) : port;
  const tcpUp = await tcpOpen(host, tcpPort);
  const runtime: HealthResult['runtime'] = tcpUp ? 'running' : 'stopped';

  // 2. RPC probe (HTTP /api/health)
  let rpcProbe: HealthResult['rpcProbe'] = 'unreachable';
  let rpcStatus: number | undefined;
  if (tcpUp) {
    const resp = await httpGet(`${gatewayUrl}/api/health`);
    rpcStatus = resp.status;
    rpcProbe = resp.ok ? 'ok' : 'error';
    // Some gateways return 404 for /api/health but are still fine — accept any 2xx/3xx
    if (rpcStatus && rpcStatus < 400) rpcProbe = 'ok';
  }

  const allOk = runtime === 'running' && rpcProbe === 'ok';

  const result: HealthResult = {
    runtime,
    rpcProbe,
    rpcStatus,
    channels: channels.length,
    port,
    gatewayUrl,
    envOverrides,
    allOk
  };

  // ── Output ────────────────────────────────────────────────────────────────

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.bold.cyan('\n  🩺 HEALTH\n'));

  const runtimeColor = runtime === 'running' ? chalk.green : chalk.red;
  const rpcColor = rpcProbe === 'ok' ? chalk.green : (rpcProbe === 'error' ? chalk.yellow : chalk.red);

  console.log(`  Runtime:    ${runtimeColor(runtime)}`);
  console.log(`  RPC probe:  ${rpcColor(rpcProbe)}${rpcStatus ? chalk.gray(` (HTTP ${rpcStatus})`) : ''}`);
  console.log(`  Port:       ${chalk.white(port)}   ${chalk.gray(gatewayUrl)}`);
  console.log(`  Channels:   ${chalk.white(channels.length)} configured${channels.length > 0 ? chalk.gray('  ' + channels.slice(0, 5).join(', ') + (channels.length > 5 ? '…' : '')) : ''}`);

  if (opts.verbose) {
    console.log(`  State dir:  ${chalk.gray(getHyperClawDir())}`);
    console.log(`  Config:     ${chalk.gray(getConfigPath())}`);
    if (Object.keys(envOverrides).length > 0) {
      console.log(chalk.yellow('\n  Env overrides:'));
      for (const [k, v] of Object.entries(envOverrides)) {
        console.log(`    ${chalk.gray(k)}=${chalk.white(v)}`);
      }
    }
  }

  console.log();

  if (!allOk) {
    if (runtime === 'stopped') {
      console.log(chalk.red('  ✖  Gateway is not reachable.'));
      if (cfg?.gateway?.mode === 'remote') {
        console.log(chalk.gray('     Remote mode: ensure SSH tunnel is up: ssh -N -L 18789:127.0.0.1:18789 user@host'));
        console.log(chalk.gray('     See: docs/remote-gateway-setup.md\n'));
      } else {
        console.log(chalk.gray('     Start it: hyperclaw gateway start'));
        console.log(chalk.gray('     Or:       hyperclaw daemon start\n'));
      }
    } else if (rpcProbe !== 'ok') {
      console.log(chalk.yellow('  ⚠  Gateway TCP is up but RPC probe failed.'));
      console.log(chalk.gray('     Check logs: hyperclaw logs --follow\n'));
    }
  } else {
    console.log(chalk.green('  ✔  Gateway healthy\n'));
  }

  return result;
}
