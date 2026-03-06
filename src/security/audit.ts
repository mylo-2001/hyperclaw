/**
 * src/security/audit.ts
 * `hyperclaw security audit [--deep]`
 * Matches OpenClaw's security audit with deep credential scanning.
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');

interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  detail: string;
  remediation: string;
  cvss?: number;
}

async function checkFilePermissions(): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  const sensitiveFiles = [
    path.join(HC_DIR, 'hyperclaw.json'),
    path.join(HC_DIR, 'auth.json'),
    path.join(HC_DIR, '.env'),
    path.join(HC_DIR, 'AGENTS.md'),
  ];

  for (const f of sensitiveFiles) {
    if (await fs.pathExists(f)) {
      const stat = await fs.stat(f);
      if ((stat.mode & 0o077) !== 0) {
        findings.push({
          severity: 'high',
          category: 'File Permissions',
          title: `Unsafe permissions on ${path.basename(f)}`,
          detail: `Mode ${(stat.mode & 0o777).toString(8)} allows group/other read`,
          remediation: `chmod 600 ${f}`,
          cvss: 7.5
        });
      }
    }
  }

  const credsDir = path.join(HC_DIR, 'credentials');
  if (await fs.pathExists(credsDir)) {
    const stat = await fs.stat(credsDir);
    if ((stat.mode & 0o077) !== 0) {
      findings.push({
        severity: 'critical',
        category: 'File Permissions',
        title: 'credentials/ directory is world-readable',
        detail: `Mode ${(stat.mode & 0o777).toString(8)} — all credential files are exposed`,
        remediation: `chmod 700 ${credsDir}`,
        cvss: 9.1
      });
    }
  }

  return findings;
}

async function checkGatewayConfig(): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  let cfg: any = null;

  try { cfg = await fs.readJson(path.join(HC_DIR, 'hyperclaw.json')); } catch { return findings; }

  const token = cfg.gateway?.authToken;
  if (!token) {
    findings.push({
      severity: 'critical',
      category: 'Authentication',
      title: 'Gateway auth token not set',
      detail: 'Any client can connect to the gateway without authentication',
      remediation: 'hyperclaw gateway config --set-token',
      cvss: 9.8
    });
  } else if (token.length < 32) {
    findings.push({
      severity: 'high',
      category: 'Authentication',
      title: 'Gateway auth token is too short',
      detail: `Token is ${token.length} chars — minimum recommended is 32`,
      remediation: 'hyperclaw gateway config --regenerate-token',
      cvss: 7.3
    });
  }

  if (cfg.gateway?.bind === '0.0.0.0') {
    findings.push({
      severity: 'medium',
      category: 'Network Exposure',
      title: 'Gateway bound to all interfaces (0.0.0.0)',
      detail: 'Gateway is accessible from the local network. Ensure auth token is strong.',
      remediation: 'Use 127.0.0.1 unless you need LAN access',
      cvss: 5.3
    });
  }

  if (cfg.gateway?.tailscaleExposure === 'funnel') {
    findings.push({
      severity: 'medium',
      category: 'Network Exposure',
      title: 'Gateway exposed via Tailscale Funnel (public internet)',
      detail: 'Your gateway is reachable from the public internet via Tailscale Funnel',
      remediation: 'Ensure auth token is strong and DM policies are restrictive',
      cvss: 5.8
    });
  }

  // Check DM policies
  for (const [ch, chCfg] of Object.entries(cfg.channelConfigs || {})) {
    const policy = (chCfg as any)?.dmPolicy?.policy;
    if (policy === 'open') {
      findings.push({
        severity: 'high',
        category: 'DM Policy',
        title: `DM policy is "open" on ${ch}`,
        detail: 'Anyone can send DMs to your agent. This is a prompt injection risk.',
        remediation: `hyperclaw channels add ${ch}  # and choose pairing or allowlist`,
        cvss: 7.1
      });
    }
    if (policy === 'allowlist') {
      const allowFrom = (chCfg as any)?.dmPolicy?.allowFrom || [];
      if (allowFrom.length === 0) {
        findings.push({
          severity: 'high',
          category: 'DM Policy',
          title: `Empty allowlist on ${ch} — DMs are silently dropped`,
          detail: `allowFrom is [] — no one can reach your agent on ${ch}`,
          remediation: `hyperclaw pairing approve ${ch} <code>`,
          cvss: 4.0
        });
      }
    }
  }

  return findings;
}

async function checkSecretsInPrompts(): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];

  // Look for potential secrets in AGENTS.md and MEMORY.md
  const secretPatterns = [
    { pattern: /sk-[a-zA-Z0-9]{20,}/, name: 'OpenAI API key' },
    { pattern: /tvly-[a-zA-Z0-9]{20,}/, name: 'Tavily API key' },
    { pattern: /xai-[a-zA-Z0-9]{20,}/, name: 'xAI API key' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub PAT' },
    { pattern: /or-[a-zA-Z0-9]{20,}/, name: 'OpenRouter API key' },
    { pattern: /[a-f0-9]{64}/, name: 'Potential hex secret' },
  ];

  const filesToScan = [
    path.join(HC_DIR, 'AGENTS.md'),
    path.join(HC_DIR, 'MEMORY.md'),
    path.join(HC_DIR, 'hyperclaw.json'),
  ];

  for (const f of filesToScan) {
    if (!(await fs.pathExists(f))) continue;
    const content = await fs.readFile(f, 'utf8');
    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(content)) {
        findings.push({
          severity: 'critical',
          category: 'Secret Exposure',
          title: `${name} potentially embedded in ${path.basename(f)}`,
          detail: `Found pattern matching ${name} in plaintext file. Secrets in prompts are a serious risk.`,
          remediation: `Remove the secret and use: hyperclaw secrets set KEY=value`,
          cvss: 9.1
        });
      }
    }
  }

  return findings;
}

async function deepScan(): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];

  // Check for known-bad plugin patterns
  const hubState = path.join(HC_DIR, 'hub-state.json');
  if (await fs.pathExists(hubState)) {
    const state = await fs.readJson(hubState);
    const dangerous = state.installed?.filter((s: any) => s.risk === 'dangerous') || [];
    for (const s of dangerous) {
      findings.push({
        severity: 'critical',
        category: 'Installed Skills',
        title: `Dangerous skill installed: ${s.name}`,
        detail: s.riskReason || 'Skill is flagged as dangerous',
        remediation: `hyperclaw hub --uninstall ${s.id}`,
        cvss: 8.5
      });
    }
  }

  // Check for token entropy
  let cfg: any = null;
  try { cfg = await fs.readJson(path.join(HC_DIR, 'hyperclaw.json')); } catch {}
  if (cfg?.gateway?.authToken) {
    const token = cfg.gateway.authToken;
    const entropy = estimateEntropy(token);
    if (entropy < 3.5) {
      findings.push({
        severity: 'high',
        category: 'Token Quality',
        title: 'Gateway auth token has low entropy',
        detail: `Estimated entropy: ${entropy.toFixed(2)} bits/char — token may be guessable`,
        remediation: 'hyperclaw gateway config --regenerate-token',
        cvss: 6.5
      });
    }
  }

  return findings;
}

function estimateEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.cyan,
  info: chalk.gray
};

export async function runSecurityAudit(deep = false): Promise<void> {
  console.log(chalk.bold.cyan('\n  🔐 HYPERCLAW SECURITY AUDIT\n'));

  const spinner = ora('Running security checks...').start();

  const allFindings: SecurityFinding[] = [
    ...await checkFilePermissions(),
    ...await checkGatewayConfig(),
    ...await checkSecretsInPrompts(),
    ...(deep ? await deepScan() : [])
  ];

  spinner.stop();

  if (deep) console.log(chalk.gray('  Mode: DEEP SCAN\n'));
  else console.log(chalk.gray('  Mode: standard (run with --deep for full scan)\n'));

  if (allFindings.length === 0) {
    console.log(chalk.green('  ✔  No security issues found!\n'));
    return;
  }

  // Sort by severity
  allFindings.sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  for (const f of allFindings) {
    const color = SEVERITY_COLOR[f.severity];
    const badge = color(` ${f.severity.toUpperCase()} `);
    const cvss = f.cvss ? chalk.gray(` CVSS ${f.cvss}`) : '';

    console.log(`  ${badge}${cvss}  ${chalk.white(f.title)}`);
    console.log(`     ${chalk.gray(`Category: ${f.category}`)}`);
    console.log(`     ${chalk.gray(f.detail)}`);
    console.log(`     ${chalk.cyan('Fix: ' + f.remediation)}`);
    console.log();
  }

  const counts = SEVERITY_ORDER.reduce((acc, sev) => {
    acc[sev] = allFindings.filter(f => f.severity === sev).length;
    return acc;
  }, {} as Record<string, number>);

  console.log(`  ${chalk.bold('Summary:')} ` +
    `${chalk.bgRed.white.bold(` ${counts.critical} CRITICAL `)}  ` +
    `${chalk.red(`${counts.high} high`)}  ` +
    `${chalk.yellow(`${counts.medium} medium`)}  ` +
    `${chalk.cyan(`${counts.low} low`)}\n`);

  if (!deep) {
    console.log(chalk.gray('  Run: hyperclaw security audit --deep   for full credential entropy scan\n'));
  }
}
