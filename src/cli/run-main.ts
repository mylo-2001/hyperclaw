/**
 * src/cli/run-main.ts
 * HyperClaw CLI — full command surface.
 *
 * Commands:
 *   hyperclaw init / onboard / quickstart
 *   hyperclaw gateway status/start/stop/restart
 *   hyperclaw daemon start/stop/restart/status/logs
 *   hyperclaw channels list/add/remove
 *   hyperclaw hooks list/enable/disable/info/install
 *   hyperclaw agents bindings/bind/unbind
 *   hyperclaw hub / hub --install / hub --scan
 *   hyperclaw pairing list/approve
 *   hyperclaw message send
 *   hyperclaw update --channel stable|beta|dev
 *   hyperclaw doctor [--fix]
 *   hyperclaw memory show/add-rule/add-fact
 *   hyperclaw config show/set-key/schema
 *   hyperclaw voice
 *   hyperclaw status
 *   hyperclaw dashboard
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { HyperClawWizard } from './onboard';
import { Banner } from '../terminal/banner';
import { DaemonManager } from '../infra/daemon';
import { Dashboard } from './dashboard';
import { ConfigManager } from '../config/manager';
import { VoiceEngine } from '../media/voice';
import { SkillHub, SKILL_REGISTRY } from '../plugins/hub';
import { GatewayManager } from 'hyperclaw/gateway';
import { MemoryManager } from '../agents/memory';
import { HookLoader } from '../hooks/loader';
import { AgentRouter } from '../routing/agents-routing';
import { PairingStore } from '../channels/pairing';
import { runDoctor } from '../commands/doctor';
import { sendMessage } from '../commands/message-send';
import { channelsAdd, channelsList, channelsRemove } from '../commands/channels/add';
import {
  resolveEffectiveUpdateChannel,
  detectInstallKind,
  getCurrentGitInfo,
  getStoredChannel,
  performUpdate
} from '../infra/update-channels';
import { AuthStore } from '../infra/device-auth-store';
import * as developerKeys from '../infra/developer-keys';

const program = new Command();

program
  .name('hyperclaw')
  .description('⚡ HyperClaw — AI Gateway Platform. The Lobster Evolution 🦅')
  .version('4.0.2');

// ─── INIT / ONBOARD ─────────────────────────────────────────────────────────

program.command('init')
  .description('Initialize HyperClaw with interactive wizard')
  .option('-a, --auto-config', 'Auto-configure with defaults')
  .option('-d, --daemon', 'Install as system daemon')
  .option('-s, --start-now', 'Start gateway after setup')
  .action(async (opts) => {
    await (new Banner()).showNeonBanner(false);
    await (new HyperClawWizard()).run(opts);
    process.exit(0);
  });

program.command('onboard')
  .description('Full onboarding wizard — preferred setup path')
  .option('--install-daemon', 'Auto-install system daemon (starts on boot, grants full PC access)')
  .option('--quick', 'Use QuickStart mode (skip advanced options)')
  .action(async (opts) => {
    await (new Banner()).showNeonBanner(false);

    if (opts.installDaemon) {
      // Show explicit full-access warning before proceeding
      const chalk = require('chalk');
      console.log(chalk.yellow('\n  ⚠  --install-daemon mode\n'));
      console.log(chalk.gray('  The daemon will run as a background system service and will have:\n'));
      console.log(chalk.white('    • Full shell / command execution on this machine'));
      console.log(chalk.white('    • File system read & write access'));
      console.log(chalk.white('    • Network access (gateway WebSocket)'));
      console.log(chalk.white('    • Auto-start on every system boot\n'));
      const inquirer = require('inquirer');
      const { confirmed } = await inquirer.prompt([{
        type: 'confirm', name: 'confirmed',
        message: 'I understand and want to continue with full PC access:',
        default: false
      }]);
      if (!confirmed) {
        console.log(chalk.gray('\n  Cancelled. Run without --install-daemon to choose during setup.\n'));
        process.exit(0);
      }
    }

    await (new HyperClawWizard()).run({
      ...opts,
      wizard: true,
      installDaemon: opts.installDaemon ?? false,
    });
    process.exit(0);
  });

program.command('quickstart')
  .description('Zero-config quick start')
  .option('-c, --channels <channels>', 'Channels to enable', 'telegram,discord')
  .option('-v, --voice <on|off>', 'Voice enabled', 'on')
  .action(async (opts) => {
    await (new Banner()).showMiniBanner();
    await (new HyperClawWizard()).quickstart(opts);
    process.exit(0);
  });

// ─── GATEWAY ─────────────────────────────────────────────────────────────────

const gatewayCmd = program.command('gateway').description('Gateway control plane');

gatewayCmd.command('status')
  .description('Show gateway status')
  .action(async () => {
    const gm = new GatewayManager();
    const cfg = await (new ConfigManager()).load();
    await gm.showStatus(cfg?.gateway || { port: 18789, bind: '127.0.0.1', authToken: '', tailscaleExposure: 'off', runtime: 'node', enabledChannels: [], hooks: true });
    process.exit(0);
  });

gatewayCmd.command('start')
  .description('Start the gateway service')
  .option('-p, --port <port>', 'Override port')
  .action(async (opts) => {
    await (new DaemonManager()).start();
    // Server keeps process alive — do not exit
  });

gatewayCmd.command('stop')
  .description('Stop the gateway service')
  .action(async () => { await (new DaemonManager()).stop(); process.exit(0); });

gatewayCmd.command('restart')
  .description('Restart the gateway service')
  .action(async () => {
    const dm = new DaemonManager();
    await dm.restart();
    // Server keeps process alive — do not exit
  });

// ─── DAEMON (alias for backward compat) ──────────────────────────────────────

program.command('daemon')
  .description('Manage HyperClaw system service (alias: gateway)')
  .argument('<action>', 'start|stop|restart|status|logs|install|uninstall')
  .action(async (action) => {
    const dm = new DaemonManager();
    if (action === 'start') await (new Banner()).showNeonBanner(true);
    await dm.handle(action);
    // start/restart: gateway runs in this process — do not exit
    if (action === 'start' || action === 'restart') return;
    process.exit(0);
  });

// ─── SANDBOX ──────────────────────────────────────────────────────────────────

const sandboxCmd = program.command('sandbox').description('Debug sandbox and tool policy');
sandboxCmd.command('explain')
  .description('Show effective sandbox mode, tool policy, and allowed tools')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const chalk = require('chalk');
    const fs = require('fs-extra');
    const path = require('path');
    const os = require('os');

    const { getConfigPath } = await import('../infra/paths');
    const cfgPath = getConfigPath();
    let cfg: any = {};
    try { cfg = await fs.readJson(cfgPath); } catch {}

    const sandboxMode = cfg?.agents?.defaults?.sandbox?.mode ?? 'non-main';
    const toolsCfg = cfg?.tools ?? {};
    const { describeToolPolicy, applyToolPolicy } = await import('../infra/tool-policy');
    const { getBuiltinTools, getSessionsTools, getPCAccessTools, getBrowserTools, getExtractionTools, getWebsiteWatchTools, getVisionTools } = await import('../../packages/core/src/index');
    const allTools = [...getBuiltinTools(), ...getSessionsTools(() => null), ...getPCAccessTools(), ...getBrowserTools(), ...getExtractionTools(), ...getWebsiteWatchTools(), ...getVisionTools()];
    const filtered = applyToolPolicy(allTools, toolsCfg, { provider: cfg?.provider?.providerId, model: cfg?.provider?.modelId });
    const policy = describeToolPolicy(toolsCfg, { provider: cfg?.provider?.providerId, model: cfg?.provider?.modelId });

    if (opts.json) {
      console.log(JSON.stringify({
        sandboxMode,
        toolPolicy: policy,
        totalTools: allTools.length,
        allowedTools: filtered.length,
        toolNames: filtered.map((t: any) => t.name)
      }, null, 2));
      process.exit(0);
    }

    console.log(chalk.bold.hex('#06b6d4')('\n  🔒 SANDBOX EXPLAIN\n'));
    console.log(`  Sandbox mode:  ${sandboxMode} (non-main sessions get restricted pcTools)`);
    console.log(`  Tool profile:  ${policy.profile}`);
    console.log(`  Policy source: ${policy.source}`);
    if (policy.allow?.length) console.log(`  Allow:         ${policy.allow.join(', ')}`);
    if (policy.deny?.length) console.log(`  Deny:          ${policy.deny.join(', ')}`);
    console.log(`  Tools:         ${filtered.length} / ${allTools.length} allowed`);
    console.log(chalk.gray('\n  Allowed: ' + filtered.map((t: any) => t.name).join(', ')));
    console.log(chalk.gray('\n  Elevated: ' + ((cfg?.tools?.elevated as any)?.enabled ? 'enabled' : 'disabled')));
    console.log();
    process.exit(0);
  });

// ─── CHANNELS ────────────────────────────────────────────────────────────────

const channelsCmd = program.command('channels').description('Channel management');

channelsCmd.command('list')
  .description('List all channels')
  .action(async () => { await channelsList(); process.exit(0); });

channelsCmd.command('add [channel]')
  .description('Add and configure a channel')
  .action(async (channel) => { await channelsAdd(channel); process.exit(0); });

channelsCmd.command('remove <channel>')
  .description('Remove a channel')
  .action(async (channel) => { await channelsRemove(channel); process.exit(0); });

// ─── HOOKS ───────────────────────────────────────────────────────────────────

const hooksCmd = program.command('hooks').description('Hook management');

hooksCmd.command('list')
  .description('List all hooks')
  .option('--eligible', 'Show only eligible hooks')
  .action((opts) => { (new HookLoader()).list(opts.eligible); process.exit(0); });

hooksCmd.command('info <id>')
  .description('Show hook details')
  .action((id) => { (new HookLoader()).info(id); process.exit(0); });

hooksCmd.command('enable <id>')
  .description('Enable a hook')
  .action((id) => { (new HookLoader()).enable(id); process.exit(0); });

hooksCmd.command('disable <id>')
  .description('Disable a hook')
  .action((id) => { (new HookLoader()).disable(id); process.exit(0); });

hooksCmd.command('install <pack>')
  .description('Install a hook pack')
  .action(async (pack) => { await (new HookLoader()).install(pack); process.exit(0); });

// ─── AGENTS ──────────────────────────────────────────────────────────────────

const agentsCmd = program.command('agents').description('Multi-agent routing');

agentsCmd.command('bindings')
  .description('List agent ↔ channel bindings')
  .action(() => { (new AgentRouter()).listBindings(); process.exit(0); });

agentsCmd.command('bind')
  .description('Bind a channel to an agent workspace')
  .action(async () => { await (new AgentRouter()).bind(); process.exit(0); });

agentsCmd.command('unbind')
  .description('Remove channel ↔ agent bindings')
  .action(async () => { await (new AgentRouter()).unbind(); process.exit(0); });

// ─── PAIRING ─────────────────────────────────────────────────────────────────

const pairingCmd = program.command('pairing').description('DM pairing codes');

pairingCmd.command('list')
  .description('List pending and approved pairing codes')
  .action(() => { (new PairingStore()).showList(); process.exit(0); });

pairingCmd.command('approve <channel> <code>')
  .description('Approve a pairing code and add user to allowlist')
  .action((channel, code) => {
    (new PairingStore()).cliApprove(channel, code);
    process.exit(0);
  });

// ─── MESSAGE ─────────────────────────────────────────────────────────────────

const msgCmd = program.command('message').description('Send messages');

msgCmd.command('send')
  .description('Send a message via a configured channel')
  .option('-t, --to <target>', 'Target (phone, @username, user ID, email)')
  .requiredOption('-m, --message <text>', 'Message text')
  .option('-c, --channel <channel>', 'Force specific channel')
  .option('--session <id>', 'Session ID')
  .action(async (opts) => {
    await sendMessage(opts);
    process.exit(0);
  });

// ─── SKILL HUB ───────────────────────────────────────────────────────────────

program.command('hub')
  .description('Skill hub — browse marketplace, install, scan skills')
  .option('-i, --install <id>', 'Install skill')
  .option('-s, --scan <id>', 'Security scan a skill')
  .option('-m, --marketplace', 'ClawHub-style marketplace view (installed + bundled)')
  .option('--force', 'Force install (bypass risk block)')
  .option('--hide-suspicious', 'Hide suspicious/dangerous skills')
  .action(async (opts) => {
    const hub = new SkillHub();
    if (opts.scan) await hub.scan(opts.scan);
    else if (opts.install) await hub.install(opts.install, opts.force);
    else if (opts.marketplace) await hub.showMarketplace({ hideSuspicious: opts.hideSuspicious });
    else await hub.showHub(opts.hideSuspicious);
    process.exit(0);
  });

// ─── SKILL (ClawHub) ─────────────────────────────────────────────────────────

const skillCmd = program.command('skill').description('ClawHub — search and install skills from registry');
skillCmd.command('search [query]')
  .description('Search ClawHub for skills')
  .option('-c, --category <cat>', 'Filter by category')
  .action(async (query, opts) => {
    const hub = new SkillHub();
    const q = query || '';
    const skills = await hub.searchClawHub(q, opts.category);
    if (skills.length === 0) {
      console.log(chalk.gray(q ? `No skills found for "${q}"` : 'Browse at hub: hyperclaw hub'));
      process.exit(0);
      return;
    }
    console.log(chalk.bold.hex('#06b6d4')('\n  ClawHub search results:\n'));
    for (const s of skills) {
      const stars = '★'.repeat(Math.round(s.rating || 0)) + '☆'.repeat(5 - Math.round(s.rating || 0));
      console.log(`  ${chalk.bold(s.name || s.id)}  ${chalk.gray(s.author || '')}  ${chalk.hex('#06b6d4')(stars)}  ${chalk.gray((s.downloads || 0).toLocaleString())} dl`);
      console.log(`    ${chalk.gray(s.description || '')}`);
      console.log(`    ${chalk.hex('#06b6d4')('hyperclaw skill install ' + (s.id || s.name))}\n`);
    }
    process.exit(0);
  });
skillCmd.command('list')
  .description('List installed skills (bundled + ClawHub)')
  .action(async () => {
    const hub = new SkillHub();
    const installed = await hub.getInstalled();
    console.log(chalk.bold.hex('#06b6d4')('\n  Installed skills:\n'));
    for (const s of installed) {
      const src = SKILL_REGISTRY.some(r => r.id === s.id) ? '' : ' (ClawHub)';
      console.log(`  ${chalk.hex('#06b6d4')('✓')} ${s.name} ${chalk.gray(`(${s.id})${src}`)}`);
    }
    if (installed.length === 0) {
      console.log(chalk.gray('  No skills installed. Run: hyperclaw hub or hyperclaw skill search <query>\n'));
    } else {
      console.log();
    }
    process.exit(0);
  });
skillCmd.command('install <id>')
  .description('Install skill from ClawHub (or bundled when registry unavailable)')
  .option('-v, --version <ver>', 'Pin version (e.g. 2.0.0)')
  .option('--force', 'Force install (bypass risk block for bundled)')
  .action(async (id, opts) => {
    const hub = new SkillHub();
    const ora = (await import('ora')).default;
    const s = ora(`Installing ${id}...`).start();
    try {
      const dest = await hub.installFromClawHub(id, opts.version);
      s.succeed(`Installed to ${dest}`);
    } catch (e: any) {
      const match = SKILL_REGISTRY.find((x: { id: string }) => x.id === id);
      if (match) {
        await hub.install(id, !!opts?.force);
        s.succeed(`Installed bundled skill: ${match.name}`);
      } else {
        s.fail(e.message);
      }
    }
    process.exit(0);
  });

// ─── MENU BAR (macOS) ────────────────────────────────────────────────────────

program.command('menu-bar')
  .description('Launch macOS menu bar companion (Electron tray app)')
  .action(async () => {
    const path = await import('path');
    const { spawn } = await import('child_process');
    const fs = await import('fs-extra');
    const root = path.join(process.cwd(), 'apps', 'macos');
    const altRoot = path.join(__dirname, '..', '..', 'apps', 'macos');
    const macosDir = (await fs.pathExists(root)) ? root : (await fs.pathExists(altRoot)) ? altRoot : null;
    if (!macosDir || !(await fs.pathExists(path.join(macosDir, 'package.json')))) {
      console.log(chalk.gray('\n  macOS menu bar app not found.'));
      console.log(chalk.gray('  Run from HyperClaw repo root, or: cd apps/macos && npm start\n'));
      process.exit(1);
    }
    const child = spawn('npm', ['start'], { cwd: macosDir, stdio: 'inherit', shell: true });
    child.on('error', () => {});
    child.on('exit', (code) => process.exit(code ?? 0));
  });

// ─── UPDATE ──────────────────────────────────────────────────────────────────

program.command('update')
  .description('Update HyperClaw')
  .option('-c, --channel <channel>', 'Update channel: stable|beta|dev')
  .action(async (opts) => {
    const installKind = await detectInstallKind();
    const gitInfo = installKind === 'git' ? await getCurrentGitInfo() : undefined;
    const storedChannel = await getStoredChannel();

    const effective = resolveEffectiveUpdateChannel({
      installKind,
      git: gitInfo,
      requestedChannel: opts.channel as any,
      storedChannel
    });

    console.log(chalk.gray(`\n  Install kind: ${installKind}  |  Channel source: ${effective.source}`));
    await performUpdate(effective.channel, installKind);
    process.exit(0);
  });

// ─── DOCTOR ──────────────────────────────────────────────────────────────────

program.command('doctor')
  .description('Health check — surfaces misconfigs and risky DM policies')
  .option('--fix', 'Auto-repair fixable issues')
  .action(async (opts) => {
    await runDoctor(opts.fix);
    process.exit(0);
  });

// ─── MEMORY ──────────────────────────────────────────────────────────────────

const memCmd = program.command('memory').description('Agent memory management');

memCmd.command('show')
  .description('Display AGENTS.md and MEMORY.md')
  .action(async () => {
    const m = new MemoryManager();
    const data = await m.load();
    if (data) {
      console.log(chalk.bold.hex('#06b6d4')('\n── AGENTS.md ──\n'));
      console.log(chalk.gray(data.agents));
      console.log(chalk.bold.hex('#06b6d4')('\n── MEMORY.md ──\n'));
      console.log(chalk.gray(data.memory));
    } else {
      console.log(chalk.gray('\n  No memory initialized. Run: hyperclaw init\n'));
    }
    process.exit(0);
  });

memCmd.command('add-rule <rule>')
  .description('Append a global rule to AGENTS.md')
  .action(async (rule) => { await (new MemoryManager()).appendRule(rule); process.exit(0); });

memCmd.command('add-fact <fact>')
  .description('Add a fact to MEMORY.md')
  .action(async (fact) => { await (new MemoryManager()).addMemory(fact); process.exit(0); });

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const cfgCmd = program.command('config').description('Configuration management');

cfgCmd.command('show')
  .description('Show current configuration (scrubbed)')
  .action(async () => {
    const cfg = await (new ConfigManager()).load();
    if (!cfg) { console.log(chalk.gray('\n  No config found. Run: hyperclaw init\n')); process.exit(1); }

    const scrubbed = JSON.parse(JSON.stringify(cfg));
    if (scrubbed.provider?.apiKey) scrubbed.provider.apiKey = '***';
    if (scrubbed.gateway?.authToken) scrubbed.gateway.authToken = '***';
    for (const ch of Object.values(scrubbed.channelConfigs || {})) {
      if ((ch as any).token) (ch as any).token = '***';
    }
    console.log('\n' + JSON.stringify(scrubbed, null, 2) + '\n');
    process.exit(0);
  });

cfgCmd.command('set-key <KEY=value>')
  .description('Set an API key or config value')
  .action(async (kv) => {
    const [key, ...rest] = kv.split('=');
    const value = rest.join('=');
    const store = new AuthStore();
    store.setProviderKey(key, value);
    console.log(chalk.hex('#06b6d4')(`\n  ✔  Set ${key}\n`));
    process.exit(0);
  });

cfgCmd.command('set-service-key <serviceId> [apiKey]')
  .description('Set API key for a service (hackerone, bugcrowd, synack, or custom). Prompts if apiKey omitted.')
  .action(async (serviceId, apiKey) => {
    const inquirer = (await import('inquirer')).default;
    const config = new ConfigManager();
    const cfg = await config.load();
    let key = apiKey;
    if (!key || key.trim().length === 0) {
      const r = await inquirer.prompt([{ type: 'password', name: 'k', message: `API key for ${serviceId}:`, mask: '●' }]);
      key = r.k;
    }
    if (!key?.trim()) { console.log(chalk.yellow('  No key provided.')); process.exit(1); }
    const apiKeys = { ...(cfg?.skills?.apiKeys || {}), [serviceId.trim().toLowerCase()]: key.trim() };
    const next = { ...cfg, skills: { ...(cfg?.skills || {}), installed: cfg?.skills?.installed || [], apiKeys } };
    await config.save(next);
    console.log(chalk.green(`  ✔  Service key saved: ${serviceId}`));
    process.exit(0);
  });

cfgCmd.command('schema')
  .description('Show configuration schema')
  .action(() => {
    console.log(chalk.bold.hex('#06b6d4')('\n  Config schema: ~/.hyperclaw/config.json\n'));
    const schema = {
      version: 'string (e.g. "4.0.2")',
      workspaceName: 'string',
      provider: { providerId: 'string', apiKey: 'string (secret)', modelId: 'string' },
      gateway: { port: 'number', bind: '"127.0.0.1"|"0.0.0.0"|"tailscale"|"custom"', authToken: 'string (secret)', tailscaleExposure: '"off"|"serve"|"funnel"', runtime: '"node"|"bun"|"deno"' },
      channels: 'string[] (channel IDs)',
      channelConfigs: 'Record<channelId, { token, dmPolicy: { policy, allowFrom?, pairingCode? } }>',
      identity: { agentName: 'string', userName: 'string', language: 'string' }
    };
    console.log(JSON.stringify(schema, null, 2));
    console.log();
    process.exit(0);
  });

// ─── DEVELOPER KEYS (managed hosting / embed) ─────────────────────────────────

const devKeyCmd = program.command('developer-key').description('Developer API keys for embed & managed hosting');
devKeyCmd.command('create')
  .description('Create a new developer API key')
  .option('-n, --name <name>', 'Key name', 'default')
  .action(async (opts: { name?: string }) => {
    const { id, key, name } = await developerKeys.createDeveloperKey(opts.name ?? 'default');
    console.log(chalk.green('\n  Developer key created.\n'));
    console.log(chalk.gray('  ID:   '), id);
    console.log(chalk.gray('  Name: '), name);
    console.log(chalk.yellow('\n  Key (show once, store securely):'));
    console.log(chalk.bold(`  ${key}\n`));
    console.log(chalk.gray('  Use: Authorization: Bearer <key>\n'));
    process.exit(0);
  });
devKeyCmd.command('list')
  .description('List developer keys')
  .action(async () => {
    const keys = await developerKeys.listDeveloperKeys();
    if (!keys.length) { console.log(chalk.gray('\n  No developer keys.\n')); process.exit(0); return; }
    console.log(chalk.bold.hex('#06b6d4')('\n  Developer keys\n'));
    for (const k of keys) {
      console.log(chalk.gray(`  ${k.id}  ${k.name}  created ${k.createdAt}`));
    }
    console.log();
    process.exit(0);
  });
devKeyCmd.command('revoke <id>')
  .description('Revoke a developer key')
  .action(async (id: string) => {
    const ok = await developerKeys.revokeDeveloperKey(id);
    if (ok) console.log(chalk.green(`  Revoked ${id}\n`));
    else console.log(chalk.red(`  Key not found: ${id}\n`));
    process.exit(ok ? 0 : 1);
  });

// ─── DEPLOY (cloud hosting) ───────────────────────────────────────────────────

program.command('deploy')
  .description('Deploy gateway to cloud (Fly.io or Render)')
  .option('-p, --platform <platform>', 'Platform: fly | render', 'fly')
  .option('--dry-run', 'Show commands without running')
  .action(async (opts: { platform?: string; dryRun?: boolean }) => {
    const platform = (opts.platform ?? 'fly').toLowerCase();
    const dryRun = !!opts.dryRun;
    if (platform === 'fly') {
      console.log(chalk.bold.hex('#06b6d4')('\n  Deploy to Fly.io\n'));
      if (dryRun) {
        console.log(chalk.gray('  Commands to run:'));
        console.log(chalk.gray('    fly launch   # first time'));
        console.log(chalk.gray('    fly secrets set OPENROUTER_API_KEY=xxx HYPERCLAW_GATEWAY_TOKEN=xxx'));
        console.log(chalk.gray('    fly deploy\n'));
      } else {
        const { execSync } = await import('child_process');
        try {
          execSync('fly version', { stdio: 'pipe' });
        } catch {
          console.log(chalk.red('  Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/\n'));
          process.exit(1);
        }
        try {
          execSync('fly deploy', { stdio: 'inherit' });
        } catch (e) {
          process.exit(1);
        }
      }
    } else if (platform === 'render') {
      console.log(chalk.bold.hex('#06b6d4')('\n  Deploy to Render\n'));
      console.log(chalk.gray('  1. Push to GitHub and connect repo at https://render.com'));
      console.log(chalk.gray('  2. New Web Service → use render.yaml'));
      console.log(chalk.gray('  3. Set env: OPENROUTER_API_KEY, HYPERCLAW_GATEWAY_TOKEN\n'));
    } else {
      console.log(chalk.red(`  Unknown platform: ${platform}. Use fly or render.\n`));
      process.exit(1);
    }
    process.exit(0);
  });

// ─── VOICE ───────────────────────────────────────────────────────────────────

program.command('voice-call')
  .description('Start voice call session — terminal mode, talks to gateway')
  .option('-u, --gateway-url <url>', 'Gateway URL', 'http://localhost:18789')
  .action(async (opts: { gatewayUrl?: string }) => {
    const axios = (await import('axios')).default;
    const readline = await import('readline');
    const chalk = require('chalk');
    const url = opts.gatewayUrl || 'http://localhost:18789';
    console.log(chalk.bold.cyan('\n  🎙️  HYPERCLAW VOICE CALL\n'));
    console.log(chalk.gray(`  Gateway: ${url}`));
    console.log(chalk.gray('  Type a message and press Enter. Ctrl+C to exit.\n'));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = () => {
      rl.question(chalk.cyan('  You: '), async (input) => {
        if (!input?.trim()) { ask(); return; }
        try {
          const res = await axios.post(`${url.replace(/\/$/, '')}/api/chat`, { message: input.trim(), thinking: 'none' }, { timeout: 60000 });
          console.log(chalk.green(`  🦅 Agent: ${(res.data?.response || '').slice(0, 500)}\n`));
        } catch (e: any) {
          console.log(chalk.red(`  Error: ${e.response?.data?.error || e.message}\n`));
        }
        ask();
      });
    };
    ask();
  });

program.command('voice')
  .description('Voice control settings')
  .option('-l, --lang <lang>', 'Language code', 'en')
  .option('-w, --wake-word <word>', 'Wake word (uses config if not passed)')
  .action(async (opts) => {
    const cfg = await (new ConfigManager()).load();
    const wakeWord = opts.wakeWord ?? cfg?.identity?.wakeWord ?? 'Hey Hyper';
    await (new VoiceEngine()).configure({
      lang: opts.lang ?? 'en',
      wakeWord
    });
    process.exit(0);
  });

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

program.command('dashboard')
  .description('Launch live terminal dashboard')
  .option('-l, --live', 'Live mode with real-time updates')
  .action(async (opts) => {
    await (new Dashboard()).launch(opts.live);
    if (!opts.live) process.exit(0);
  });

// ─── STATUS ──────────────────────────────────────────────────────────────────

program.command('status')
  .description('System overview')
  .action(async () => {
    await (new Banner()).showStatus();
    process.exit(0);
  });

// ─── THEME ───────────────────────────────────────────────────────────────────

const themeCmd = program.command('theme').description('Switch CLI color theme');

themeCmd.command('list')
  .description('List available themes')
  .action(async () => {
    const { allThemes, getThemeName } = await import('../infra/theme');
    const current = getThemeName();
    console.log(chalk.bold.hex('#06b6d4')('\n  🎨 AVAILABLE THEMES\n'));
    for (const { name, label } of allThemes()) {
      const dot = name === current ? chalk.green('●') : chalk.gray('○');
      const cur = name === current ? chalk.green(' (active)') : '';
      console.log(`  ${dot}  ${chalk.bold(name.padEnd(8))}  ${chalk.gray(label)}${cur}`);
    }
    console.log(chalk.gray('\n  Change: hyperclaw theme set <dark|grey|white>\n'));
    process.exit(0);
  });

themeCmd.command('set <theme>')
  .description('Set theme: dark | grey | white')
  .action(async (name) => {
    const { setThemeName, allThemes } = await import('../infra/theme');
    const valid = allThemes().map(t => t.name);
    if (!valid.includes(name)) {
      console.log(chalk.red(`\n  ✖  Unknown theme: "${name}". Use: ${valid.join(' | ')}\n`));
      process.exit(1);
    }
    await setThemeName(name as any);
    console.log(chalk.green(`\n  ✔  Theme set to: ${chalk.bold(name)}`));
    console.log(chalk.gray('  Restart any running process to apply.\n'));
    process.exit(0);
  });

themeCmd.command('preview')
  .description('Preview all themes side-by-side')
  .action(async () => {
    const { allThemes, getTheme, setThemeName, getThemeName } = await import('../infra/theme');
    const current = getThemeName();
    console.log(chalk.bold('\n  🎨 THEME PREVIEW\n'));
    for (const { name, label } of allThemes()) {
      await setThemeName(name as any);
      const t = getTheme(false);
      const td = getTheme(true);
      console.log(`  ┌─ ${chalk.bold(name)} — ${chalk.gray(label)}`);
      console.log(`  │  ${t.bold('Primary')}  ${t.a('● ◆ ⚡ 🦅')}  ${t.muted('muted text')}  ${t.success('✔ success')}  ${t.error('✖ error')}`);
      console.log(`  │  ${td.bold('Daemon')}   ${td.d('🩸 ● ◆ ⚡')}  ${td.muted('muted text')}  ${td.success('✔ ok')}  ${td.error('✖ err')}`);
      console.log(`  └─ Switch: ${chalk.gray(`hyperclaw theme set ${name}`)}\n`);
    }
    // restore original
    await setThemeName(current as any);
    process.exit(0);
  });

// ─── DEFAULT (no args) — parse happens at the very end of this file ──────────

// ─── SECRETS ─────────────────────────────────────────────────────────────────

const secretsCmd = program.command('secrets').description('External secrets management');

secretsCmd.command('audit')
  .description('Audit all required secrets')
  .option('--required-by <ids>', 'Filter by skill/provider IDs (comma-separated)')
  .action(async (opts) => {
    const { SecretsManager } = await import('../secrets/manager');
    const filter = opts.requiredBy?.split(',');
    await (new SecretsManager()).audit(filter);
    process.exit(0);
  });

secretsCmd.command('set <KEY=value>')
  .description('Set a secret in .env file')
  .action(async (kv) => {
    const { SecretsManager } = await import('../secrets/manager');
    await (new SecretsManager()).set(kv);
    process.exit(0);
  });

secretsCmd.command('apply')
  .description('Write secrets from .env to shell config (~/.bashrc, ~/.zshrc)')
  .action(async () => {
    const { SecretsManager } = await import('../secrets/manager');
    await (new SecretsManager()).apply();
    process.exit(0);
  });

secretsCmd.command('reload')
  .description('Reload secrets into running gateway')
  .action(async () => {
    const { SecretsManager } = await import('../secrets/manager');
    await (new SecretsManager()).reload();
    process.exit(0);
  });

secretsCmd.command('remove <key>')
  .description('Remove a secret from .env')
  .action(async (key) => {
    const { SecretsManager } = await import('../secrets/manager');
    await (new SecretsManager()).remove(key);
    process.exit(0);
  });

secretsCmd.command('credentials')
  .description('List provider credential files (credentials/*.json)')
  .action(async () => {
    const { CredentialsStore } = await import('../secrets/credentials-store');
    await (new CredentialsStore()).showList();
    process.exit(0);
  });

// ─── SECURITY ────────────────────────────────────────────────────────────────

const securityCmd = program.command('security').description('Security tools');

securityCmd.command('audit')
  .description('Security audit — file permissions, DM policies, embedded secrets')
  .option('--deep', 'Full deep scan including token entropy and installed skill risks')
  .action(async (opts) => {
    const { runSecurityAudit } = await import('../security/audit');
    await runSecurityAudit(opts.deep);
    process.exit(0);
  });

// ─── AGENT ───────────────────────────────────────────────────────────────────

const agentRunCmd = program.command('agent').description('Run agent with thinking control');

agentRunCmd
  .requiredOption('-m, --message <text>', 'Message to send to the agent')
  .option('--thinking <level>', 'Thinking level: high|medium|low|none', 'none')
  .option('--model <model>', 'Override model')
  .option('--session <id>', 'Session/thread ID')
  .option('--multi-step', 'Decompose into steps and run each (sequential)')
  .option('--parallel', 'Run sub-agents in parallel for independent subtasks')
  .option('--verbose', 'Show thinking blocks and request details')
  .option('--workspace <dir>', 'Override workspace directory')
  .action(async (opts) => {
    const { runAgent } = await import('hyperclaw/core');
    await runAgent({
      message: opts.message,
      thinking: opts.thinking,
      model: opts.model,
      sessionId: opts.session,
      stream: false,
      workspace: opts.workspace,
      verbose: opts.verbose,
      multiStep: opts.multiStep,
      parallel: opts.parallel
    });
    process.exit(0);
  });

// ─── THREADS (ACP) ───────────────────────────────────────────────────────────

const threadsCmd = program.command('threads').description('ACP thread-bound agent sessions');

threadsCmd.command('list')
  .description('List agent threads')
  .option('--channel <id>', 'Filter by channel')
  .option('--active', 'Show only active threads')
  .action(async (opts) => {
    const { ACPThreadManager } = await import('hyperclaw/core');
    const mgr = new ACPThreadManager();
    const threads = await mgr.list({
      channelId: opts.channel,
      status: opts.active ? 'active' : undefined
    });
    mgr.showList(threads);
    process.exit(0);
  });

threadsCmd.command('terminate <id>')
  .description('Terminate a thread')
  .action(async (id) => {
    const { ACPThreadManager } = await import('hyperclaw/core');
    await (new ACPThreadManager()).terminate(id);
    console.log(require('chalk').green(`\n  ✔  Thread terminated: ${id}\n`));
    process.exit(0);
  });

// ─── CANVAS ──────────────────────────────────────────────────────────────────

const canvasCmd = program.command('canvas').description('Live AI-driven UI canvas');

canvasCmd.command('show')
  .description('Show current canvas components')
  .action(async () => {
    const { CanvasRenderer } = await import('../canvas/renderer');
    await (new CanvasRenderer()).show();
    process.exit(0);
  });

canvasCmd.command('add <type> <title>')
  .description('Add a canvas component (type: chart|table|form|markdown|image|custom)')
  .action(async (type, title) => {
    const { CanvasRenderer } = await import('../canvas/renderer');
    await (new CanvasRenderer()).addComponent(type as any, title);
    process.exit(0);
  });

canvasCmd.command('clear')
  .description('Clear all canvas components')
  .action(async () => {
    const { CanvasRenderer } = await import('../canvas/renderer');
    await (new CanvasRenderer()).clear();
    process.exit(0);
  });

canvasCmd.command('export')
  .description('Export canvas as HTML file')
  .action(async () => {
    const { CanvasRenderer } = await import('../canvas/renderer');
    const fs = require('fs-extra');
    const html = await (new CanvasRenderer()).exportHtml();
    const outFile = require('path').join(require('os').homedir(), '.hyperclaw', 'canvas', 'export.html');
    await fs.writeFile(outFile, html);
    console.log(require('chalk').green(`\n  ✔  Canvas exported to ${outFile}\n`));
    process.exit(0);
  });

// ─── DELIVERY ────────────────────────────────────────────────────────────────

const deliveryCmd = program.command('delivery').description('Message delivery queue');

deliveryCmd.command('status')
  .description('Show delivery queue status')
  .action(() => {
    const { DeliveryQueue } = require('../delivery/queue');
    (new DeliveryQueue()).showStatus();
    process.exit(0);
  });

deliveryCmd.command('retry <id>')
  .description('Retry a dead-lettered delivery item')
  .action((id) => {
    const { DeliveryQueue } = require('../delivery/queue');
    (new DeliveryQueue()).retry(id);
    process.exit(0);
  });

// ─── MCP ─────────────────────────────────────────────────────────────────────

const mcpCmd = program.command('mcp').description('MCP (Model Context Protocol) server management');
mcpCmd.command('list').action(async () => { const { mcpList } = await import('../commands/mcp'); await mcpList(); process.exit(0); });
mcpCmd.command('add').action(async () => { const { mcpAdd } = await import('../commands/mcp'); await mcpAdd(); process.exit(0); });
mcpCmd.command('remove <id>').action(async (id) => { const { mcpRemove } = await import('../commands/mcp'); await mcpRemove(id); process.exit(0); });
mcpCmd.command('probe [id]').action(async (id) => { const { mcpProbe } = await import('../commands/mcp'); await mcpProbe(id); process.exit(0); });

// ─── NODE ────────────────────────────────────────────────────────────────────

const nodeCmd = program.command('node').description('HyperClaw node management (local, remote, android)');
nodeCmd.command('list').action(async () => { const { nodeList } = await import('../commands/node'); await nodeList(); process.exit(0); });
nodeCmd.command('add').action(async () => { const { nodeAdd } = await import('../commands/node'); await nodeAdd(); process.exit(0); });
nodeCmd.command('probe [id]').action(async (id) => { const { nodeProbe } = await import('../commands/node'); await nodeProbe(id); process.exit(0); });
nodeCmd.command('remove <id>').action(async (id) => { const { nodeRemove } = await import('../commands/node'); await nodeRemove(id); process.exit(0); });

// ─── AUTO-REPLY ───────────────────────────────────────────────────────────────

const arCmd = program.command('auto-reply').description('Auto-reply rule engine');
arCmd.command('list').action(async () => {
  const { AutoReplyEngine } = await import('../auto-reply/rules');
  const e = new AutoReplyEngine(); await e.load(); e.showList(); process.exit(0);
});
arCmd.command('toggle <id>').action(async (id) => {
  const { AutoReplyEngine } = await import('../auto-reply/rules');
  const e = new AutoReplyEngine(); await e.toggle(id); process.exit(0);
});
arCmd.command('remove <id>').action(async (id) => {
  const { AutoReplyEngine } = await import('../auto-reply/rules');
  const e = new AutoReplyEngine(); await e.remove(id); process.exit(0);
});

// ─── GMAIL PUB/SUB ───────────────────────────────────────────────────────────

const gmailCmd = program.command('gmail').description('Gmail Pub/Sub real-time notifications');
gmailCmd.command('watch-setup')
  .description('Register Gmail watch for push notifications. Requires: hyperclaw auth oauth google-gmail')
  .requiredOption('-t, --topic <name>', 'Pub/Sub topic (e.g. projects/myproject/topics/gmail-push)')
  .option('-l, --labels <ids>', 'Label IDs to watch (comma-separated)', 'INBOX')
  .action(async (opts) => {
    const chalk = require('chalk');
    try {
      const { setupGmailWatch } = await import('../commands/gmail-watch-setup');
      const labelIds = opts.labels.split(',').map((s: string) => s.trim()).filter(Boolean);
      const result = await setupGmailWatch({ topicName: opts.topic, labelIds });
      console.log(chalk.hex('#06b6d4')('\n  ✔  Gmail watch registered'));
      console.log(chalk.gray(`     historyId: ${result.historyId}`));
      console.log(chalk.gray(`     expiration: ${new Date(parseInt(result.expiration, 10)).toISOString()}`));
      console.log(chalk.gray('\n  Push endpoint: https://<your-server>/webhook/gmail-pubsub'));
      console.log(chalk.gray('  Ensure email channel is enabled and gateway is publicly accessible.\n'));
    } catch (e: any) {
      console.error(chalk.red('\n  ✖  ' + e.message + '\n'));
      process.exit(1);
    }
    process.exit(0);
  });

// ─── CRON (scheduled tasks) ───────────────────────────────────────────────────

const cronCmd = program.command('cron').description('Scheduled tasks (cron → agent prompt)');
cronCmd.command('list').action(async () => {
  const chalk = require('chalk');
  const { loadCronTasks } = await import('../services/cron-tasks');
  const tasks = await loadCronTasks();
  console.log(chalk.bold.cyan('\n  ⏰ CRON TASKS\n'));
  if (tasks.length === 0) {
    console.log(chalk.gray('  No tasks. Add: hyperclaw cron add "0 9 * * 1-5" "Check calendar"\n'));
    process.exit(0);
    return;
  }
  for (const t of tasks) {
    const dot = t.enabled ? chalk.green('●') : chalk.gray('○');
    console.log(`  ${dot} ${chalk.white(t.name || t.id)}`);
    console.log(`     ${chalk.gray('Schedule:')} ${t.schedule}`);
    console.log(`     ${chalk.gray('Prompt:')} ${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? '...' : ''}`);
    if (t.lastRunAt) console.log(`     ${chalk.gray('Last run:')} ${t.lastRunAt}`);
    console.log();
  }
  process.exit(0);
});
cronCmd.command('add').arguments('<schedule> <prompt>').option('-n, --name <name>', 'Task name').action(async (schedule, prompt, opts) => {
  const chalk = require('chalk');
  const { loadCronTasks, addCronTask, saveCronTasks } = await import('../services/cron-tasks');
  await loadCronTasks();
  addCronTask(schedule, prompt, opts.name);
  await saveCronTasks();
  console.log(chalk.green(`\n  ✔  Cron task added: ${schedule} → "${prompt.slice(0, 40)}..."\n`));
  console.log(chalk.gray('  Restart gateway to apply.\n'));
  process.exit(0);
});
cronCmd.command('remove <id>').action(async (id) => {
  const chalk = require('chalk');
  const { loadCronTasks, removeCronTask, saveCronTasks } = await import('../services/cron-tasks');
  await loadCronTasks();
  if (removeCronTask(id)) {
    await saveCronTasks();
    console.log(chalk.green(`\n  ✔  Task removed\n`));
  } else {
    console.log(chalk.red(`\n  ✖  Task not found: ${id}\n`));
  }
  process.exit(0);
});

// ─── NODES (Connect tab / mobile) ────────────────────────────────────────────

program.command('nodes')
  .description('List connected mobile nodes (iOS/Android Connect tab)')
  .action(async () => {
    const chalk = require('chalk');
    const http = await import('http');
    const fs = await import('fs-extra');
    const path = await import('path');
    const os = await import('os');
    let port = 18789;
    try {
      const cfg = await fs.readJson(path.join(os.homedir(), '.hyperclaw', 'hyperclaw.json'));
      port = cfg?.gateway?.port ?? 18789;
    } catch { /* use default */ }
    return new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/nodes`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            const nodes = j.nodes || [];
            console.log(chalk.bold.cyan('\n  📱 CONNECTED NODES\n'));
            if (nodes.length === 0) {
              console.log(chalk.gray('  No mobile nodes. Open iOS/Android app → Connect tab → pair with gateway.'));
              console.log(chalk.gray(`  Gateway: ws://localhost:${port}\n`));
            } else {
              for (const n of nodes) {
                console.log(`  ${chalk.green('●')} ${n.nodeId} ${chalk.gray(`(${n.platform || '?'})`)}`);
                console.log(`    ${chalk.gray('Device:')} ${n.deviceName || '—'}`);
                console.log(`    ${chalk.gray('Capabilities:')} ${Object.entries(n.capabilities || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || '—'}`);
              }
              console.log();
            }
          } catch { console.log(chalk.red('  Could not reach gateway. Start with: hyperclaw daemon start\n')); }
          resolve();
        });
      });
      req.on('error', () => {
        console.log(chalk.red('  Gateway offline. Start with: hyperclaw daemon start\n'));
        resolve();
      });
      req.setTimeout(3000, () => { req.destroy(); resolve(); });
    }).then(() => process.exit(0));
  });

// ─── WEBHOOKS ────────────────────────────────────────────────────────────────

const whCmd = program.command('webhooks').description('Webhook endpoint management');
whCmd.command('list').action(async () => {
  const { WebhookManager } = await import('../webhooks/manager');
  const m = new WebhookManager(); await m.load(); m.showList(); process.exit(0);
});
whCmd.command('remove <id>').action(async (id) => {
  const { WebhookManager } = await import('../webhooks/manager');
  const m = new WebhookManager(); await m.remove(id); process.exit(0);
});
whCmd.command('toggle <id>').action(async (id) => {
  const { WebhookManager } = await import('../webhooks/manager');
  const m = new WebhookManager(); await m.toggle(id); process.exit(0);
});

// ─── LOGS ────────────────────────────────────────────────────────────────────

const logsCmd = program.command('logs').description('View gateway logs');
logsCmd.option('-n, --lines <n>', 'Number of lines to show', '50');
logsCmd.option('-f, --follow', 'Stream logs in real time');
logsCmd.action(async (opts) => {
  const { tailLog, streamLog } = await import('../logging/logger');
  if (opts.follow) { await streamLog(); }
  else { await tailLog(parseInt(opts.lines)); process.exit(0); }
});

// ─── GATEWAY SERVER START ─────────────────────────────────────────────────────

program.command('gateway:serve')
  .description('Start the gateway server in the foreground (used by daemon)')
  .action(async () => {
    const { startGateway } = await import('../gateway/server');
    await startGateway();
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
    await new Promise(() => {}); // keep alive
  });


// ─── GATEWAY CONFIG ────────────────────────────────────────────────────────────

const gatewayCfgCmd = gatewayCmd.command('config').description('Configure gateway settings');

gatewayCfgCmd
  .option('--set-token <token>', 'Set gateway auth token')
  .option('--regenerate-token', 'Generate a new random token')
  .option('--set-port <port>', 'Set gateway port')
  .option('--set-bind <addr>', 'Set gateway bind address')
  .action(async (opts) => {
    const chalk = require('chalk');
    const fs = require('fs-extra');
    const path = require('path');
    const os = require('os');
    const crypto = require('crypto');

    const cfgFile = path.join(os.homedir(), '.hyperclaw', 'hyperclaw.json');
    let cfg: any = {};
    try { cfg = await fs.readJson(cfgFile); } catch {}
    if (!cfg.gateway) cfg.gateway = { port: 18789, bind: '127.0.0.1', authToken: '', runtime: 'node', enabledChannels: [], hooks: true };

    if (opts.regenerateToken) {
      cfg.gateway.authToken = crypto.randomBytes(32).toString('hex');
      console.log(chalk.hex('#06b6d4')('\n  ✔  New gateway token generated'));
      console.log(chalk.gray(`  Token: ${cfg.gateway.authToken}`));
    }
    if (opts.setToken) {
      cfg.gateway.authToken = opts.setToken;
      console.log(chalk.hex('#06b6d4')(`\n  ✔  Gateway token set`));
    }
    if (opts.setPort) {
      cfg.gateway.port = parseInt(opts.setPort);
      console.log(chalk.hex('#06b6d4')(`\n  ✔  Port set to ${cfg.gateway.port}`));
    }
    if (opts.setBind) {
      cfg.gateway.bind = opts.setBind;
      console.log(chalk.hex('#06b6d4')(`\n  ✔  Bind set to ${cfg.gateway.bind}`));
    }

    await fs.ensureDir(path.dirname(cfgFile));
    await fs.writeJson(cfgFile, cfg, { spaces: 2 });
    await fs.chmod(cfgFile, 0o600);
    console.log(chalk.gray(`  Saved to ${cfgFile}\n`));
    process.exit(0);
  });

// ─── AUTH (OAuth and custom API keys) ───────────────────────────────────────────

const authCmd = program.command('auth').description('OAuth and provider credentials');

authCmd.command('add <service_id>')
  .description('Add API key for a service (any provider we do not ship). Stored in credentials/ and .env.')
  .option('--key <api_key>', 'API key (prompts if omitted)')
  .option('--base-url <url>', 'Base URL (optional, e.g. https://api.example.com)')
  .option('--env-var <name>', 'Env var name (default: <SERVICE_ID>_API_KEY)')
  .action(async (serviceId: string, opts: { key?: string; baseUrl?: string; envVar?: string }) => {
    const chalk = require('chalk');
    const inquirer = require('inquirer');
    const { CredentialsStore } = await import('../secrets/credentials-store');
    const { getHyperClawDir, getEnvFilePath } = await import('../infra/paths');
    const { getApiKeyGuide, GENERIC_API_KEY_STEPS } = await import('../infra/api-keys-guide');
    const fs = await import('fs-extra');
    const path = await import('path');

    const guide = getApiKeyGuide(serviceId);
    const steps = guide?.setupSteps ?? GENERIC_API_KEY_STEPS;

    console.log(chalk.bold.hex('#06b6d4')(`\n  🔑 Add API key: ${guide?.name ?? serviceId}\n`));
    console.log(chalk.bold('  Steps:\n'));
    for (const step of steps) {
      if (step.startsWith('  🔗')) console.log(chalk.hex('#06b6d4')(step));
      else if (step.startsWith('  💡')) console.log(chalk.gray(step));
      else console.log(chalk.gray(`  ${step}`));
    }
    console.log();

    const safeId = serviceId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    if (!safeId) {
      console.log(chalk.red('\n  ✖  Invalid service ID\n'));
      process.exit(1);
    }

    let apiKey = opts.key || process.env[`${safeId.toUpperCase().replace(/-/g, '_')}_API_KEY`];
    if (!apiKey) {
      const { key } = await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: `API key for ${serviceId}:`,
        mask: '●',
        validate: (v: string) => v.trim().length > 0 || 'API key is required'
      }]);
      apiKey = key.trim();
    }

    const creds = new CredentialsStore(getHyperClawDir());
    await creds.set(safeId, {
      apiKey,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(opts.baseUrl ? {} : {})
    });

    const envVar = opts.envVar || `${safeId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const envPath = getEnvFilePath();
    await fs.ensureDir(path.dirname(envPath));
    let envContent = '';
    if (await fs.pathExists(envPath)) envContent = await fs.readFile(envPath, 'utf8');
    const envLine = `${envVar}=${apiKey}`;
    const re = new RegExp(`^${envVar}=.*$`, 'm');
    if (re.test(envContent)) envContent = envContent.replace(re, envLine);
    else envContent = envContent.trimEnd() + (envContent ? '\n' : '') + envLine + '\n';
    await fs.writeFile(envPath, envContent, { mode: 0o600 });

    console.log(chalk.hex('#06b6d4')(`\n  ✔  Added: ${safeId}`));
    console.log(chalk.gray(`     Credentials: ~/.hyperclaw/credentials/${safeId}.json`));
    console.log(chalk.gray(`     Env: ${envVar} (in .env — use in skills via process.env.${envVar.replace(/-/g, '_')})`));
    console.log(chalk.gray('\n  Run: hyperclaw secrets apply   to add to shell'));
    console.log(chalk.gray('  Run: hyperclaw secrets reload  to inject into running gateway\n'));
    process.exit(0);
  });

authCmd.command('remove <service_id>')
  .description('Remove API key for a service from credentials and .env')
  .action(async (serviceId: string) => {
    const chalk = require('chalk');
    const { CredentialsStore } = await import('../secrets/credentials-store');
    const { getHyperClawDir, getEnvFilePath } = await import('../infra/paths');
    const fs = await import('fs-extra');

    const safeId = serviceId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const creds = new CredentialsStore(getHyperClawDir());
    await creds.remove(safeId);

    const envVar = `${safeId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const envPath = getEnvFilePath();
    if (await fs.pathExists(envPath)) {
      let c = await fs.readFile(envPath, 'utf8');
      c = c.replace(new RegExp(`^${envVar}=.*\n?`, 'gm'), '');
      await fs.writeFile(envPath, c);
    }
    console.log(chalk.hex('#06b6d4')(`\n  ✔  Removed: ${safeId}\n`));
    process.exit(0);
  });

authCmd.command('oauth <provider>')
  .description('Run full OAuth flow. Providers: google, google-gmail (Gmail Pub/Sub), microsoft')
  .option('--client-id <id>', 'OAuth client ID (or GOOGLE_OAUTH_CLIENT_ID)')
  .option('--client-secret <secret>', 'OAuth client secret (optional for PKCE)')
  .action(async (provider: string, opts: { clientId?: string; clientSecret?: string }) => {
    const chalk = require('chalk');
    const ora = (await import('ora')).default;
    try {
      const { runOAuthFlow } = await import('../services/oauth-flow');
      const spinner = ora('Starting OAuth flow...').start();
      spinner.text = 'Opening browser — complete the consent and return here.';
      const tokens = await runOAuthFlow(provider, { clientId: opts.clientId, clientSecret: opts.clientSecret });
      spinner.stop();
      const { writeOAuthToken } = await import('../services/oauth-provider');
      const now = Math.floor(Date.now() / 1000);
      const expires_at = tokens.expires_in ? now + tokens.expires_in : undefined;
      const tokenUrl = (provider === 'google' || provider === 'google-gmail') ? 'https://oauth2.googleapis.com/token' : provider === 'microsoft' ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token' : undefined;
      await writeOAuthToken(provider, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at,
        token_url: tokenUrl
      });
      console.log(chalk.hex('#06b6d4')(`\n  ✔  OAuth tokens saved for: ${provider}`));
      console.log(chalk.gray('  Set in hyperclaw.json: "provider": { "authType": "oauth", "providerId": "' + provider + '" }\n'));
    } catch (e: any) {
      console.error(chalk.red('\n  ✖  OAuth failed: ' + e.message + '\n'));
      process.exit(1);
    }
    process.exit(0);
  });

authCmd.command('setup-token <provider>')
  .description('Save setup token (Anthropic Claude Pro/Max). Run: claude setup-token, paste result here.')
  .action(async (provider: string) => {
    const chalk = require('chalk');
    const inquirer = await import('inquirer');
    if (provider !== 'anthropic') {
      console.log(chalk.yellow(`\n  Provider "${provider}" may not support setup-token. Use "hyperclaw auth add" for API keys.\n`));
      process.exit(1);
    }
    const { token } = await inquirer.default.prompt([{ type: 'password', name: 'token', message: 'Paste setup token from `claude setup-token`:', mask: '●' }]);
    if (!token?.trim()) { console.log(chalk.red('\n  ✖  No token provided.\n')); process.exit(1); }
    const { writeOAuthToken } = await import('../services/oauth-provider');
    await writeOAuthToken('anthropic-setup', { access_token: token.trim(), token_url: 'https://api.anthropic.com' });
    console.log(chalk.hex('#06b6d4')('\n  ✔  Anthropic setup token saved to ~/.hyperclaw/oauth-anthropic-setup.json'));
    console.log(chalk.gray('  Use providerId: anthropic with authType: oauth and oauthTokenPath for Claude Pro/Max.\n'));
    process.exit(0);
  });

authCmd.command('oauth-set <provider>')
  .description('Save OAuth tokens manually (access_token, refresh_token, etc.) to ~/.hyperclaw/oauth-<provider>.json')
  .option('--token <access_token>', 'Access token')
  .option('--refresh <refresh_token>', 'Refresh token (optional)')
  .option('--expires-in <seconds>', 'Token lifetime in seconds (optional)')
  .option('--token-url <url>', 'Refresh endpoint URL (optional)')
  .action(async (provider: string, opts: any) => {
    const chalk = require('chalk');
    const { writeOAuthToken } = await import('../services/oauth-provider');
    const access_token = opts.token || process.env.OAUTH_ACCESS_TOKEN;
    if (!access_token) {
      console.log(chalk.red('\n  ✖  Provide --token <access_token> or set OAUTH_ACCESS_TOKEN\n'));
      process.exit(1);
    }
    const expires_at = opts.expiresIn ? Math.floor(Date.now() / 1000) + parseInt(opts.expiresIn, 10) : undefined;
    await writeOAuthToken(provider, {
      access_token,
      refresh_token: opts.refresh || undefined,
      expires_at,
      token_url: opts.tokenUrl || undefined
    });
    console.log(chalk.hex('#06b6d4')(`\n  ✔  OAuth tokens saved for provider: ${provider}`));
    console.log(chalk.gray('  Set in hyperclaw.json: "provider": { "authType": "oauth", "providerId": "' + provider + '" }\n'));
    process.exit(0);
  });

// ─── WORKSPACE ────────────────────────────────────────────────────────────────

const workspaceCmd = program.command('workspace').description('Manage agent workspace files');

workspaceCmd.command('init [dir]')
  .description('Initialize workspace files (SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md) in a directory')
  .action(async (dir) => {
    const chalk = require('chalk');
    const fs = require('fs-extra');
    const path = require('path');
    const os = require('os');

    const targetDir = dir || path.join(os.homedir(), '.hyperclaw');
    let cfg: any = {};
    try { cfg = await fs.readJson(path.join(os.homedir(), '.hyperclaw', 'hyperclaw.json')); } catch {}

    const { initWorkspaceFiles } = await import('../agents/memory');
    await initWorkspaceFiles({
      agentName: cfg.identity?.agentName || 'Hyper',
      personality: cfg.identity?.personality || 'helpful and concise',
      language: cfg.identity?.language || 'English',
      userName: cfg.identity?.userName || 'User',
      rules: cfg.identity?.rules ?? []
    }, targetDir);

    console.log(chalk.hex('#06b6d4')(`\n  ✔  Workspace files initialized in ${targetDir}`));
    console.log(chalk.gray('  Files: SOUL.md  USER.md  TOOLS.md  HEARTBEAT.md  BOOTSTRAP.md\n'));
    process.exit(0);
  });

workspaceCmd.command('show [dir]')
  .description('Show workspace files summary')
  .action(async (dir) => {
    const chalk = require('chalk');
    const fs = require('fs-extra');
    const path = require('path');
    const os = require('os');
    const targetDir = dir || path.join(os.homedir(), '.hyperclaw');

    console.log(chalk.bold.hex('#06b6d4')('\n  📁 WORKSPACE\n'));
    for (const fname of ['SOUL.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'AGENTS.md', 'MEMORY.md']) {
      const fpath = path.join(targetDir, fname);
      const exists = await fs.pathExists(fpath);
      const size = exists ? (await fs.stat(fpath)).size : 0;
      const dot = exists ? chalk.hex('#06b6d4')('✔') : chalk.gray('○');
      console.log(`  ${dot} ${fname.padEnd(14)} ${exists ? chalk.gray(`${size} bytes`) : chalk.gray('(missing)')}`);
    }
    console.log();
    process.exit(0);
  });

// ─── BOT (HyperClaw Bot) ──────────────────────────────────────────────────────

const botCmd = program.command('bot').description('HyperClaw Bot — companion bot for remote gateway control');

botCmd.command('status')
  .action(async () => {
    const { showBotStatus } = await import('../bot/hyperclawbot');
    await showBotStatus();
    process.exit(0);
  });

botCmd.command('setup')
  .description('Configure HyperClaw Bot (Telegram token, allowed users)')
  .action(async () => {
    const inquirer = require('inquirer');
    const { saveBotConfig } = await import('../bot/hyperclawbot');
    const chalk = require('chalk');

    console.log(chalk.bold.hex('#06b6d4')('\n  🦅 HYPERCLAW BOT SETUP\n'));
    console.log(chalk.gray('  Create a bot at t.me/BotFather, then paste the token below.\n'));

    const { platform } = await inquirer.prompt([{
      type: 'list', name: 'platform', message: 'Platform:', choices: ['telegram', 'discord']
    }]);
    const { token } = await inquirer.prompt([{
      type: 'input', name: 'token',
      message: platform === 'telegram' ? 'Bot token (from @BotFather):' : 'Discord bot token:',
      validate: (v: string) => v.trim().length > 10 || 'Required'
    }]);
    const { userIds } = await inquirer.prompt([{
      type: 'input', name: 'userIds',
      message: 'Allowed user IDs (comma-separated, leave empty for unrestricted):',
    }]);
    const { gatewayUrl } = await inquirer.prompt([{
      type: 'input', name: 'gatewayUrl', message: 'Gateway URL:', default: 'http://localhost:18789'
    }]);

    const cfg = {
      platform, token, gatewayUrl,
      allowedUsers: userIds ? userIds.split(',').map((s: string) => s.trim()) : [],
      gatewayToken: undefined,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    await saveBotConfig(cfg);
    console.log(chalk.hex('#06b6d4')('\n  ✔  HyperClaw Bot configured'));
    if (platform === 'discord') {
      try {
        require.resolve('discord.js');
      } catch {
        console.log(chalk.yellow('  ⚠  For Discord: run: npm install discord.js'));
      }
    }
    console.log(chalk.gray('  Start with: hyperclaw bot start\n'));
    process.exit(0);
  });

botCmd.command('start')
  .description('Start HyperClaw Bot (foreground or background)')
  .option('--background', 'Run bot in background (use hyperclaw bot stop to stop)')
  .action(async (opts: { background?: boolean }) => {
    const { spawn } = await import('child_process');
    const path = await import('path');

    if (opts?.background) {
      const entry = process.argv[1] || path.join(__dirname, 'run-main.js');
      const child = spawn(process.execPath, [entry, 'bot', 'start'], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
        cwd: process.cwd()
      });
      child.unref();
      const { writeBotPid } = await import('../bot/hyperclawbot');
      await writeBotPid(child.pid!);
      console.log(require('chalk').green(`\n  ✔  HyperClaw Bot started in background (PID ${child.pid})`));
      console.log(require('chalk').gray('  Stop with: hyperclaw bot stop\n'));
      process.exit(0);
      return;
    }

    const { loadBotConfig, TelegramHyperClawBot, DiscordHyperClawBot } = await import('../bot/hyperclawbot');
    const cfg = await loadBotConfig();
    if (!cfg) {
      console.log(require('chalk').red('\n  ✖  HyperClaw Bot not configured. Run: hyperclaw bot setup\n'));
      process.exit(1);
    }
    if (cfg.platform === 'telegram') {
      const bot = new TelegramHyperClawBot(cfg);
      process.on('SIGINT', () => { bot.stop(); process.exit(0); });
      await bot.start();
    } else if (cfg.platform === 'discord') {
      const bot = new DiscordHyperClawBot(cfg);
      process.on('SIGINT', () => { bot.stop(); process.exit(0); });
      await bot.start();
    } else {
      console.log(require('chalk').yellow('\n  Unsupported platform. Use telegram or discord.\n'));
      process.exit(1);
    }
  });

botCmd.command('stop')
  .description('Stop HyperClaw Bot (when running in background)')
  .action(async () => {
    const chalk = require('chalk');
    const { stopBotProcess } = await import('../bot/hyperclawbot');
    const stopped = await stopBotProcess();
    if (stopped) {
      console.log(chalk.green('\n  ✔  HyperClaw Bot stopped\n'));
    } else {
      console.log(chalk.gray('\n  Bot not running in background (no PID file). Use Ctrl+C to stop foreground bot.\n'));
    }
    process.exit(stopped ? 0 : 0);
  });

// ─── MEMORY (extended) ────────────────────────────────────────────────────────

memCmd.command('search <query>')
  .description('Search MEMORY.md')
  .action(async (query) => {
    const { searchMemory } = await import('hyperclaw/core');
    await searchMemory(query);
    process.exit(0);
  });

memCmd.command('auto-show')
  .description('Show auto-extracted memories from MEMORY.md')
  .action(async () => {
    const { showMemory } = await import('hyperclaw/core');
    await showMemory();
    process.exit(0);
  });

memCmd.command('clear')
  .description('Clear all auto-extracted memories')
  .action(async () => {
    const { clearMemory } = await import('hyperclaw/core');
    await clearMemory();
    process.exit(0);
  });

memCmd.command('save <text>')
  .description('Manually save a fact to MEMORY.md')
  .action(async (text) => {
    const { saveMemoryDirect } = await import('hyperclaw/core');
    await saveMemoryDirect(text);
    console.log(chalk.hex('#06b6d4')(`  ✅ Saved: ${text}\n`));
    process.exit(0);
  });

// ─── PC ACCESS ────────────────────────────────────────────────────────────────

const pcCmd = program.command('pc').description('PC access — give the AI access to your computer');

pcCmd.command('status')
  .description('Show PC access status and config')
  .action(async () => {
    const { showPCAccessStatus } = await import('hyperclaw/core');
    await showPCAccessStatus();
    process.exit(0);
  });

pcCmd.command('enable')
  .description('Enable PC access for the AI')
  .option('--level <level>', 'Access level: read-only | sandboxed | full', 'full')
  .option('--paths <paths>', 'Comma-separated allowed paths (sandboxed mode)')
  .action(async (opts) => {
    const { savePCAccessConfig } = await import('hyperclaw/core');
    const level = opts.level as 'read-only' | 'sandboxed' | 'full';
    const allowed = ['read-only', 'sandboxed', 'full'];
    if (!allowed.includes(level)) {
      console.log(chalk.red(`\n  ✖  Invalid level: ${level}. Use: read-only, sandboxed, full\n`));
      process.exit(1);
    }
    const paths = opts.paths ? opts.paths.split(',').map((p: string) => p.trim()) : [require('os').homedir()];
    await savePCAccessConfig({ enabled: true, level, allowedPaths: paths });

    const icon = level === 'full' ? chalk.red('🔓 FULL') : level === 'sandboxed' ? chalk.yellow('🔒 SANDBOXED') : chalk.hex('#06b6d4')('👁  READ-ONLY');
    console.log(chalk.hex('#06b6d4')(`\n  ✅ PC access enabled: ${icon}`));
    if (level === 'full') {
      console.log(chalk.yellow('  ⚠  Full access: AI can run any command and write any file.'));
      console.log(chalk.yellow('     All actions are logged to ~/.hyperclaw/pc-access.log'));
    }
    console.log();
    process.exit(0);
  });

pcCmd.command('disable')
  .description('Disable PC access')
  .action(async () => {
    const { savePCAccessConfig } = await import('hyperclaw/core');
    await savePCAccessConfig({ enabled: false });
    console.log(chalk.hex('#06b6d4')('\n  ✅ PC access disabled\n'));
    process.exit(0);
  });

pcCmd.command('log')
  .description('Show PC access audit log')
  .option('-n, --lines <n>', 'Number of lines', '50')
  .action(async (opts) => {
    const logFile = require('path').join(require('os').homedir(), '.hyperclaw', 'pc-access.log');
    const fs2 = require('fs-extra');
    if (!(await fs2.pathExists(logFile))) {
      console.log(chalk.gray('\n  No PC access log yet\n'));
      process.exit(0);
    }
    const content = await fs2.readFile(logFile, 'utf8');
    const lines = content.trim().split('\n');
    const n = parseInt(opts.lines);
    const recent = lines.slice(-n);
    console.log(chalk.bold.hex('#06b6d4')('\n  💻 PC ACCESS LOG\n'));
    for (const line of recent) {
      if (line.includes('WRITE_FILE') || line.includes('RUN_SHELL')) {
        console.log(chalk.yellow(`  ${line}`));
      } else if (line.includes('DESTRUCTIVE')) {
        console.log(chalk.red(`  ${line}`));
      } else {
        console.log(chalk.gray(`  ${line}`));
      }
    }
    console.log();
    process.exit(0);
  });

pcCmd.command('run <command>')
  .description('Run a shell command via PC access (must be enabled)')
  .action(async (command) => {
    const { loadPCAccessConfig, getPCAccessTools } = await import('hyperclaw/core');
    const cfg = await loadPCAccessConfig();
    if (!cfg.enabled) {
      console.log(chalk.red('\n  ✖  PC access disabled. Run: hyperclaw pc enable\n'));
      process.exit(1);
    }
    const tools = getPCAccessTools();
    const shell = tools.find(t => t.name === 'run_shell');
    if (!shell) { process.exit(1); }
    const result = await shell.handler({ command });
    console.log(result);
    process.exit(0);
  });

// ─── UPDATE CHECK (non-blocking, fires and forgets) ──────────────────────────

function checkForUpdate(): void {
  const { execFile } = require('child_process');
  const { readFileSync } = require('fs');
  const path = require('path');
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const current: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
    execFile('npm', ['view', 'hyperclaw', 'version', '--json'], { timeout: 5000 },
      (_err: unknown, stdout: string) => {
        if (_err || !stdout) return;
        try {
          const latest: string = JSON.parse(stdout.trim());
          if (latest && latest !== current) {
            const semver = (v: string) => v.split('.').map(Number);
            const [lMaj, lMin, lPat] = semver(latest);
            const [cMaj, cMin, cPat] = semver(current);
            const isNewer = lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat);
            if (isNewer) {
              process.stdout.write(
                chalk.yellow(`\n  ⬆  Update available: ${chalk.dim(current)} → ${chalk.green(latest)}\n`) +
                chalk.gray(`     npm install -g hyperclaw@latest\n\n`)
              );
            }
          }
        } catch { /* ignore parse errors */ }
      }
    );
  } catch { /* ignore fs errors */ }
}

checkForUpdate();

// ─── PARSE (single entry point at the very end) ──────────────────────────────

if (process.argv.length === 2) {
  // No command given → auto-launch onboard wizard (first-run UX)
  (async () => {
    const { ConfigManager } = await import('../config/manager');
    const cfg = await (new ConfigManager()).load().catch(() => null);
    if (cfg?.provider?.apiKey || cfg?.provider?.providerId) {
      // Already configured → show banner + status overview
      await (new Banner()).showNeonBanner(false);
      const { getTheme } = await import('../infra/theme');
      const t = getTheme(false);
      const chalk = require('chalk');
      console.log(t.bold('  Quick actions:\n'));
      console.log(`  ${t.c('hyperclaw onboard')}                    — re-run setup wizard`);
      console.log(`  ${t.c('hyperclaw onboard --install-daemon')}   — wizard + daemon (full PC access)`);
      console.log(`  ${t.c('hyperclaw daemon start')}               — start background service`);
      console.log(`  ${t.c('hyperclaw daemon stop')}                — stop background service`);
      console.log(`  ${t.c('hyperclaw daemon status')}              — service status`);
      console.log(`  ${t.c('hyperclaw gateway start')}              — start gateway (foreground)`);
      console.log(`  ${t.c('hyperclaw status')}                     — system overview`);
      console.log(`  ${t.c('hyperclaw --help')}                     — all commands\n`);
    } else {
      // First run → launch wizard automatically
      await (new Banner()).showNeonBanner(false);
      const { HyperClawWizard } = await import('./onboard');
      await (new HyperClawWizard()).run({ wizard: true });
    }
    process.exit(0);
  })();
} else {
  program.parseAsync(process.argv).then(() => {
    setTimeout(() => process.exit(0), 500);
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
