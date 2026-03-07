/**
 * src/commands/doctor.ts
 * hyperclaw doctor — surfaces misconfigurations, risky DM policies, and health issues.
 * Mirrors OpenClaw's openclaw doctor / openclaw doctor --fix
 *
 * Options:
 *   --fix, --repair     Apply recommended repairs
 *   --repair --force    Apply aggressive repairs (e.g. overwrite supervisor configs)
 *   --yes               Accept defaults without prompting
 *   --non-interactive   Skip prompts; only run safe migrations
 *   --deep              Scan system services for extra gateway installs
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import net from 'net';
import { getHyperClawDir, getConfigPath } from '../infra/paths';

export type IssueSeverity = 'error' | 'warn' | 'ok';

export interface DoctorIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fixable: boolean;
  fix?: () => Promise<void>;
}

export interface DoctorOpts {
  fix?: boolean;
  repair?: boolean;
  force?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  deep?: boolean;
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => resolve(false));
    try { s.connect(port, '127.0.0.1'); } catch { resolve(false); }
  });
}

export async function runDoctor(fix = false, opts: DoctorOpts = {}): Promise<void> {
  const doFix = fix || opts.repair || opts.fix || false;
  const force = opts.force || false;
  const nonInteractive = opts.nonInteractive || opts.yes || false;
  const deep = opts.deep || false;

  const spinner = ora('Running health checks...').start();
  await new Promise(r => setTimeout(r, 400));
  spinner.stop();

  const configDir = getHyperClawDir();
  const configFile = getConfigPath();
  const agentsFile = path.join(configDir, 'AGENTS.md');
  const authFile = path.join(configDir, 'auth.json');
  const credentialsDir = path.join(configDir, 'credentials');
  const pairingFile = path.join(credentialsDir, 'discord-pairing.json');

  let cfg: any = null;
  try { cfg = await fs.readJson(configFile); } catch {}
  if (!cfg) {
    try { cfg = await fs.readJson(path.join(configDir, 'config.json')); } catch {}
  }

  const issues: DoctorIssue[] = [];

  // ── CONFIG EXISTS ────────────────────────────────────────────────────────
  if (!cfg) {
    issues.push({
      id: 'no-config',
      severity: 'error',
      title: 'No configuration found',
      detail: 'Run: hyperclaw init',
      fixable: false
    });
  } else {

    // ── GATEWAY TOKEN ──────────────────────────────────────────────────────
    const hasToken = !!(cfg.gateway?.authToken);
    issues.push({
      id: 'gateway-token',
      severity: hasToken ? 'ok' : 'warn',
      title: hasToken ? 'Gateway auth token set' : 'Gateway auth token missing',
      detail: hasToken ? 'Token is configured' : 'Set a strong token in gateway config',
      fixable: !hasToken,
      fix: async () => {
        const crypto = await import('crypto');
        cfg.gateway = cfg.gateway || {};
        cfg.gateway.authToken = crypto.randomBytes(32).toString('hex');
        fs.writeJsonSync(configFile, cfg, { spaces: 2 });
        console.log(chalk.green('  ✔  Generated and saved gateway auth token'));
      }
    });

    // ── DM POLICIES ────────────────────────────────────────────────────────
    const channels = cfg.gateway?.enabledChannels || cfg.channels || [];
    const channelConfigs = cfg.channelConfigs || cfg.channels || {};
    const chList = Array.isArray(channels) ? channels : Object.keys(channelConfigs);

    for (const ch of chList) {
      const chCfg = typeof channelConfigs === 'object' && !Array.isArray(channelConfigs) ? channelConfigs[ch] : null;
      const dmPolicy = chCfg?.dmPolicy?.policy ?? (typeof chCfg?.dmPolicy === 'string' ? chCfg.dmPolicy : null);

      if (dmPolicy === 'open') {
        issues.push({
          id: `dm-open-${ch}`,
          severity: 'warn',
          title: `DM policy is "open" on ${ch}`,
          detail: `Anyone can DM your agent on ${ch}. Consider using "pairing" or "allowlist".`,
          fixable: false
        });
      }

      if (dmPolicy === 'allowlist') {
        const allowFrom = chCfg?.dmPolicy?.allowFrom ?? chCfg?.allowFrom ?? [];
        const arr = Array.isArray(allowFrom) ? allowFrom : [];
        if (arr.length === 0) {
          issues.push({
            id: `dm-empty-allowlist-${ch}`,
            severity: 'error',
            title: `Empty allowlist on ${ch} — DMs will be silently dropped`,
            detail: `channel.${ch}.allowFrom or dmPolicy.allowFrom is empty. Add users or change policy.`,
            fixable: true,
            fix: async () => {
              try {
                const allowFromPath = path.join(credentialsDir, `${ch}-allowFrom.json`);
                if (await fs.pathExists(allowFromPath)) {
                  const af = await fs.readJson(allowFromPath);
                  const ids = af.senderIds as string[] | undefined;
                  if (ids?.length) {
                    cfg.channelConfigs = cfg.channelConfigs || {};
                    const existing = cfg.channelConfigs[ch] || {};
                    const merged = { ...existing, allowFrom: ids };
                    if (typeof existing.dmPolicy === 'object') merged.dmPolicy = { ...existing.dmPolicy, allowFrom: ids };
                    cfg.channelConfigs[ch] = merged;
                    await fs.writeJson(configFile, cfg, { spaces: 2 });
                    console.log(chalk.green(`  ✔  Restored ${ids.length} user(s) from allowFrom store`));
                  }
                }
              } catch {}
            }
          });
        }
      }
    }

    // ── PROVIDER KEY ────────────────────────────────────────────────────────
    const hasApiKey = !!(cfg.provider?.apiKey);
    const isLocal = cfg.provider?.providerId === 'local';
    if (!hasApiKey && !isLocal) {
      issues.push({
        id: 'no-api-key',
        severity: 'error',
        title: 'No AI provider API key configured',
        detail: 'Run: hyperclaw config set-key',
        fixable: false
      });
    } else {
      issues.push({
        id: 'api-key',
        severity: 'ok',
        title: 'AI provider key configured',
        detail: `Provider: ${cfg.provider?.providerId}`,
        fixable: false
      });
    }

    // ── AGENTS.md ────────────────────────────────────────────────────────
    issues.push({
      id: 'agents-md',
      severity: (await fs.pathExists(agentsFile)) ? 'ok' : 'warn',
      title: (await fs.pathExists(agentsFile)) ? 'AGENTS.md exists' : 'AGENTS.md missing',
      detail: (await fs.pathExists(agentsFile)) ? agentsFile : 'Run: hyperclaw memory init to generate',
      fixable: false
    });

    // ── GATEWAY RUNNING ──────────────────────────────────────────────────
    const port = cfg.gateway?.port || 18789;
    const running = await isPortOpen(port);
    issues.push({
      id: 'gateway-running',
      severity: running ? 'ok' : 'warn',
      title: running ? `Gateway running on port ${port}` : `Gateway not running on port ${port}`,
      detail: running ? `ws://127.0.0.1:${port}` : 'Run: hyperclaw daemon start',
      fixable: false
    });

    // ── CONFIG FILE PERMISSIONS ───────────────────────────────────────────
    if (await fs.pathExists(configFile)) {
      const stat = await fs.stat(configFile);
      const unsafe = (stat.mode & 0o077) !== 0;
      if (unsafe) {
        issues.push({
          id: 'config-permissions',
          severity: 'warn',
          title: 'Config file has unsafe permissions',
          detail: `chmod 600 ${configFile}`,
          fixable: true,
          fix: async () => {
            await fs.chmod(configFile, 0o600);
            console.log(chalk.green(`  ✔  Fixed permissions on ${configFile}`));
          }
        });
      }
    }

    // ── STATE DIR ──────────────────────────────────────────────────────────
    const stateWritable = await fs.pathExists(configDir) && (await fs.stat(configDir).catch(() => null))?.isDirectory?.();
    issues.push({
      id: 'state-dir',
      severity: stateWritable ? 'ok' : 'error',
      title: stateWritable ? 'State directory OK' : 'State directory missing or not writable',
      detail: stateWritable ? configDir : `Ensure ${configDir} exists and is writable`,
      fixable: !stateWritable,
      fix: async () => {
        await fs.ensureDir(configDir);
        console.log(chalk.green(`  ✔  Created state directory: ${configDir}`));
      }
    });

    // ── AUTH STORE PERMISSIONS ────────────────────────────────────────────
    if (await fs.pathExists(authFile)) {
      const stat = await fs.stat(authFile);
      const unsafe = (stat.mode & 0o077) !== 0;
      issues.push({
        id: 'auth-permissions',
        severity: unsafe ? 'warn' : 'ok',
        title: unsafe ? 'Auth store has unsafe permissions' : 'Auth store permissions OK',
        detail: unsafe ? `chmod 600 ${authFile}` : `Mode: 600`,
        fixable: unsafe,
        fix: async () => {
          await fs.chmod(authFile, 0o600);
          console.log(chalk.green(`  ✔  Fixed permissions on ${authFile}`));
        }
      });
    }
  }

  // ── PRINT RESULTS ────────────────────────────────────────────────────────
  console.log(chalk.bold.cyan('\n  🩺 HYPERCLAW DOCTOR\n'));

  let errorCount = 0, warnCount = 0;

  for (const issue of issues) {
    const icon = { error: chalk.red('✖'), warn: chalk.yellow('⚠'), ok: chalk.green('✔') }[issue.severity];
    console.log(`  ${icon} ${chalk.white(issue.title)}`);
    console.log(`     ${chalk.gray(issue.detail)}`);

    if (issue.fixable && doFix && issue.fix) {
      await issue.fix();
    } else if (issue.fixable && !fix) {
      console.log(chalk.gray('     Run with --fix to auto-repair'));
    }

    if (issue.severity === 'error') errorCount++;
    if (issue.severity === 'warn') warnCount++;
    console.log();
  }

  const total = issues.length;
  const okCount = total - errorCount - warnCount;

  console.log(`  ${chalk.bold('Summary:')} ${chalk.green(`${okCount} ok`)}  ${chalk.yellow(`${warnCount} warnings`)}  ${chalk.red(`${errorCount} errors`)}`);

  if (errorCount > 0 || warnCount > 0) {
    console.log(chalk.gray('\n  Run: hyperclaw doctor --fix   to auto-repair fixable issues'));
    if (deep) console.log(chalk.gray('  Use --deep to scan for extra gateway services (launchd/systemd/schtasks)\n'));
    else console.log();
  } else {
    console.log(chalk.green('\n  ✔  All checks passed!\n'));
  }
}
