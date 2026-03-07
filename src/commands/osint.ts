/**
 * src/commands/osint.ts
 * `hyperclaw osint` — OSINT / Ethical Hacking preset mode.
 *
 * Configures HyperClaw for security research:
 *   - System prompt tuned for recon, vulnerability research, bug bounty
 *   - Auto-enables web-search, bash, MCP browser + filesystem tools
 *   - Supports targeting by domain, IP, username, or email
 *   - Workflow presets: recon, bugbounty, pentest, footprint
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const CONFIG_FILE = path.join(HC_DIR, 'hyperclaw.json');
const OSINT_PROFILE_FILE = path.join(HC_DIR, 'osint-profile.json');

export type OsintMode = 'recon' | 'bugbounty' | 'pentest' | 'footprint' | 'custom';

interface OsintProfile {
  mode: OsintMode;
  target?: string;
  targetType?: 'domain' | 'ip' | 'username' | 'email' | 'org' | 'custom';
  notes?: string;
  createdAt: string;
  mcpServers: string[];
  systemPromptOverride?: string;
}

const MODE_DESCRIPTIONS: Record<OsintMode, string> = {
  recon:       'Passive reconnaissance — WHOIS, DNS, subdomains, public info gathering',
  bugbounty:   'Bug bounty workflow — target scope, vulnerability research, report drafting',
  pentest:     'Penetration testing — active recon, service enumeration, exploit research',
  footprint:   'Digital footprint — social media, email leaks, username tracking',
  custom:      'Custom — configure your own tools and system prompt'
};

const MODE_SYSTEM_PROMPTS: Record<OsintMode, string> = {
  recon: `You are a professional OSINT analyst specializing in passive reconnaissance.
Your goal is to gather publicly available information about the target without triggering detection.
Use DNS lookups, WHOIS data, web scraping, and public databases.
Always cite sources and stay within legal boundaries.
Never attempt active exploitation — only passive information gathering.`,

  bugbounty: `You are an experienced bug bounty hunter working within an authorized scope.
Your goal is to identify security vulnerabilities in web applications and infrastructure.
Follow responsible disclosure principles. Report findings clearly with reproduction steps.
Focus on: XSS, SQLi, SSRF, authentication issues, business logic flaws, IDOR.
Use tools methodically. Document everything for your report.`,

  pentest: `You are a professional penetration tester with explicit written authorization.
Conduct a thorough security assessment following the PTES methodology.
Phases: Intelligence Gathering → Scanning → Exploitation → Post-Exploitation → Reporting.
Document all findings with CVSS scores. Stay within defined scope at all times.
Never exfiltrate real data — only demonstrate access.`,

  footprint: `You are a digital forensics investigator mapping a target's online presence.
Your goal is to build a comprehensive profile using only public sources.
Search social media, data breach databases (HaveIBeenPwned, Dehashed), LinkedIn, GitHub.
Create a timeline of online activity. Identify connected accounts, email patterns, usernames.
This is for defensive intelligence gathering and authorized investigations only.`,

  custom: `You are a security researcher with access to OSINT and analysis tools.
Use available tools to assist with the research task.`
};

const MODE_MCP_SERVERS: Record<OsintMode, string[]> = {
  recon:      ['mcp-browser', 'mcp-filesystem'],
  bugbounty:  ['mcp-browser', 'mcp-filesystem', 'mcp-github'],
  pentest:    ['mcp-browser', 'mcp-filesystem', 'mcp-terminal', 'mcp-github'],
  footprint:  ['mcp-browser', 'mcp-filesystem'],
  custom:     ['mcp-browser', 'mcp-filesystem']
};

function printBanner() {
  console.log();
  console.log(chalk.red.bold('  ██████╗ ███████╗██╗███╗   ██╗████████╗'));
  console.log(chalk.red.bold('  ██╔═══██╗██╔════╝██║████╗  ██║╚══██╔══╝'));
  console.log(chalk.yellow.bold('  ██║   ██║███████╗██║██╔██╗ ██║   ██║   '));
  console.log(chalk.yellow.bold('  ██║   ██║╚════██║██║██║╚██╗██║   ██║   '));
  console.log(chalk.red.bold('  ╚██████╔╝███████║██║██║ ╚████║   ██║   '));
  console.log(chalk.red.bold('   ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝   ╚═╝   '));
  console.log();
  console.log(chalk.gray('  HyperClaw OSINT / Ethical Hacking Mode'));
  console.log(chalk.gray('  ────────────────────────────────────────────'));
  console.log(chalk.yellow('  ⚠️  For authorized security research only.'));
  console.log(chalk.yellow('  ⚠️  Always have explicit written permission.'));
  console.log();
}

export async function osintSetup(options: {
  mode?: OsintMode;
  target?: string;
  show?: boolean;
  reset?: boolean;
}): Promise<void> {
  printBanner();

  // Show current profile
  if (options.show) {
    try {
      const profile: OsintProfile = await fs.readJson(OSINT_PROFILE_FILE);
      console.log(chalk.cyan.bold('  Current OSINT Profile:\n'));
      console.log(`  Mode:    ${chalk.yellow(profile.mode)}`);
      console.log(`  Target:  ${chalk.white(profile.target || '(not set)')}`);
      console.log(`  Type:    ${profile.targetType || 'N/A'}`);
      console.log(`  MCP:     ${profile.mcpServers.join(', ')}`);
      console.log(`  Created: ${profile.createdAt}`);
      if (profile.notes) console.log(`  Notes:   ${profile.notes}`);
      console.log();
    } catch {
      console.log(chalk.gray('  No OSINT profile saved yet. Run: hyperclaw osint setup\n'));
    }
    return;
  }

  // Reset profile
  if (options.reset) {
    await fs.remove(OSINT_PROFILE_FILE);
    console.log(chalk.green('  ✔  OSINT profile cleared.\n'));
    return;
  }

  // Interactive setup
  console.log(chalk.bold('  Select OSINT workflow:\n'));
  for (const [mode, desc] of Object.entries(MODE_DESCRIPTIONS)) {
    console.log(`  ${chalk.cyan(mode.padEnd(12))} ${chalk.gray(desc)}`);
  }
  console.log();

  const { mode } = await inquirer.prompt<{ mode: OsintMode }>([{
    type: 'list',
    name: 'mode',
    message: 'Workflow:',
    choices: Object.keys(MODE_DESCRIPTIONS).map(m => ({
      name: `${m.padEnd(12)} — ${MODE_DESCRIPTIONS[m as OsintMode]}`,
      value: m
    })),
    default: options.mode || 'recon'
  }]);

  const { hasTarget } = await inquirer.prompt<{ hasTarget: boolean }>([{
    type: 'confirm',
    name: 'hasTarget',
    message: 'Set a target for this session?',
    default: true
  }]);

  let target: string | undefined;
  let targetType: OsintProfile['targetType'] | undefined;

  if (hasTarget) {
    const resp = await inquirer.prompt<{ targetType: OsintProfile['targetType']; target: string }>([
      {
        type: 'list',
        name: 'targetType',
        message: 'Target type:',
        choices: ['domain', 'ip', 'username', 'email', 'org', 'custom']
      },
      {
        type: 'input',
        name: 'target',
        message: 'Target value (e.g. example.com):',
        validate: v => v.trim().length > 0 || 'Required'
      }
    ]);
    target = resp.target.trim();
    targetType = resp.targetType;
  }

  const { notes } = await inquirer.prompt<{ notes: string }>([{
    type: 'input',
    name: 'notes',
    message: 'Session notes (optional, e.g. "HackerOne program XYZ"):',
  }]);

  // Ethics acknowledgment
  console.log();
  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([{
    type: 'confirm',
    name: 'confirmed',
    message: chalk.yellow('I confirm I have explicit written authorization to test this target.'),
    default: false
  }]);

  if (!confirmed) {
    console.log(chalk.red('\n  Aborted. OSINT mode requires authorization confirmation.\n'));
    return;
  }

  const spinner = ora('Applying OSINT configuration...').start();

  const mcpServers = MODE_MCP_SERVERS[mode];
  const systemPrompt = MODE_SYSTEM_PROMPTS[mode];

  // Build OSINT profile
  const profile: OsintProfile = {
    mode,
    target,
    targetType,
    notes: notes || undefined,
    createdAt: new Date().toISOString(),
    mcpServers,
    systemPromptOverride: systemPrompt
  };

  await fs.ensureDir(HC_DIR);
  await fs.writeJson(OSINT_PROFILE_FILE, profile, { spaces: 2 });

  // Patch hyperclaw.json with OSINT settings
  let config: Record<string, unknown> = {};
  try { config = await fs.readJson(CONFIG_FILE); } catch {}

  // Patch agent.systemPrompt and skills
  if (!config.agent) config.agent = {};
  const agent = config.agent as Record<string, unknown>;
  agent.systemPromptOverride = systemPrompt;
  agent.osintMode = mode;
  if (target) agent.osintTarget = `${targetType}: ${target}`;

  // Register MCP servers that aren't already registered
  const mcpFile = path.join(HC_DIR, 'mcp-servers.json');
  let mcpServersJson: Array<{ id: string; name: string; transport: string; command: string; enabled: boolean; addedAt: string }> = [];
  try { mcpServersJson = await fs.readJson(mcpFile); } catch {}

  const extensionsDir = path.join(path.dirname(CONFIG_FILE), '..', '..');
  // We register with node path so it works without global install
  const serverDefs: Record<string, { command: string; label: string }> = {
    'mcp-filesystem': { command: `node ${path.join(process.cwd(), 'extensions/mcp-filesystem/server.mjs')}`, label: 'Filesystem (OSINT)' },
    'mcp-browser':   { command: `node ${path.join(process.cwd(), 'extensions/mcp-browser/server.mjs')}`,   label: 'Browser/Web (OSINT)' },
    'mcp-terminal':  { command: `node ${path.join(process.cwd(), 'extensions/mcp-terminal/server.mjs')}`,  label: 'Terminal (OSINT)' },
    'mcp-github':    { command: `node ${path.join(process.cwd(), 'extensions/mcp-github/server.mjs')}`,    label: 'GitHub (OSINT)' },
  };

  for (const serverId of mcpServers) {
    const already = mcpServersJson.find(s => s.id === serverId);
    if (!already && serverDefs[serverId]) {
      mcpServersJson.push({
        id: serverId,
        name: serverDefs[serverId].label,
        transport: 'stdio',
        command: serverDefs[serverId].command,
        enabled: true,
        addedAt: new Date().toISOString()
      });
    } else if (already) {
      already.enabled = true;
    }
  }

  await fs.ensureDir(path.dirname(mcpFile));
  await fs.writeJson(mcpFile, mcpServersJson, { spaces: 2 });
  await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });

  spinner.succeed('OSINT configuration applied');

  console.log();
  console.log(chalk.bold.cyan('  ✔  HyperClaw is now in OSINT mode:\n'));
  console.log(`  Workflow: ${chalk.yellow(mode)}`);
  if (target) console.log(`  Target:   ${chalk.white(target)} ${chalk.gray(`(${targetType})`)}`);
  console.log(`  MCP:      ${chalk.cyan(mcpServers.join(', '))}`);
  console.log();
  console.log(chalk.bold('  Start your session:'));
  console.log(`  ${chalk.cyan('hyperclaw daemon start')}           — start the assistant`);
  console.log(`  ${chalk.cyan('hyperclaw agent --message "..."')} — send a message from CLI`);
  console.log();
  console.log(chalk.bold('  Example prompts:'));
  if (mode === 'recon' && target) {
    console.log(chalk.gray(`  "Perform passive recon on ${target}: WHOIS, DNS, subdomains"`));
    console.log(chalk.gray(`  "Find all public GitHub repos for ${target}"`));
    console.log(chalk.gray(`  "Search for email addresses associated with ${target}"`));
  } else if (mode === 'bugbounty') {
    console.log(chalk.gray(`  "What are common vulnerabilities in web login forms?"`));
    console.log(chalk.gray(`  "Draft a bug bounty report for an XSS vulnerability"`));
    console.log(chalk.gray(`  "Help me test for SSRF on the /api/fetch endpoint"`));
  } else if (mode === 'pentest') {
    console.log(chalk.gray(`  "Create a pentest report template for a web application"`));
    console.log(chalk.gray(`  "What ports should I check on a Linux server?"`));
    console.log(chalk.gray(`  "Explain how to test for SQLi safely in a controlled environment"`));
  } else if (mode === 'footprint') {
    console.log(chalk.gray(`  "Search for the digital footprint of the username 'target_user'"`));
    console.log(chalk.gray(`  "Check HaveIBeenPwned for emails from domain example.com"`));
  }
  console.log();
  console.log(chalk.gray('  To view profile: hyperclaw osint --show'));
  console.log(chalk.gray('  To reset:        hyperclaw osint --reset'));
  console.log();
}

export async function osintQuickStart(mode?: string): Promise<void> {
  printBanner();
  console.log(chalk.bold('  Available OSINT workflows:\n'));
  for (const [m, desc] of Object.entries(MODE_DESCRIPTIONS)) {
    const isActive = m === mode;
    const bullet = isActive ? chalk.green('▶') : chalk.gray('○');
    console.log(`  ${bullet} ${chalk.cyan(m.padEnd(12))} ${chalk.white(desc)}`);
  }
  console.log();
  console.log(chalk.bold('  Commands:\n'));
  console.log(`  ${chalk.cyan('hyperclaw osint setup')}           — interactive OSINT session setup`);
  console.log(`  ${chalk.cyan('hyperclaw osint --show')}          — show current profile`);
  console.log(`  ${chalk.cyan('hyperclaw osint --reset')}         — clear OSINT profile`);
  console.log();
  console.log(chalk.bold('  MCP servers for OSINT:\n'));
  console.log(`  ${chalk.cyan('mcp-browser')}    — web_fetch, web_search, dns_lookup, whois_lookup, extract_links`);
  console.log(`  ${chalk.cyan('mcp-filesystem')} — read_file, write_file, search_files (for saving reports)`);
  console.log(`  ${chalk.cyan('mcp-github')}     — list_repos, search_code, get_file`);
  console.log(`  ${chalk.cyan('mcp-terminal')}   — run_command (pentest mode only, requires authorization)`);
  console.log();
  console.log(chalk.yellow('  ⚠️  Always operate within authorized scope and applicable laws.\n'));
}
