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
  checkId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  detail: string;
  remediation: string;
  cvss?: number;
  autofix?: () => Promise<void>;
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
          checkId: 'creds-permissions',
          severity: 'high',
          category: 'File Permissions',
          title: `Unsafe permissions on ${path.basename(f)}`,
          detail: `Mode ${(stat.mode & 0o777).toString(8)} allows group/other read`,
          remediation: `chmod 600 ${f}`,
          cvss: 7.5,
          autofix: async () => { await fs.chmod(f, 0o600); }
        });
      }
    }
  }

  const credsDir = path.join(HC_DIR, 'credentials');
  if (await fs.pathExists(credsDir)) {
    const stat = await fs.stat(credsDir);
    if ((stat.mode & 0o077) !== 0) {
      findings.push({
        checkId: 'creds-dir-permissions',
        severity: 'critical',
        category: 'File Permissions',
        title: 'credentials/ directory is world-readable',
        detail: `Mode ${(stat.mode & 0o777).toString(8)} — all credential files are exposed`,
        remediation: `chmod 700 ${credsDir}`,
        cvss: 9.1,
        autofix: async () => { await fs.chmod(credsDir, 0o700); }
      });
    }
  }

  // Check config directory permissions
  if (await fs.pathExists(HC_DIR)) {
    const stat = await fs.stat(HC_DIR);
    if ((stat.mode & 0o077) !== 0) {
      findings.push({
        checkId: 'config-dir-permissions',
        severity: 'high',
        category: 'File Permissions',
        title: '~/.hyperclaw/ directory is group/world readable',
        detail: `Mode ${(stat.mode & 0o777).toString(8)} — config directory accessible to others`,
        remediation: `chmod 700 ${HC_DIR}`,
        cvss: 6.5,
        autofix: async () => { await fs.chmod(HC_DIR, 0o700); }
      });
    }
  }

  // Check for .env committed to git
  const cwd = process.cwd();
  const gitignorePath = path.join(cwd, '.gitignore');
  if (await fs.pathExists(gitignorePath)) {
    const gi = await fs.readFile(gitignorePath, 'utf8');
    if (!gi.includes('.env')) {
      findings.push({
        checkId: 'gitignore-env',
        severity: 'high',
        category: 'Secret Exposure',
        title: '.env is not in .gitignore',
        detail: 'Environment files with secrets may be committed to git',
        remediation: 'echo ".env" >> .gitignore',
        cvss: 8.1
      });
    }
    if (!gi.includes('credentials/')) {
      findings.push({
        checkId: 'gitignore-creds',
        severity: 'high',
        category: 'Secret Exposure',
        title: 'credentials/ is not in .gitignore',
        detail: 'Credential files may be committed to git',
        remediation: 'echo "credentials/" >> .gitignore',
        cvss: 8.1
      });
    }
  }

  return findings;
}

async function checkGatewayConfig(): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  let cfg: any = null;

  try { cfg = await fs.readJson(path.join(HC_DIR, 'hyperclaw.json')); } catch { return findings; }

  // Auth token checks
  const token = cfg.gateway?.authToken;
  if (!token) {
    findings.push({
      checkId: 'gateway-auth-missing',
      severity: 'critical',
      category: 'Authentication',
      title: 'Gateway auth token not set',
      detail: 'Any client can connect to the gateway without authentication',
      remediation: 'hyperclaw gateway config --set-token',
      cvss: 9.8
    });
  } else if (token.length < 32) {
    findings.push({
      checkId: 'auth-token-strength',
      severity: 'high',
      category: 'Authentication',
      title: 'Gateway auth token is too short',
      detail: `Token is ${token.length} chars — minimum recommended is 32`,
      remediation: 'hyperclaw gateway config --regenerate-token',
      cvss: 7.3
    });
  }

  // Network exposure
  if (cfg.gateway?.bind === '0.0.0.0') {
    findings.push({
      checkId: 'gateway-bind-all',
      severity: 'medium',
      category: 'Network Exposure',
      title: 'Gateway bound to all interfaces (0.0.0.0)',
      detail: 'Gateway is accessible from the local network. Ensure auth token is strong.',
      remediation: 'Set gateway.bind: "127.0.0.1" unless LAN access is required',
      cvss: 5.3
    });
  }

  if (cfg.gateway?.tailscaleExposure === 'funnel') {
    findings.push({
      checkId: 'tailscale-funnel',
      severity: 'medium',
      category: 'Network Exposure',
      title: 'Gateway exposed via Tailscale Funnel (public internet)',
      detail: 'Your gateway is reachable from the public internet via Tailscale Funnel',
      remediation: 'Ensure auth token is strong and DM policies are restrictive',
      cvss: 5.8
    });
  }

  // trustedProxies without auth is a risk
  const tp = cfg.gateway?.trustedProxies;
  if (Array.isArray(tp) && tp.length > 0 && !token) {
    findings.push({
      checkId: 'trusted-proxies-no-auth',
      severity: 'high',
      category: 'Network Exposure',
      title: 'trustedProxies configured but gateway has no auth token',
      detail: 'Proxy IP spoofing combined with no auth allows unauthenticated access',
      remediation: 'Set gateway.authToken and gateway.trustedProxies to known proxy IPs only',
      cvss: 8.1
    });
  }

  // DM policies — check channels object (new flat format)
  const channels = cfg.channels || cfg.channelConfigs || {};
  for (const [ch, chCfg] of Object.entries(channels)) {
    const policy = (chCfg as any)?.dmPolicy ?? (chCfg as any)?.dm?.policy;
    if (policy === 'open') {
      findings.push({
        checkId: `dm-policy-open-${ch}`,
        severity: 'high',
        category: 'DM Policy',
        title: `DM policy is "open" on ${ch}`,
        detail: 'Anyone can send DMs to your agent. This is a prompt injection risk.',
        remediation: `hyperclaw channels add ${ch}  # choose pairing or allowlist`,
        cvss: 7.1
      });
    }
    if (policy === 'allowlist') {
      const allowFrom = (chCfg as any)?.allowFrom ?? (chCfg as any)?.dm?.allowFrom ?? [];
      if (allowFrom.length === 0) {
        findings.push({
          checkId: `allowlist-empty-${ch}`,
          severity: 'medium',
          category: 'DM Policy',
          title: `Empty allowlist on ${ch} — DMs are silently dropped`,
          detail: `allowFrom is [] — no one can reach your agent on ${ch}`,
          remediation: `hyperclaw pairing approve ${ch} <code>`,
          cvss: 4.0
        });
      }
      // Wildcard allowFrom
      if ((allowFrom as string[]).includes('*')) {
        findings.push({
          checkId: `allowlist-wildcard-${ch}`,
          severity: 'high',
          category: 'DM Policy',
          title: `Wildcard (*) in allowFrom on ${ch}`,
          detail: 'allowFrom: ["*"] is equivalent to open DMs — anyone can message your agent',
          remediation: `Remove "*" and add specific users to allowFrom on ${ch}`,
          cvss: 7.1
        });
      }
    }

    // Group policy: no requireMention = anyone in a group can trigger the agent
    const groups = (chCfg as any)?.groups ?? {};
    for (const [spaceId, gCfg] of Object.entries(groups)) {
      if ((gCfg as any)?.requireMention === false) {
        findings.push({
          checkId: `group-mention-off-${ch}-${spaceId}`,
          severity: 'medium',
          category: 'Group Policy',
          title: `requireMention disabled in ${ch} group ${spaceId}`,
          detail: 'Bot responds to all messages in the group — prompt injection surface is maximised',
          remediation: `Set channels.${ch}.groups.${spaceId}.requireMention: true`,
          cvss: 5.3
        });
      }
    }
  }

  // session.dmScope check
  const dmScope = cfg.session?.dmScope;
  if (!dmScope || dmScope === 'global') {
    findings.push({
      checkId: 'session-dmscope-global',
      severity: 'low',
      category: 'Session Isolation',
      title: 'session.dmScope is "global" — shared inbox not isolated',
      detail: 'All DMs share one session context. If multiple people can DM your bot, consider "per-channel-peer".',
      remediation: 'Set session.dmScope: "per-channel-peer" in your config',
      cvss: 3.5
    });
  }

  // Tool/sandbox checks
  const toolsExec = cfg.tools?.exec;
  if (toolsExec?.security === 'allow' && !cfg.tools?.exec?.ask) {
    findings.push({
      checkId: 'exec-allow-no-ask',
      severity: 'high',
      category: 'Tool Blast Radius',
      title: 'tools.exec.security is "allow" without ask confirmation',
      detail: 'Any agent turn can run arbitrary shell commands without your approval',
      remediation: 'Set tools.exec.ask: "always" or tools.exec.security: "deny"',
      cvss: 8.5
    });
  }

  const elevated = cfg.tools?.elevated;
  if (elevated?.enabled === true) {
    findings.push({
      checkId: 'elevated-enabled',
      severity: 'medium',
      category: 'Tool Blast Radius',
      title: 'tools.elevated is enabled',
      detail: 'Elevated mode allows running exec on the gateway host from chat. Keep allowFrom tight.',
      remediation: 'Set tools.elevated.allowFrom to specific trusted users only',
      cvss: 6.0
    });
  }

  // Sandbox configured but mode off
  const sandboxMode = cfg.agents?.defaults?.sandbox?.mode;
  if (sandboxMode === 'off' && cfg.agents?.defaults?.sandbox?.image) {
    findings.push({
      checkId: 'sandbox-configured-off',
      severity: 'medium',
      category: 'Tool Blast Radius',
      title: 'Sandbox image configured but sandbox mode is "off"',
      detail: 'Tools run directly on the gateway host despite sandbox config being present',
      remediation: 'Set agents.defaults.sandbox.mode: "all" to activate the sandbox',
      cvss: 5.5
    });
  }

  // fs.workspaceOnly check
  const fsWorkspaceOnly = cfg.tools?.fs?.workspaceOnly;
  const workspace = cfg.agents?.defaults?.workspace ?? cfg.agent?.workspace ?? '';
  if (fsWorkspaceOnly === false || (!fsWorkspaceOnly && workspace && (workspace === os.homedir() || workspace === '~'))) {
    findings.push({
      checkId: 'fs-workspace-broad',
      severity: 'medium',
      category: 'File System',
      title: 'Workspace root is very broad or workspaceOnly is disabled',
      detail: 'A broad workspace root exposes sensitive files like ~/.hyperclaw to the filesystem tools',
      remediation: 'Set tools.fs.workspaceOnly: true and use a dedicated workspace directory',
      cvss: 5.3
    });
  }

  // Browser SSRF policy
  const ssrfPolicy = cfg.browser?.ssrfPolicy;
  if (ssrfPolicy?.dangerouslyAllowPrivateNetwork === false && (!ssrfPolicy?.hostnameAllowlist || ssrfPolicy.hostnameAllowlist.length === 0)) {
    findings.push({
      checkId: 'browser-ssrf-no-allowlist',
      severity: 'info',
      category: 'Browser Security',
      title: 'Browser strict SSRF mode enabled but no hostnameAllowlist defined',
      detail: 'dangerouslyAllowPrivateNetwork: false without hostnameAllowlist may block all browser navigation',
      remediation: 'Add browser.ssrfPolicy.hostnameAllowlist with allowed domains',
      cvss: 0
    });
  }

  // Plugin allowlist
  const plugins = cfg.plugins?.entries ?? {};
  const hasPlugins = Object.keys(plugins).length > 0;
  const hasAllowlist = Array.isArray(cfg.plugins?.allowlist) && cfg.plugins.allowlist.length > 0;
  if (hasPlugins && !hasAllowlist) {
    findings.push({
      checkId: 'plugin-allowlist-missing',
      severity: 'low',
      category: 'Plugins',
      title: 'Plugins installed without an explicit allowlist',
      detail: `${Object.keys(plugins).length} plugin(s) installed; plugins.allowlist is not set`,
      remediation: 'Set plugins.allowlist: ["<pluginId>"] for each approved plugin',
      cvss: 3.0
    });
  }

  // detect-secrets baseline
  const baselinePath = path.join(process.cwd(), '.secrets.baseline');
  if (!(await fs.pathExists(baselinePath))) {
    findings.push({
      checkId: 'detect-secrets-baseline',
      severity: 'low',
      category: 'Secret Scanning',
      title: 'No .secrets.baseline file — detect-secrets not configured',
      detail: 'Secret scanning CI will fail without a baseline file',
      remediation: 'Run: detect-secrets scan > .secrets.baseline && git add .secrets.baseline',
      cvss: 2.0
    });
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
          checkId: 'key-in-config',
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
        checkId: `plugin-unreviewed-${s.id}`,
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
        checkId: 'auth-token-low-entropy',
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

export async function runSecurityAudit(opts: { deep?: boolean; fix?: boolean; json?: boolean } = {}): Promise<void> {
  const { deep = false, fix = false, json = false } = opts;

  if (!json) console.log(chalk.bold.cyan('\n  🔐 HYPERCLAW SECURITY AUDIT\n'));

  const spinner = json ? null : ora('Running security checks...').start();

  const allFindings: SecurityFinding[] = [
    ...await checkFilePermissions(),
    ...await checkGatewayConfig(),
    ...await checkSecretsInPrompts(),
    ...(deep ? await deepScan() : [])
  ];

  spinner?.stop();

  // JSON output mode
  if (json) {
    const summary = SEVERITY_ORDER.reduce((acc, sev) => {
      acc[sev] = allFindings.filter(f => f.severity === sev).length;
      return acc;
    }, {} as Record<string, number>);
    process.stdout.write(JSON.stringify({
      mode: deep ? 'deep' : 'standard',
      total: allFindings.length,
      summary,
      findings: allFindings.map(({ autofix: _af, ...f }) => f)
    }, null, 2) + '\n');
    return;
  }

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

  let fixedCount = 0;
  for (const f of allFindings) {
    const color = SEVERITY_COLOR[f.severity];
    const badge = color(` ${f.severity.toUpperCase()} `);
    const cvss = f.cvss ? chalk.gray(` CVSS ${f.cvss}`) : '';
    const cid = chalk.gray(`[${f.checkId}]`);

    console.log(`  ${badge}${cvss}  ${chalk.white(f.title)}  ${cid}`);
    console.log(`     ${chalk.gray(`Category: ${f.category}`)}`);
    console.log(`     ${chalk.gray(f.detail)}`);

    if (fix && f.autofix) {
      try {
        await f.autofix();
        fixedCount++;
        console.log(`     ${chalk.green('✔ Auto-fixed')}`);
      } catch (e: any) {
        console.log(`     ${chalk.yellow('⚠ Auto-fix failed: ' + e.message)}`);
        console.log(`     ${chalk.cyan('Fix: ' + f.remediation)}`);
      }
    } else {
      console.log(`     ${chalk.cyan('Fix: ' + f.remediation)}`);
    }
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

  if (fix && fixedCount > 0) {
    console.log(chalk.green(`  ✔ ${fixedCount} issue(s) auto-fixed\n`));
  }

  if (!deep) {
    console.log(chalk.gray('  Run: hyperclaw security audit --deep   for full credential entropy scan\n'));
  }
}
