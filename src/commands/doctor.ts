/**
 * src/commands/doctor.ts
 * hyperclaw doctor — surfaces misconfigurations, risky DM policies, and health issues.
 * Mirrors OpenClaw's openclaw doctor / openclaw doctor --fix
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import net from 'net';

export type IssueSeverity = 'error' | 'warn' | 'ok';

export interface DoctorIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fixable: boolean;
  fix?: () => Promise<void>;
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

export async function runDoctor(fix = false): Promise<void> {
  const spinner = ora('Running health checks...').start();
  await new Promise(r => setTimeout(r, 800));
  spinner.stop();

  const configDir = path.join(os.homedir(), '.hyperclaw');
  const configFile = path.join(configDir, 'config.json');
  const agentsFile = path.join(configDir, 'AGENTS.md');
  const authFile = path.join(configDir, 'auth.json');
  const pairingFile = path.join(configDir, 'pairing-store.json');

  let cfg: any = null;
  try { cfg = fs.readJsonSync(configFile); } catch {}

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
    const channels = cfg.channels || [];
    const channelConfigs = cfg.channelConfigs || {};

    for (const ch of channels) {
      const dmPolicy = channelConfigs[ch]?.dmPolicy?.policy;

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
        const allowFrom = channelConfigs[ch]?.dmPolicy?.allowFrom || [];
        if (allowFrom.length === 0) {
          issues.push({
            id: `dm-empty-allowlist-${ch}`,
            severity: 'error',
            title: `Empty allowlist on ${ch} — DMs will be silently dropped`,
            detail: `channel.${ch}.dmPolicy.allowFrom is empty. Add users or change policy.`,
            fixable: true,
            fix: async () => {
              // Attempt to restore from pairing store
              try {
                const pairingEntries = fs.readJsonSync(pairingFile);
                const approved = pairingEntries.filter((e: any) => e.channelId === ch && e.status === 'approved' && e.userId);
                if (approved.length > 0) {
                  channelConfigs[ch].dmPolicy.allowFrom = approved.map((e: any) => e.userId);
                  cfg.channelConfigs = channelConfigs;
                  fs.writeJsonSync(configFile, cfg, { spaces: 2 });
                  console.log(chalk.green(`  ✔  Restored ${approved.length} user(s) from pairing store to ${ch} allowlist`));
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
    const port = cfg.gateway?.port || 1515;
    const running = await isPortOpen(port);
    issues.push({
      id: 'gateway-running',
      severity: running ? 'ok' : 'warn',
      title: running ? `Gateway running on port ${port}` : `Gateway not running on port ${port}`,
      detail: running ? `ws://127.0.0.1:${port}` : 'Run: hyperclaw daemon start',
      fixable: false
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

    if (issue.fixable && fix && issue.fix) {
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
    console.log(chalk.gray('\n  Run: hyperclaw doctor --fix   to auto-repair fixable issues\n'));
  } else {
    console.log(chalk.green('\n  ✔  All checks passed!\n'));
  }
}
