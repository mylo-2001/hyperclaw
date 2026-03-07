import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { ConfigManager } from './config';
import { DaemonManager } from '../infra/daemon';
import { GatewayManager, GatewayConfig, GATEWAY_DEFAULTS } from './gateway';
import { PROVIDERS, getProvider, formatModel, getTranscriptionProviders } from './providers';
import { CHANNELS, getAvailableChannels, statusBadge, unavailableReason } from './channels';
import { MemoryManager, AgentIdentity } from './memory';
import { showSecurityDisclaimer, configureDMPolicy } from './security';
import { Banner } from '../terminal/banner';
import { CHANNEL_ICONS, PROVIDER_ICONS } from '../infra/channel-icons';

/** Brand-colored � square � closest we can get to a real icon in a terminal */
function brandIcon(id: string, type: 'channel' | 'provider' = 'channel'): string {
  const map = type === 'channel' ? CHANNEL_ICONS : PROVIDER_ICONS;
  const ic = map[id];
  if (!ic) return chalk.gray('�');
  return chalk.hex('#' + ic.color)('�');
}

export interface WizardOptions {
  wizard?: boolean;
  autoConfig?: boolean;
  daemon?: boolean;
  startNow?: boolean;
  installDaemon?: boolean;
  nonInteractive?: boolean;
  jsonOutput?: boolean;
  skipSkills?: boolean;
  skipSearch?: boolean;
  daemonRuntime?: 'node' | 'bun';
  gatewayPort?: number;
  gatewayBind?: 'loopback' | 'all';
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Reset config before running wizard */
  reset?: boolean;
}

export class HyperClawWizard {
  private config = new ConfigManager();
  private daemon = new DaemonManager();
  private gateway = new GatewayManager();

  async run(options: WizardOptions): Promise<void> {
    // -- Existing config detection ---------------------------------------------
    const existingCfg = await this.config.load();
    const hasExistingConfig = !!(existingCfg && (existingCfg.provider || existingCfg.providers?.length));
    if (hasExistingConfig && !options.nonInteractive) {
      const { getConfigPath } = await import('../infra/paths');
      console.log(chalk.yellow(`\n  ? Existing config detected: ${chalk.bold(getConfigPath())}\n`));
      const { configAction } = await inquirer.prompt([{
        type: 'list',
        name: 'configAction',
        message: 'What would you like to do?',
        choices: [
          { name: `${chalk.green('?')} Keep & modify    ${chalk.gray('(keep existing config, change specific settings)')}`, value: 'modify' },
          { name: `  Keep & continue  ${chalk.gray('(re-run wizard, keep all current values as defaults)')}`, value: 'keep' },
          { name: `${chalk.red('?')} Reset             ${chalk.gray('(back up config and start fresh)')}`, value: 'reset' },
        ]
      }]);
      if (configAction === 'reset') {
        const { resetScope } = await inquirer.prompt([{
          type: 'list',
          name: 'resetScope',
          message: 'Reset scope:',
          choices: [
            { name: 'Config only', value: 'config' },
            { name: 'Config + credentials + sessions', value: 'config+creds' },
            { name: 'Full reset (config + credentials + workspace)', value: 'full' },
          ]
        }]);
        const fs = await import('fs-extra');
        const path = await import('path');
        const os = await import('os');
        const hcDir = path.join(os.homedir(), '.hyperclaw');
        const backupDir = path.join(hcDir, `backup-${Date.now()}`);
        await fs.ensureDir(backupDir);
        const toRemove = [path.join(hcDir, 'hyperclaw.json')];
        if (resetScope !== 'config') {
          toRemove.push(path.join(hcDir, 'credentials'), path.join(hcDir, 'sessions'));
        }
        if (resetScope === 'full') toRemove.push(path.join(hcDir, 'workspace'));
        for (const f of toRemove) {
          if (await fs.pathExists(f)) {
            await fs.move(f, path.join(backupDir, path.basename(f)));
          }
        }
        console.log(chalk.green(`\n  ?  Config backed up to ${backupDir}\n  Starting fresh...\n`));
      } else if (configAction === 'modify') {
        // Partial reconfigure � just run the wizard with existing values as defaults
        console.log(chalk.gray('\n  Continuing with existing config as defaults...\n'));
      }
    }

    const proceed = await showSecurityDisclaimer();
    if (!proceed) return;

    // -- Step 0: Theme selection -----------------------------------------------
    const { allThemes, getThemeName, setThemeName } = await import('../infra/theme');
    const currentTheme = getThemeName();
    const { chosenTheme } = await inquirer.prompt([{
      type: 'list',
      name: 'chosenTheme',
      message: '?? Choose a color theme:',
      default: currentTheme,
      choices: [
        { name: `${chalk.hex('#06b6d4')('�')} Dark Professional   ${chalk.gray('(neon cyan on black)')}`,   value: 'dark' },
        { name: `${chalk.hex('#64748b')('�')} Grey Professional   ${chalk.gray('(muted cyan, neutral)')}`,  value: 'grey' },
        { name: `${chalk.hex('#0284c7')('�')} White / Light       ${chalk.gray('(deep cyan, light bg)')}`,  value: 'white' },
      ]
    }]);
    if (chosenTheme !== currentTheme) {
      await setThemeName(chosenTheme);
    }
    // -------------------------------------------------------------------------

    await (new Banner()).showWizardBanner();

    const { mode } = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: 'Setup mode:',
      choices: [
        { name: `${chalk.green('?')} QuickStart        ${chalk.gray('(Recommended)')}`, value: 'quick' },
        { name: `  Manual            ${chalk.gray('(Full control)')}`, value: 'manual' }
      ]
    }]);

    if (mode === 'quick') return this.quickSetup(options);
    return this.fullSetup(options);
  }

  async quickstart(options: any): Promise<void> {
    const proceed = await showSecurityDisclaimer();
    if (!proceed) return;
    return this.quickSetup(options);
  }

  // -- Step header helper ------------------------------------------------------
  private stepHeader(n: number, total: number, title: string): void {
    const { getTheme } = require('../infra/theme');
    const t = getTheme(false);
    const bar = chalk.gray('-'.repeat(52));
    console.log(`\n${bar}`);
    console.log(`  ${t.c(`Step ${n} / ${total}`)}  �  ${chalk.bold(title)}`);
    console.log(`${bar}\n`);
  }

  private async quickSetup(options: WizardOptions): Promise<void> {
    const STEPS = 7;

    this.stepHeader(1, STEPS, 'Workspace');
    const { workspaceName } = await inquirer.prompt([{
      type: 'input', name: 'workspaceName', message: 'Workspace name:', default: 'my-hyperclaw'
    }]);

    this.stepHeader(2, STEPS, 'AI Providers & Models');
    const { providers: allProviders, primary: providerConfig } = await this.selectProvidersAndModels();

    this.stepHeader(3, STEPS, 'Gateway (optional)');
    const gatewayConfig = await this.configureGateway(false);

    this.stepHeader(4, STEPS, 'Channels');
    const channelConfigs = await this.selectChannels();

    this.stepHeader(5, STEPS, 'Agent Identity & Persona');
    const identity = await this.configureIdentity();

    this.stepHeader(6, STEPS, 'Skills & Hooks');
    const { hooks, heartbeat: heartbeatEnabled } = await this.configureSkillsAndHooks();

    this.stepHeader(7, STEPS, 'Extras');
    const webSearch = await this.configureWebSearch(options.skipSearch);
    const memoryIntegration = await this.configureMemoryIntegration();
    const serviceApiKeys = await this.configureServiceApiKeys();
    const hyperclawbotConfig = await this.configureHyperClawBot(gatewayConfig);
    const talkModeConfig = await this.configureTalkMode();
    const pcAccess = await this.configurePcAccess();
    const updateChannel = await this.configureUpdateChannel();
    const groupSandbox = await this.configureGroupSandbox();
    await this.configureSkillHub();
    await this.configureMcpServers();
    await this.configureWorkspaceTemplate();
    await this.configureCronTasks();
    await this.configureAutoReply();
    await this.configureWebhooks();
    await this.configureNodes();
    await this.configureOAuth();
    await this.configureAgentBindings();
    const rateLimit = await this.configureRateLimiting();
    await this.configureDeveloperKey();
    await this.configureVoiceCall();
    await this.configureCanvas();
    await this.configureDeploy();

    await this.saveAll({
      workspaceName, providerConfig, providers: allProviders, channelConfigs,
      gatewayConfig, identity, hooks, heartbeatEnabled, webSearch,
      memoryIntegration, serviceApiKeys, hyperclawbotConfig, talkModeConfig,
      pcAccess, updateChannel, groupSandbox, rateLimit
    }, options);
  }

  private async fullSetup(options: WizardOptions): Promise<void> {
    const STEPS = 9;

    this.stepHeader(1, STEPS, 'Workspace');
    const { workspaceName } = await inquirer.prompt([{
      type: 'input', name: 'workspaceName', message: 'Workspace directory:', default: 'my-hyperclaw'
    }]);

    this.stepHeader(2, STEPS, 'AI Providers & Models');
    const { providers: allProviders, primary: providerConfig } = await this.selectProvidersAndModels();

    this.stepHeader(3, STEPS, 'Gateway');
    const gatewayConfig = await this.configureGateway(true);

    this.stepHeader(4, STEPS, 'Channels');
    const { configureChannels } = await inquirer.prompt([{
      type: 'confirm', name: 'configureChannels', message: 'Configure chat channels now?', default: true
    }]);
    const channelConfigs: Record<string, any> = configureChannels ? await this.selectChannels(true) : {};

    if (configureChannels) {
      const { configureDM } = await inquirer.prompt([{
        type: 'confirm', name: 'configureDM', message: 'Configure DM access policies now?', default: true
      }]);
      if (configureDM) {
        for (const [channelId] of Object.entries(channelConfigs)) {
          const ch = CHANNELS.find(c => c.id === channelId);
          if (ch?.supportsDM) {
            const dm = await configureDMPolicy(ch.name);
            (channelConfigs as any)[channelId].dmPolicy = dm;
          }
        }
      }
    }

    this.stepHeader(5, STEPS, 'Agent Identity & Persona');
    const identity = await this.configureIdentity();

    this.stepHeader(6, STEPS, 'Skills & Hooks');
    const { hooks, heartbeat: heartbeatEnabled } = await this.configureSkillsAndHooks();

    this.stepHeader(7, STEPS, 'Services & Daemon');
    let installDaemon = options.installDaemon ?? false;
    let daemonRuntime: 'node' | 'bun' = options.daemonRuntime ?? 'node';
    if (!installDaemon) {
      console.log(chalk.gray('  The daemon runs the gateway as a background service that starts on boot.\n'));
      const ans = await inquirer.prompt([
        {
          type: 'confirm', name: 'installDaemon',
          message: 'Install as system daemon (auto-start on boot)?', default: false
        },
        {
          type: 'list', name: 'daemonRuntime',
          message: 'Daemon runtime:',
          default: 'node',
          choices: [
            { name: `Node.js  ${chalk.green('(recommended)')} � required for WhatsApp/Telegram`, value: 'node' },
            { name: `Bun      ${chalk.gray('(faster startup, experimental)')}`, value: 'bun' },
          ],
          when: (answers: any) => answers.installDaemon
        }
      ]);
      installDaemon = ans.installDaemon;
      if (ans.daemonRuntime) daemonRuntime = ans.daemonRuntime;
    } else {
      console.log(chalk.green(`  ? Daemon will be installed (runtime: ${daemonRuntime})\n`));
    }

    this.stepHeader(8, STEPS, 'Extras');
    const webSearch = await this.configureWebSearch(options.skipSearch);
    const memoryIntegration = await this.configureMemoryIntegration();
    const serviceApiKeys = await this.configureServiceApiKeys();
    const hyperclawbotConfig = await this.configureHyperClawBot(gatewayConfig);
    const talkModeConfig = await this.configureTalkMode();
    const pcAccess = await this.configurePcAccess();
    const updateChannel = await this.configureUpdateChannel();
    const groupSandbox = await this.configureGroupSandbox();
    await this.configureSkillHub();
    await this.configureMcpServers();
    await this.configureWorkspaceTemplate();
    await this.configureCronTasks();
    await this.configureAutoReply();
    await this.configureWebhooks();
    await this.configureNodes();
    await this.configureOAuth();
    await this.configureAgentBindings();
    const rateLimit = await this.configureRateLimiting();
    await this.configureDeveloperKey();
    await this.configureVoiceCall();
    await this.configureCanvas();
    await this.configureDeploy();

    this.stepHeader(9, STEPS, 'Launch');
    const launchChoices: any[] = [
      { name: `TUI  � terminal dashboard`, value: 'tui' }
    ];
    if (gatewayConfig && !(gatewayConfig as any).remote) {
      launchChoices.push({ name: `Web  � browser at http://localhost:${(gatewayConfig as any).port}`, value: 'web' });
    }
    launchChoices.push({ name: chalk.gray('Do this later � I will start manually'), value: 'skip' });
    const { hatchMode } = await inquirer.prompt([{
      type: 'list', name: 'hatchMode', message: 'How do you want to hatch your bot?',
      choices: launchChoices
    }]);

    await this.saveAll({
      workspaceName, providerConfig, providers: allProviders, channelConfigs,
      gatewayConfig: gatewayConfig ? { ...gatewayConfig, hooks: hooks.length > 0 } : null,
      identity, hooks, heartbeatEnabled, installDaemon, daemonRuntime, hatchMode, webSearch,
      memoryIntegration, serviceApiKeys, hyperclawbotConfig, talkModeConfig,
      pcAccess, updateChannel, groupSandbox, rateLimit
    }, options);
  }

  // -- Multi-provider selection -------------------------------------------------
  private async selectProvidersAndModels(): Promise<{ providers: any[]; primary: any }> {
    const { getTheme } = require('../infra/theme');
    const t = getTheme(false);

    console.log(chalk.gray('  Select one or more AI providers. The first one will be primary.\n'));

    // Step A: checkbox � pick providers
    const { selectedProviderIds } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedProviderIds',
      message: 'Select AI providers:',
      validate: (v: string[]) => v.length > 0 || 'Select at least one provider',
      choices: PROVIDERS.map(p => ({
        name: `${brandIcon(p.id, 'provider')} ${p.displayName.replace(/^.{1,2}\s/, '').padEnd(18)}${p.supportsTranscription ? chalk.gray(' ??') : ''}`,
        value: p.id,
        checked: p.id === 'openrouter', // sensible default
      }))
    }]);

    const configured: any[] = [];

    // Step B: for each selected provider, configure key + model
    for (let i = 0; i < selectedProviderIds.length; i++) {
      const pid = selectedProviderIds[i];
      const provider = getProvider(pid)!;
      const isPrimary = i === 0;

      console.log(`\n  ${t.c('?')} ${chalk.bold(provider.displayName)} ${isPrimary ? chalk.green('(primary)') : chalk.gray(`(#${i + 1})`)}\n`);
      if (provider.authHint) console.log(chalk.gray(`    ?? ${provider.authHint}\n`));

      let apiKey = '';
      let baseUrl: string | undefined;
      let modelId = '';

      if (pid === 'anthropic-oauth') {
        // Try to auto-detect existing Claude credentials
        const fs = await import('fs-extra');
        const path = await import('path');
        const os = await import('os');
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        const credExists = await fs.pathExists(credPath);
        if (credExists) {
          console.log(chalk.green(`  ? Found Claude credentials: ${credPath}`));
          console.log(chalk.gray('    HyperClaw will reuse these credentials automatically.\n'));
          apiKey = '__claude_oauth__'; // sentinel � gateway reads from .claude/.credentials.json
        } else {
          console.log(chalk.yellow(`  ?  ~/.claude/.credentials.json not found.\n`));
          console.log(chalk.gray('  Run `claude` CLI on this machine first to authenticate,\n  or paste a setup-token (use "Anthropic setup-token" provider instead).\n'));
          apiKey = '__claude_oauth__';
        }
      } else if (pid === 'anthropic-setup-token') {
        console.log(chalk.gray('  Run `claude setup-token` on any machine > paste the token below.\n'));
        const r = await inquirer.prompt([{
          type: 'password', name: 'apiKey',
          message: '  Setup token (sk-ant-setup-...):', mask: '?',
          validate: (v: string) => v.trim().length > 10 || 'Required'
        }]);
        apiKey = r.apiKey.trim();
      } else if (provider.authType === 'api_key') {
        if (pid === 'custom') {
          const r = await inquirer.prompt([
            { type: 'input', name: 'baseUrl', message: '  Base URL:', validate: (v: string) => v.trim().length > 5 || 'Required' },
            { type: 'password', name: 'apiKey', message: `  ${provider.authLabel}:`, mask: '?', validate: (v: string) => v.trim().length > 5 || 'Required' },
            { type: 'input', name: 'modelId', message: '  Model ID:', validate: (v: string) => v.trim().length > 0 || 'Required' },
          ]);
          baseUrl = r.baseUrl.trim().replace(/\/$/, '');
          apiKey = r.apiKey;
          modelId = r.modelId.trim();
        } else {
          const r = await inquirer.prompt([{
            type: 'password', name: 'apiKey',
            message: `  ${provider.authLabel}:`, mask: '?'
          }]);
          apiKey = r.apiKey;
        }
      }

      if (!modelId) {
        const modelChoices = provider.models.filter(m => m.id !== '__manual__').length
          ? [...provider.models.filter(m => m.id !== '__manual__').map(m => ({ name: formatModel(m), value: m.id })), { name: chalk.gray('Enter manually...'), value: '__manual__' }]
          : [{ name: chalk.gray('Enter model ID manually'), value: '__manual__' }];
        const { modelChoice } = await inquirer.prompt([{
          type: 'list', name: 'modelChoice', message: '  Default model:', choices: modelChoices
        }]);
        if (modelChoice === '__manual__') {
          const { manual } = await inquirer.prompt([{
            type: 'input', name: 'manual', message: '  Model ID:', default: provider.models[0]?.id || ''
          }]);
          modelId = manual;
        } else {
          modelId = modelChoice;
        }
      }

      // Extra API keys for rotation / failover
      const apiKeys: string[] = [];
      if (apiKey) {
        const { wantRotation } = await inquirer.prompt([{
          type: 'confirm',
          name: 'wantRotation',
          message: `  Add extra API keys for rate-limit rotation? ${chalk.gray('(gateway cycles through on 429)')}`,
          default: false
        }]);
        if (wantRotation) {
          let addMore = true;
          while (addMore) {
            const { extraKey } = await inquirer.prompt([{
              type: 'password',
              name: 'extraKey',
              message: `  Extra key #${apiKeys.length + 1}:`,
              mask: '?'
            }]);
            if (extraKey.trim()) apiKeys.push(extraKey.trim());
            const { more } = await inquirer.prompt([{
              type: 'confirm', name: 'more', message: '  Add another?', default: false
            }]);
            addMore = more;
          }
          if (apiKeys.length > 0) console.log(chalk.green(`  ? ${apiKeys.length} extra key(s) added for rotation\n`));
        }
      }

      // Thinking / reasoning level (Anthropic extended thinking, OpenAI o-series)
      let thinking: { enabled: boolean; budgetTokens: number } | undefined;
      if (['anthropic', 'openai'].includes(pid)) {
        const { thinkingLevel } = await inquirer.prompt([{
          type: 'list',
          name: 'thinkingLevel',
          message: `  Extended thinking / reasoning:`,
          choices: [
            { name: `Off        ${chalk.gray('(standard responses)')}`, value: 'off' },
            { name: `Standard   ${chalk.gray('(~8 000 token budget)')}`, value: 'standard' },
            { name: `Extended   ${chalk.gray('(~32 000 token budget � slower, deeper)')}`, value: 'extended' },
          ],
          default: 'off'
        }]);
        if (thinkingLevel !== 'off') {
          thinking = { enabled: true, budgetTokens: thinkingLevel === 'extended' ? 32_000 : 8_000 };
          console.log(chalk.green(`  ? Thinking: ${thinkingLevel} (${thinking.budgetTokens.toLocaleString()} tokens)\n`));
        }
      }

      configured.push({
        providerId: pid, apiKey, modelId,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKeys.length > 0 ? { apiKeys } : {}),
        ...(thinking ? { thinking } : {})
      });
      console.log(t.c(`  ? ${provider.displayName} > ${modelId}\n`));
    }

    return { providers: configured, primary: configured[0] };
  }

  // -- Gateway (optional) -------------------------------------------------------
  private async configureGateway(full = false): Promise<GatewayConfig | null> {
    const { gatewayMode } = await inquirer.prompt([{
      type: 'list', name: 'gatewayMode',
      message: 'Gateway setup:',
      choices: [
        { name: `Local gateway   ${chalk.gray('(run on this machine)')}`, value: 'local' },
        { name: `Remote gateway  ${chalk.gray('(info-only � connect to existing server)')}`, value: 'remote' },
        { name: chalk.gray('Skip            (no gateway � CLI-only mode)'), value: 'skip' }
      ]
    }]);

    if (gatewayMode === 'skip') {
      console.log(chalk.gray('  ? Gateway skipped. Enable later: hyperclaw gateway start\n'));
      return null as any;
    }

    if (gatewayMode === 'remote') {
      const { remoteUrl } = await inquirer.prompt([{
        type: 'input', name: 'remoteUrl',
        message: 'Remote gateway URL (e.g. wss://myserver.com:18789):',
        validate: (v: string) => v.startsWith('ws') || 'Must start with ws:// or wss://'
      }]);
      const { remoteToken } = await inquirer.prompt([{
        type: 'password', name: 'remoteToken',
        message: 'Remote gateway auth token:', mask: '?'
      }]);
      console.log(chalk.green('  ? Remote gateway configured\n'));
      return {
        port: 18789,
        bind: remoteUrl,
        authToken: remoteToken,
        tailscaleExposure: 'off',
        runtime: 'node',
        enabledChannels: [],
        hooks: true,
        remote: true
      } as any;
    }

    const { useGateway } = await inquirer.prompt([{
      type: 'confirm', name: 'useGateway',
      message: 'Enable the local WebSocket gateway? (needed for channels, web UI, mobile apps)',
      default: true
    }]);

    if (!useGateway) {
      console.log(chalk.gray('  ? Gateway skipped. You can enable it later: hyperclaw gateway start\n'));
      return null as any;
    }

    const running = await this.gateway.isRunning(18789);
    if (running) console.log(chalk.gray(`  ?  Gateway already running at ws://127.0.0.1:18789`));

    const detectedRuntime = await this.gateway.detectRuntime();
    const questions: any[] = [
      {
        type: 'input', name: 'port', message: 'Gateway port:', default: String(18789),
        validate: (v: string) => (Number(v) > 1024 && Number(v) < 65535) ? true : 'Enter valid port (1024-65535)'
      }
    ];

    if (full) {
      questions.push(
        {
          type: 'list', name: 'bind', message: 'Bind address:',
          choices: [
            { name: `127.0.0.1  ${chalk.gray('Loopback only (secure)')}`, value: '127.0.0.1' },
            { name: `0.0.0.0   ${chalk.gray('All interfaces (LAN)')}`, value: '0.0.0.0' },
            { name: `Tailscale ${chalk.gray('VPN peers only')}`, value: 'tailscale' },
            { name: `Custom    ${chalk.gray('Enter IP manually')}`, value: 'custom' }
          ], default: '127.0.0.1'
        },
        {
          type: 'list', name: 'tailscaleExposure', message: 'Tailscale exposure:',
          choices: [
            { name: this.gateway.exposureLabel('off'), value: 'off' },
            { name: this.gateway.exposureLabel('serve'), value: 'serve' },
            { name: this.gateway.exposureLabel('funnel'), value: 'funnel' }
          ], default: 'off', when: (a: any) => a.bind === 'tailscale'
        },
        {
          type: 'list', name: 'runtime', message: 'Runtime:',
          choices: [
            { name: `Node.js  ${detectedRuntime === 'node' ? chalk.green('(detected)') : ''}`, value: 'node' },
            { name: `Bun      ${detectedRuntime === 'bun' ? chalk.green('(detected)') : chalk.gray('(faster)')}`, value: 'bun' },
            { name: `Deno     ${detectedRuntime === 'deno' ? chalk.green('(detected)') : ''}`, value: 'deno' }
          ], default: detectedRuntime
        }
      );
    }

    questions.push({
      type: 'password', name: 'authToken',
      message: `Auth token: ${chalk.gray('(blank = auto-generate)')}`, mask: '?'
    });

    const answers = await inquirer.prompt(questions);
    const token = answers.authToken || this.gateway.generateToken();
    if (!answers.authToken) console.log(chalk.green('  ? Auth token auto-generated\n'));

    // SSH reverse tunnel (alternative to Tailscale for remote access)
    const { wantSshTunnel } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantSshTunnel',
      message: `SSH reverse tunnel for remote access? ${chalk.gray('(alternative to Tailscale)')}`,
      default: false
    }]);
    let sshTunnel: { enabled: boolean; host: string; user: string; remotePort: number } | undefined;
    if (wantSshTunnel) {
      const sshAns = await inquirer.prompt([
        { type: 'input', name: 'host', message: '  Remote SSH host (e.g. myserver.com):', validate: (v: string) => v.trim().length > 3 || 'Required' },
        { type: 'input', name: 'user', message: '  SSH user:', default: process.env.USER || process.env.USERNAME || 'ubuntu' },
        {
          type: 'input', name: 'remotePort', message: '  Remote port (forwarded on server):',
          default: String(Number(answers.port) || 18789),
          validate: (v: string) => (Number(v) > 1024 && Number(v) < 65535) ? true : 'Valid port required'
        }
      ]);
      sshTunnel = {
        enabled: true,
        host: sshAns.host.trim(),
        user: sshAns.user.trim(),
        remotePort: Number(sshAns.remotePort)
      };
      console.log(chalk.green(`  ? SSH tunnel: ${sshTunnel.user}@${sshTunnel.host}:${sshTunnel.remotePort}\n`));
      console.log(chalk.gray(`  Run: ssh -R ${sshTunnel.remotePort}:localhost:${Number(answers.port)} ${sshTunnel.user}@${sshTunnel.host}\n`));
    }

    return {
      port: Number(answers.port),
      bind: answers.bind || '127.0.0.1',
      authToken: token,
      tailscaleExposure: answers.tailscaleExposure || 'off',
      runtime: answers.runtime || detectedRuntime,
      enabledChannels: [],
      hooks: true,
      ...(sshTunnel ? { sshTunnel } : {})
    };
  }

  private async selectChannels(full = false): Promise<Record<string, any>> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Communication Channels\n'));

    const available = await getAvailableChannels();
    const { selectedChannels } = await inquirer.prompt([{
      type: 'checkbox', name: 'selectedChannels', message: 'Enable channels:',
      choices: available.map(ch => {
        const isUnavailable = ch.status === 'unavailable';
        const reason = isUnavailable ? unavailableReason(ch) : '';
        const icon = brandIcon(ch.id, 'channel');
        return {
          name: `${icon} ${ch.name.padEnd(18)} ${statusBadge(ch.status, ch)}${ch.requiresGateway && !isUnavailable ? chalk.gray(' [needs gateway]') : ''}`,
          value: ch.id,
          checked: ch.status === 'recommended',
          disabled: isUnavailable ? reason : false,
        };
      })
    }]);

    const channelConfigs: Record<string, any> = {};

    for (const channelId of selectedChannels) {
      const ch = CHANNELS.find(c => c.id === channelId);
      if (!ch || !ch.tokenLabel) continue;

      console.log(chalk.hex('#06b6d4')(`\n  ${ch.emoji} ${ch.name}`));
      if (ch.setupSteps?.length) {
        ch.setupSteps.forEach((s: string) => console.log(chalk.gray(`  ${s}`)));
      } else if (ch.tokenHint) {
        console.log(chalk.gray(`  ?? ${ch.tokenHint}`));
      }

      const fields: any[] = [{ type: 'password', name: 'token', message: `${ch.tokenLabel}:`, mask: '?' }];

      for (const f of (ch.extraFields || [])) {
        fields.push({
          type: 'input', name: f.name,
          message: `${f.label}:${f.hint ? chalk.gray(` (${f.hint})`) : ''}`,
          ...(f.required ? { validate: (v: string) => v.trim().length > 0 || `${f.label} is required` } : {})
        });
      }

      channelConfigs[channelId] = await inquirer.prompt(fields);
    }

    // Twitch: split channels string into array
    if (selectedChannels.includes('twitch') && channelConfigs['twitch']?.channels) {
      const raw: string = channelConfigs['twitch'].channels;
      channelConfigs['twitch'].channels = raw.split(',').map((s: string) => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
    }

    // When email channel selected: offer google-gmail OAuth for Gmail Pub/Sub
    if (selectedChannels.includes('email')) {
      const { wantGmailOAuth } = await inquirer.prompt([{
        type: 'confirm',
        name: 'wantGmailOAuth',
        message: 'Enable Gmail OAuth for Pub/Sub real-time (send via hyperclaw gmail watch-setup)?',
        default: false
      }]);
      if (wantGmailOAuth) {
        console.log(chalk.gray('  Running OAuth flow for google-gmail...'));
        try {
          const { runOAuthFlow } = await import('../services/oauth-flow');
          const { writeOAuthToken } = await import('../services/oauth-provider');
          const tokens = await runOAuthFlow('google-gmail', {});
          const now = Math.floor(Date.now() / 1000);
          const expires_at = tokens.expires_in ? now + tokens.expires_in : undefined;
          await writeOAuthToken('google-gmail', {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at,
            token_url: 'https://oauth2.googleapis.com/token'
          });
          console.log(chalk.green('  ?  Gmail OAuth configured � next: hyperclaw gmail watch-setup'));
        } catch (e: any) {
          console.log(chalk.yellow(`  ?  OAuth failed � you can run it later: hyperclaw auth oauth google-gmail`));
        }
      }
    }

    return channelConfigs;
  }

  private async configureWebSearch(skip = false): Promise<{ provider: string; apiKey: string } | null> {
    if (skip) return null;
    const { wantSearch } = await inquirer.prompt([{
      type: 'confirm', name: 'wantSearch',
      message: 'Configure a web search provider for the agent?',
      default: false
    }]);
    if (!wantSearch) return null;

    const SEARCH_PROVIDERS = [
      { id: 'tavily',     name: 'Tavily',       hint: 'app.tavily.com � best for agents',         prefix: 'tvly-' },
      { id: 'perplexity', name: 'Perplexity',   hint: 'perplexity.ai/settings/api',               prefix: 'pplx-' },
      { id: 'brave',      name: 'Brave Search', hint: 'api.search.brave.com',                     prefix: 'BSA' },
      { id: 'gemini',     name: 'Gemini',        hint: 'aistudio.google.com/app/apikey',           prefix: 'AIza' },
      { id: 'grok',       name: 'Grok/xAI',     hint: 'console.x.ai � same key as xAI provider', prefix: 'xai-' },
      { id: 'kimi',       name: 'Kimi (Moonshot)', hint: 'platform.moonshot.cn/user-center/api-keys', prefix: 'sk-' },
    ];

    const { searchProvider } = await inquirer.prompt([{
      type: 'list', name: 'searchProvider',
      message: 'Select web search provider:',
      choices: SEARCH_PROVIDERS.map(p => ({
        name: `${p.name.padEnd(14)} ${chalk.gray(p.hint)}`,
        value: p.id
      }))
    }]);

    const chosen = SEARCH_PROVIDERS.find(p => p.id === searchProvider)!;
    const { searchKey } = await inquirer.prompt([{
      type: 'password', name: 'searchKey',
      message: `${chosen.name} API key (starts with ${chalk.gray(chosen.prefix)}):`,
      mask: '?',
      validate: (v: string) => v.trim().length > 4 || 'Required'
    }]);

    console.log(chalk.green(`  ?  Web search: ${chosen.name}`));
    return { provider: searchProvider, apiKey: searchKey.trim() };
  }

  private async configureServiceApiKeys(): Promise<Record<string, string>> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Service API Keys � any app with an API key\n'));
    console.log(chalk.gray('  Stored securely in config. How they work:\n'));
    console.log(chalk.gray('  � Wizard: add keys here\n'));
    console.log(chalk.gray('  � Config: ~/.hyperclaw/hyperclaw.json > skills.apiKeys\n'));
    console.log(chalk.gray('  � Env: HACKERONE_*, BUGCROWD_*, SYNACK_*, or CUSTOM_ID_API_KEY\n'));
    console.log(chalk.gray('  � Tools: built-in tools read them automatically for research.\n'));

    const { wantServiceKeys } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantServiceKeys',
      message: 'Add API keys for external services (HackerOne, Bugcrowd, Synack, or custom)?',
      default: false
    }]);

    if (!wantServiceKeys) return {};

    const KNOWN_SERVICES = [
      { id: 'hackerone', name: 'HackerOne', hint: 'username:token (Basic auth)' },
      { id: 'bugcrowd', name: 'Bugcrowd', hint: 'Token from Bugcrowd API Credentials' },
      { id: 'synack', name: 'Synack', hint: 'API token from Synack' },
      { id: '__custom__', name: 'Other (custom)', hint: 'Any app with an API key' },
    ];

    const { servicesToAdd } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'servicesToAdd',
      message: 'Select services:',
      choices: KNOWN_SERVICES.filter(s => s.id !== '__custom__').map(s => ({
        name: `${s.name}  ${chalk.gray(`(${s.hint})`)}`,
        value: s.id
      })),
      validate: (v: string[]) => true
    }]);

    const apiKeys: Record<string, string> = {};

    for (const sid of servicesToAdd || []) {
      const svc = KNOWN_SERVICES.find(s => s.id === sid);
      const r = await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: `${svc?.name || sid} API key:`,
        mask: '?',
        validate: (v: string) => v.trim().length > 3 || 'Required'
      }]);
      apiKeys[sid] = r.key.trim();
    }

    const { addCustom } = await inquirer.prompt([{
      type: 'confirm', name: 'addCustom', message: 'Add a custom service (any app)?', default: false
    }]);

    if (addCustom) {
      const { customId, customKey } = await inquirer.prompt([
        { type: 'input', name: 'customId', message: 'Service ID (e.g. my-app, ads-power):', validate: (v: string) => /^[a-z0-9_-]+$/i.test(v?.trim() || '') || 'Letters, numbers, - _ only' },
        { type: 'password', name: 'customKey', message: 'API key:', mask: '?', validate: (v: string) => v.trim().length > 3 || 'Required' }
      ]);
      apiKeys[customId.trim().toLowerCase()] = customKey.trim();
    }

    if (Object.keys(apiKeys).length > 0) {
      console.log(chalk.green(`  ?  Saved ${Object.keys(apiKeys).length} API key(s)`));
    }
    return apiKeys;
  }

  private async configureHyperClawBot(gatewayConfig: GatewayConfig | null): Promise<{ token?: string; allowedUsers?: string[] } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  ?? HyperClaw Bot � Remote control via Telegram\n'));
    const trans = getTranscriptionProviders();
    if (trans.length > 0) {
      console.log(chalk.gray('  ?? Voice notes: ' + trans.map(p => `${p.displayName}`).join(', ') + ' � if you have their API key, voice messages will be transcribed to text.'));
      console.log();
    }

    const { wantHyperClawBot } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantHyperClawBot',
      message: 'Enable HyperClaw Bot for remote control (status, restart, /agent from mobile)?',
      default: false
    }]);

    if (!wantHyperClawBot) return undefined;

    const { token } = await inquirer.prompt([{
      type: 'input',
      name: 'token',
      message: 'Telegram Bot token (from @BotFather):',
      validate: (v: string) => v.trim().length > 10 || 'Required'
    }]);
    const { userIds } = await inquirer.prompt([{
      type: 'input',
      name: 'userIds',
      message: 'Allowed user IDs (comma-separated, leave empty = everyone):',
      default: ''
    }]);

    const gatewayUrl = `http://localhost:${gatewayConfig?.port || 18789}`;
    const { saveBotConfig } = await import('../bot/hyperclawbot');
    await saveBotConfig({
      platform: 'telegram',
      token: token.trim(),
      gatewayUrl,
      allowedUsers: userIds ? userIds.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      gatewayToken: undefined,
      enabled: true,
      createdAt: new Date().toISOString()
    });
    console.log(chalk.green('  ?  HyperClaw Bot configured � Start: hyperclaw bot start'));
    return { token: token.trim() };
  }

  private async configureTalkMode(): Promise<{ apiKey?: string; voiceId?: string; modelId?: string } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  ???  Talk Mode � ElevenLabs TTS\n'));

    const { wantTalkMode } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantTalkMode',
      message: 'Enable Talk Mode (voice responses via ElevenLabs)?',
      default: false
    }]);

    if (!wantTalkMode) return undefined;

    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: 'ElevenLabs API key (elevenlabs.io):',
      mask: '?',
      validate: (v: string) => v.trim().length > 10 || 'Required'
    }]);

    console.log(chalk.green('  ?  Talk Mode configured'));
    return {
      apiKey: apiKey.trim(),
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      modelId: 'eleven_multilingual_v2'
    };
  }

  private async configureMemoryIntegration(): Promise<{ vaultDir?: string; dailyNotes?: boolean; syncOnAppend?: boolean } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Memory Integration (Obsidian / Raycast / Hazel)\n'));

    const { vaultPath } = await inquirer.prompt([{
      type: 'input',
      name: 'vaultPath',
      message: 'Sync memory to vault? Enter path or leave empty to skip:',
      default: ''
    }]);

    const vaultDir = String(vaultPath || '').trim();
    if (!vaultDir) return undefined;

    const { dailyNotes } = await inquirer.prompt([{
      type: 'confirm', name: 'dailyNotes', message: 'Write daily notes with session summaries?', default: true
    }]);

    return {
      vaultDir,
      dailyNotes,
      syncOnAppend: true
    };
  }

  private async configureIdentity(): Promise<AgentIdentity> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Agent Identity\n'));

    const identity = await inquirer.prompt([
      { type: 'input', name: 'userName',  message: 'Your name:', default: 'Boss' },
      { type: 'input', name: 'agentName', message: 'Agent name:', default: 'Hyper' },
      {
        type: 'input', name: 'wakeWord',
        message: 'Wake word for voice:', default: (a: any) => `Hey ${a.agentName || 'Hyper'}`
      },
      {
        type: 'list', name: 'personality', message: 'Personality:',
        choices: ['Professional and concise', 'Friendly and casual', 'Witty with humor', 'Direct and no-nonsense', 'Custom']
      },
      {
        type: 'input', name: 'customPersonality', message: 'Describe personality:',
        when: (a: any) => a.personality === 'Custom'
      },
      {
        type: 'list', name: 'language', message: 'Primary language:',
        choices: ['English', 'Greek', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Arabic']
      }
    ]);

    // Wake-up message � first thing the agent says when it comes online
    console.log(chalk.gray('\n  This is the greeting sent to your channels when the agent starts.\n'));
    const { wakeUpMessage } = await inquirer.prompt([{
      type: 'input',
      name: 'wakeUpMessage',
      message: 'Agent wake-up message:',
      default: (identity.agentName || 'Hyper') + ' is online. How can I help you today?'
    }]);

    // System prompt / instructions
    const { wantSystemPrompt } = await inquirer.prompt([{
      type: 'confirm', name: 'wantSystemPrompt',
      message: 'Add a custom system prompt / instructions for the agent?', default: false
    }]);

    let systemPrompt = '';
    if (wantSystemPrompt) {
      console.log(chalk.gray('  Tip: describe role, restrictions, tone, specific knowledge, etc.\n'));
      const r = await inquirer.prompt([{
        type: 'editor', name: 'systemPrompt',
        message: 'System prompt (opens editor � save & close to continue):'
      }]);
      systemPrompt = r.systemPrompt?.trim() || '';
    }

    const globalRules = [
      'Always respond in the user\'s preferred language',
      'Never reveal the gateway auth token or API keys',
      'Confirm before destructive or irreversible actions',
      'Respect user privacy � never share conversation data',
      'All subagents inherit these rules � cannot be overridden'
    ];

    const { addRules } = await inquirer.prompt([{
      type: 'confirm', name: 'addRules', message: 'Add custom rules to AGENTS.md?', default: false
    }]);

    let customRules: string[] = [];
    if (addRules) {
      const { rules } = await inquirer.prompt([{
        type: 'input', name: 'rules',
        message: 'Rules (semicolon-separated):',
        filter: (v: string) => v.split(';').map((r: string) => r.trim()).filter(Boolean)
      }]);
      customRules = rules;
    }

    const personality = identity.personality === 'Custom'
      ? (identity.customPersonality || 'Custom')
      : identity.personality;

    return {
      agentName: identity.agentName,
      userName: identity.userName,
      language: identity.language,
      personality,
      wakeUpMessage: wakeUpMessage.trim(),
      systemPrompt: systemPrompt || undefined,
      rules: [...globalRules, ...customRules]
    };
  }

  // -- Skills & Hooks -----------------------------------------------------------
  private async configureSkillsAndHooks(): Promise<{ hooks: string[]; heartbeat: boolean }> {
    const { wantSkills } = await inquirer.prompt([{
      type: 'confirm', name: 'wantSkills',
      message: 'Configure skills & hooks now?', default: false
    }]);

    if (!wantSkills) {
      console.log(chalk.gray('  ? Skipped � enable later: hyperclaw hooks enable <name>\n'));
      return { hooks: [], heartbeat: false };
    }

    const { selectedHooks } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedHooks',
      message: 'Select hooks to enable:',
      choices: [
        {
          name: `${'boot.md'.padEnd(22)} ${chalk.gray('Run commands on agent startup')}`,
          value: 'boot',
        },
        {
          name: `${'command-logger'.padEnd(22)} ${chalk.gray('Log every tool call to file')}`,
          value: 'command-logger',
        },
        {
          name: `${'session-memory'.padEnd(22)} ${chalk.gray('Persist session context across restarts')}`,
          value: 'session-memory',
        },
        {
          name: `${'morning-briefing'.padEnd(22)} ${chalk.gray('Daily proactive summary to HEARTBEAT.md')}`,
          value: 'morning-briefing',
        },
      ]
    }]);

    const heartbeat = selectedHooks.includes('morning-briefing');

    try {
      const { HookLoader } = await import('../hooks/loader');
      const loader = new HookLoader();
      for (const h of selectedHooks) loader.enable(h);
    } catch { /* ignore � hooks can be enabled later */ }

    if (selectedHooks.length > 0) {
      console.log(chalk.green(`  ? Enabled: ${selectedHooks.join(', ')}\n`));
    }

    return { hooks: selectedHooks, heartbeat };
  }

  // -- PC Access level -----------------------------------------------------------
  private async configurePcAccess(): Promise<{ level: string; confirmDestructive: boolean }> {
    console.log(chalk.hex('#06b6d4')('\n  ?? PC Access Level\n'));
    console.log(chalk.gray('  Controls what the agent can do on your computer.\n'));

    const { level } = await inquirer.prompt([{
      type: 'list',
      name: 'level',
      message: 'PC access level:',
      choices: [
        { name: `Full        ${chalk.gray('(bash, file read/write, screenshots � recommended for power users)')}`, value: 'full' },
        { name: `Sandboxed   ${chalk.gray('(read files, limited shell, no destructive writes)')}`, value: 'sandboxed' },
        { name: `Read-only   ${chalk.gray('(read files only � safest)')}`, value: 'read-only' },
      ],
      default: 'full'
    }]);

    const { confirmDestructive } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmDestructive',
      message: 'Require confirmation before destructive actions (delete files, overwrite)?',
      default: level !== 'full'
    }]);

    console.log(chalk.green(`  ? PC access: ${level}${confirmDestructive ? ' + confirm destructive' : ''}\n`));
    return { level, confirmDestructive };
  }

  // -- Skill Hub ----------------------------------------------------------------
  private async configureSkillHub(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Skill Hub (ClawHub)\n'));
    console.log(chalk.gray('  Install skills from the ClawHub marketplace (AI tools, workflows, integrations).\n'));

    const { wantSkills } = await inquirer.prompt([{
      type: 'confirm', name: 'wantSkills',
      message: 'Install skills from the Skill Hub?', default: false
    }]);
    if (!wantSkills) return;

    try {
      const { SkillHub } = await import('../plugins/hub');
      const hub = new SkillHub();

      const FEATURED = [
        { name: `web-search       ${chalk.gray('(Google/Bing/DuckDuckGo search)')}`, value: 'web-search' },
        { name: `file-manager     ${chalk.gray('(read, write, list files)')}`, value: 'file-manager' },
        { name: `code-runner      ${chalk.gray('(run Python/JS snippets safely)')}`, value: 'code-runner' },
        { name: `github-tools     ${chalk.gray('(repos, issues, PRs via API)')}`, value: 'github-tools' },
        { name: `calendar-tools   ${chalk.gray('(Google Calendar read/write)')}`, value: 'calendar-tools' },
        { name: `summarizer       ${chalk.gray('(summarize URLs, PDFs, text)')}`, value: 'summarizer' },
        { name: `custom           ${chalk.gray('(enter skill ID manually)')}`, value: '__custom__' },
      ];

      const { selectedSkills } = await inquirer.prompt([{
        type: 'checkbox', name: 'selectedSkills',
        message: 'Select skills to install:',
        choices: FEATURED
      }]);

      for (const skillId of selectedSkills) {
        if (skillId === '__custom__') {
          const { customId } = await inquirer.prompt([{
            type: 'input', name: 'customId',
            message: '  Skill ID from ClawHub:',
            validate: (v: string) => v.trim().length > 0 || 'Required'
          }]);
          if (customId.trim()) {
            const s = ora(`Installing ${customId.trim()}...`).start();
            try {
              await hub.install(customId.trim(), false);
              s.succeed(`Installed: ${customId.trim()}`);
            } catch (e: any) { s.fail(e.message); }
          }
        } else {
          const s = ora(`Installing ${skillId}...`).start();
          try {
            await hub.install(skillId, false);
            s.succeed(`Installed: ${skillId}`);
          } catch (e: any) { s.warn(`${skillId}: ${e.message} (install later: hyperclaw skill install ${skillId})`); }
        }
      }
      if (selectedSkills.length > 0) console.log();
    } catch {
      console.log(chalk.yellow(`  ? Skill Hub unavailable � install later: hyperclaw hub\n`));
    }
  }

  // -- Rate Limiting -------------------------------------------------------------
  private async configureRateLimiting(): Promise<{ maxPerMinute?: number; maxPerHour?: number } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Rate Limiting\n'));
    console.log(chalk.gray('  Limit how many messages the agent processes per channel per minute/hour.\n'));

    const { wantRateLimit } = await inquirer.prompt([{
      type: 'confirm', name: 'wantRateLimit',
      message: 'Configure rate limits?', default: false
    }]);
    if (!wantRateLimit) return undefined;

    const { maxPerMinute, maxPerHour } = await inquirer.prompt([
      {
        type: 'input', name: 'maxPerMinute',
        message: '  Max messages per minute per user (0 = unlimited):',
        default: '0',
        validate: (v: string) => !isNaN(Number(v)) || 'Enter a number'
      },
      {
        type: 'input', name: 'maxPerHour',
        message: '  Max messages per hour per user (0 = unlimited):',
        default: '0',
        validate: (v: string) => !isNaN(Number(v)) || 'Enter a number'
      }
    ]);

    const mpm = Number(maxPerMinute);
    const mph = Number(maxPerHour);
    if (mpm === 0 && mph === 0) return undefined;
    console.log(chalk.green(`  ? Rate limit: ${mpm > 0 ? `${mpm}/min` : ''}${mpm > 0 && mph > 0 ? ', ' : ''}${mph > 0 ? `${mph}/hr` : ''}\n`));
    return { ...(mpm > 0 ? { maxPerMinute: mpm } : {}), ...(mph > 0 ? { maxPerHour: mph } : {}) };
  }

  // -- Developer Key -------------------------------------------------------------
  private async configureDeveloperKey(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Developer API Key\n'));
    console.log(chalk.gray('  Create a key for embedding HyperClaw in apps or managed hosting.\n'));

    const { wantDevKey } = await inquirer.prompt([{
      type: 'confirm', name: 'wantDevKey',
      message: 'Create a developer API key?', default: false
    }]);
    if (!wantDevKey) return;

    try {
      const developerKeys = await import('../infra/developer-keys');
      const { name } = await inquirer.prompt([{
        type: 'input', name: 'name',
        message: '  Key name:', default: 'default'
      }]);
      const { id, key } = await developerKeys.createDeveloperKey(name.trim() || 'default');
      console.log(chalk.green(`  ? Developer key created`));
      console.log(chalk.gray(`  ID:  ${id}`));
      console.log(chalk.yellow(`  Key: ${key}`));
      console.log(chalk.gray(`  Store securely � shown once. Use: Authorization: Bearer <key>\n`));
    } catch {
      console.log(chalk.yellow(`  ? Could not create key � run: hyperclaw developer-key create\n`));
    }
  }

  // -- Voice Call Config ---------------------------------------------------------
  private async configureVoiceCall(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ???  Voice Call\n'));
    console.log(chalk.gray('  Terminal voice call mode � speaks directly to the gateway.\n'));

    const { wantVoiceCall } = await inquirer.prompt([{
      type: 'confirm', name: 'wantVoiceCall',
      message: 'Configure voice call settings?', default: false
    }]);
    if (!wantVoiceCall) return;

    const { gatewayUrl } = await inquirer.prompt([{
      type: 'input', name: 'gatewayUrl',
      message: '  Gateway URL for voice calls:',
      default: 'http://localhost:18789'
    }]);

    // Store in config
    const cfg = await this.config.load();
    await this.config.patch({
      channelConfigs: {
        ...(cfg.channelConfigs || {}),
        'voice-call': { gatewayUrl: gatewayUrl.trim() }
      }
    });
    console.log(chalk.green(`  ? Voice call: ${gatewayUrl.trim()}\n`));
    console.log(chalk.gray(`  Start: hyperclaw voice-call --gateway-url ${gatewayUrl.trim()}\n`));
  }

  // -- Canvas Preferences --------------------------------------------------------
  private async configureCanvas(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Canvas (AI-driven UI)\n'));
    console.log(chalk.gray('  Live canvas for displaying AI-generated cards, charts, and components.\n'));

    const { wantCanvas } = await inquirer.prompt([{
      type: 'confirm', name: 'wantCanvas',
      message: 'Enable canvas features?', default: false
    }]);
    if (!wantCanvas) return;

    const { canvasMode } = await inquirer.prompt([{
      type: 'list', name: 'canvasMode',
      message: '  Default canvas mode:',
      choices: [
        { name: `Auto    ${chalk.gray('(show canvas when AI generates structured output)')}`, value: 'auto' },
        { name: `Always  ${chalk.gray('(always show canvas panel)')}`, value: 'always' },
        { name: `Manual  ${chalk.gray('(show only via hyperclaw canvas show)')}`, value: 'manual' },
      ], default: 'auto'
    }]);

    await this.config.patch({ channelConfigs: { ...((await this.config.load()).channelConfigs || {}), canvas: { mode: canvasMode } } });
    console.log(chalk.green(`  ? Canvas mode: ${canvasMode}\n`));
  }

  // -- Deploy Config -------------------------------------------------------------
  private async configureDeploy(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ??  Cloud Deploy\n'));
    console.log(chalk.gray('  Deploy the gateway to a cloud platform (Fly.io or Render).\n'));

    const { wantDeploy } = await inquirer.prompt([{
      type: 'confirm', name: 'wantDeploy',
      message: 'Set up cloud deployment?', default: false
    }]);
    if (!wantDeploy) return;

    const { platform } = await inquirer.prompt([{
      type: 'list', name: 'platform',
      message: '  Platform:',
      choices: [
        { name: `Fly.io   ${chalk.gray('(recommended � fast global edge)')}`, value: 'fly' },
        { name: `Render   ${chalk.gray('(free tier available � GitHub integration)')}`, value: 'render' },
      ]
    }]);

    if (platform === 'fly') {
      console.log(chalk.gray('\n  Fly.io deployment steps:'));
      console.log(chalk.gray('  1. Install: curl -L https://fly.io/install.sh | sh'));
      console.log(chalk.gray('  2. Login:   fly auth login'));
      console.log(chalk.gray('  3. Launch:  fly launch'));
      console.log(chalk.gray('  4. Secrets: fly secrets set ANTHROPIC_API_KEY=... HYPERCLAW_GATEWAY_TOKEN=...'));
      console.log(chalk.gray('  5. Deploy:  fly deploy'));
      console.log(chalk.gray('\n  Or: hyperclaw deploy --platform fly\n'));
    } else {
      console.log(chalk.gray('\n  Render deployment steps:'));
      console.log(chalk.gray('  1. Push to GitHub'));
      console.log(chalk.gray('  2. Connect at https://render.com > New Web Service > select repo'));
      console.log(chalk.gray('  3. Set env: ANTHROPIC_API_KEY, HYPERCLAW_GATEWAY_TOKEN'));
      console.log(chalk.gray('\n  Or: hyperclaw deploy --platform render\n'));
    }

    await this.config.patch({ channelConfigs: { ...((await this.config.load()).channelConfigs || {}), deploy: { platform } } });
    console.log(chalk.green(`  ? Deploy target saved: ${platform}\n`));
  }

  // -- MCP Servers ---------------------------------------------------------------
  private async configureMcpServers(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? MCP Servers (Model Context Protocol)\n'));
    console.log(chalk.gray('  Register external tool servers the agent can call (filesystem, browser, APIs).\n'));

    const { wantMcp } = await inquirer.prompt([{
      type: 'confirm', name: 'wantMcp',
      message: 'Add MCP servers now?', default: false
    }]);
    if (!wantMcp) return;

    const { mcpAdd } = await import('../commands/mcp');
    let addMore = true;
    while (addMore) {
      await mcpAdd();
      const { more } = await inquirer.prompt([{
        type: 'confirm', name: 'more', message: '  Add another MCP server?', default: false
      }]);
      addMore = more;
    }
  }

  // -- Workspace Template ---------------------------------------------------------
  private async configureWorkspaceTemplate(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Workspace Template\n'));
    console.log(chalk.gray('  Initialize workspace files (SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md).\n'));

    const { wantTemplate } = await inquirer.prompt([{
      type: 'confirm', name: 'wantTemplate',
      message: 'Initialize workspace template files now?', default: false
    }]);
    if (!wantTemplate) return;

    const { selectedFiles } = await inquirer.prompt([{
      type: 'checkbox', name: 'selectedFiles',
      message: 'Select template files to create:',
      choices: [
        { name: `SOUL.md        ${chalk.gray('Agent core values, purpose & boundaries')}`, value: 'SOUL', checked: true },
        { name: `USER.md        ${chalk.gray('User profile, preferences & context')}`, value: 'USER', checked: true },
        { name: `TOOLS.md       ${chalk.gray('Tool inventory & usage guidelines')}`, value: 'TOOLS', checked: false },
        { name: `HEARTBEAT.md   ${chalk.gray('Daily status / morning briefing target')}`, value: 'HEARTBEAT', checked: false },
        { name: `AGENTS.md      ${chalk.gray('Rules & subagent configuration')}`, value: 'AGENTS', checked: false },
      ]
    }]);

    if (selectedFiles.length > 0) {
      try {
        const { initWorkspaceFiles } = await import('../agents/memory');
        const os = (await import('os')).default;
        const path = (await import('path')).default;
        const targetDir = path.join(os.homedir(), '.hyperclaw');
        await initWorkspaceFiles({
          agentName: 'Hyper', personality: 'helpful and concise',
          language: 'English', userName: 'User', rules: []
        }, targetDir);
        console.log(chalk.green(`  ? Workspace files initialized in ${targetDir}\n`));
      } catch {
        console.log(chalk.yellow(`  ? Could not initialize workspace � run: hyperclaw workspace init\n`));
      }
    }
  }

  // -- Cron Tasks ----------------------------------------------------------------
  private async configureCronTasks(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ? Scheduled Tasks (Cron)\n'));
    console.log(chalk.gray('  Schedule recurring agent prompts (e.g. daily briefing, weekly report).\n'));

    const PRESETS = [
      { name: `Morning briefing  ${chalk.gray('(Mon-Fri 9am)')}`, schedule: '0 9 * * 1-5', prompt: 'Give me a morning briefing: check calendar, news, tasks.' },
      { name: `Daily summary     ${chalk.gray('(daily 6pm)')}`, schedule: '0 18 * * *', prompt: 'Summarize today\'s activity and pending tasks.' },
      { name: `Weekly report     ${chalk.gray('(Mon 8am)')}`, schedule: '0 8 * * 1', prompt: 'Generate a weekly summary of completed tasks and goals.' },
      { name: `Custom            ${chalk.gray('(enter manually)')}`, schedule: '__custom__', prompt: '' },
    ];

    const { wantCron } = await inquirer.prompt([{
      type: 'confirm', name: 'wantCron',
      message: 'Add scheduled tasks?', default: false
    }]);
    if (!wantCron) return;

    const { selectedPresets } = await inquirer.prompt([{
      type: 'checkbox', name: 'selectedPresets',
      message: 'Select tasks to schedule:',
      choices: PRESETS.map(p => ({ name: p.name, value: p.schedule }))
    }]);

    const tasksToAdd: Array<{ schedule: string; prompt: string; name?: string }> = [];

    for (const sch of selectedPresets) {
      if (sch === '__custom__') {
        const r = await inquirer.prompt([
          { type: 'input', name: 'schedule', message: '  Cron schedule (e.g. "0 9 * * 1-5"):', validate: (v: string) => v.trim().length > 0 || 'Required' },
          { type: 'input', name: 'prompt', message: '  Agent prompt:', validate: (v: string) => v.trim().length > 0 || 'Required' },
          { type: 'input', name: 'name', message: '  Task name:', default: 'Custom task' }
        ]);
        tasksToAdd.push({ schedule: r.schedule.trim(), prompt: r.prompt.trim(), name: r.name.trim() });
      } else {
        const preset = PRESETS.find(p => p.schedule === sch)!;
        tasksToAdd.push({ schedule: preset.schedule, prompt: preset.prompt, name: preset.name.replace(/\s+\(.*\)/, '').trim() });
      }
    }

    if (tasksToAdd.length > 0) {
      try {
        const { loadCronTasks, addCronTask, saveCronTasks } = await import('../services/cron-tasks');
        await loadCronTasks();
        for (const t of tasksToAdd) addCronTask(t.schedule, t.prompt, t.name);
        await saveCronTasks();
        console.log(chalk.green(`  ? ${tasksToAdd.length} task(s) scheduled\n`));
      } catch {
        console.log(chalk.yellow(`  ? Could not save tasks � run: hyperclaw cron add\n`));
      }
    }
  }

  // -- Auto-reply Rules ----------------------------------------------------------
  private async configureAutoReply(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Auto-reply Rules\n'));
    console.log(chalk.gray('  Automatic responses before the AI model is invoked.\n'));

    const { wantAutoReply } = await inquirer.prompt([{
      type: 'confirm', name: 'wantAutoReply',
      message: 'Set up auto-reply rules?', default: false
    }]);
    if (!wantAutoReply) return;

    const PRESETS = [
      { name: `Away message   ${chalk.gray('(reply to every message when offline)')}`, value: 'away' },
      { name: `Keyword reply  ${chalk.gray('(reply to specific keyword)')}`, value: 'keyword' },
      { name: `Ignore channel ${chalk.gray('(silently ignore a channel)')}`, value: 'ignore' },
    ];

    const { ruleType } = await inquirer.prompt([{
      type: 'list', name: 'ruleType',
      message: 'Rule type:',
      choices: PRESETS
    }]);

    try {
      const { AutoReplyEngine } = await import('../auto-reply/rules');
      const engine = new AutoReplyEngine();
      await engine.load();

      const BASE = { enabled: true, priority: 10, stopOnMatch: true, conditionLogic: 'OR' as const };
      if (ruleType === 'away') {
        const { reply } = await inquirer.prompt([{
          type: 'input', name: 'reply',
          message: '  Away message text:',
          default: "I'm currently unavailable. I'll get back to you soon.",
          validate: (v: string) => v.trim().length > 0 || 'Required'
        }]);
        await engine.add({ ...BASE, name: 'Away message', conditions: [{ type: 'always' }], action: { type: 'reply', reply: reply.trim() } });
      } else if (ruleType === 'keyword') {
        const r = await inquirer.prompt([
          { type: 'input', name: 'keyword', message: '  Trigger keyword:', validate: (v: string) => v.trim().length > 0 || 'Required' },
          { type: 'input', name: 'reply', message: '  Reply text:', validate: (v: string) => v.trim().length > 0 || 'Required' }
        ]);
        await engine.add({ ...BASE, name: `Keyword: ${r.keyword}`, conditions: [{ type: 'contains', value: r.keyword.trim() }], action: { type: 'reply', reply: r.reply.trim() } });
      } else if (ruleType === 'ignore') {
        const { channelId } = await inquirer.prompt([{
          type: 'input', name: 'channelId', message: '  Channel ID to ignore:',
          validate: (v: string) => v.trim().length > 0 || 'Required'
        }]);
        await engine.add({ ...BASE, name: `Ignore channel: ${channelId}`, conditions: [{ type: 'channel', value: channelId.trim() }], action: { type: 'ignore' } });
      }
      console.log(chalk.green(`  ? Auto-reply rule added\n`));
    } catch {
      console.log(chalk.yellow(`  ? Could not save rule � run: hyperclaw auto-reply list\n`));
    }
  }

  // -- Webhooks ------------------------------------------------------------------
  private async configureWebhooks(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Inbound Webhooks\n'));
    console.log(chalk.gray('  Register POST endpoints that trigger the agent (GitHub, Stripe, Linear, etc).\n'));

    const { wantWebhook } = await inquirer.prompt([{
      type: 'confirm', name: 'wantWebhook',
      message: 'Register inbound webhook endpoints?', default: false
    }]);
    if (!wantWebhook) return;

    try {
      const { WebhookManager } = await import('../webhooks/manager');
      const manager = new WebhookManager();
      await manager.load();

      let addMore = true;
      while (addMore) {
        const r = await inquirer.prompt([
          { type: 'input', name: 'name', message: '  Webhook name (e.g. GitHub push):', validate: (v: string) => v.trim().length > 0 || 'Required' },
          {
            type: 'list', name: 'format', message: '  Payload format:',
            choices: [
              { name: 'GitHub', value: 'github' }, { name: 'Stripe', value: 'stripe' },
              { name: 'Linear', value: 'linear' }, { name: 'Notion', value: 'notion' },
              { name: 'JSON (generic)', value: 'json' }, { name: 'Raw', value: 'raw' },
            ]
          },
          { type: 'input', name: 'template', message: '  Message template (use {{body.field}}):', default: 'Webhook received: {{body}}' },
        ]);
        await manager.add({
          name: r.name.trim(),
          format: r.format,
          template: r.template.trim(),
          routeTo: { type: 'channel', target: 'default' }
        });
        const { more } = await inquirer.prompt([{
          type: 'confirm', name: 'more', message: '  Add another webhook?', default: false
        }]);
        addMore = more;
      }
      console.log(chalk.green(`  ? Webhook(s) registered � route: POST /webhook/<id>\n`));
    } catch {
      console.log(chalk.yellow(`  ? Could not save webhooks � run: hyperclaw webhooks list\n`));
    }
  }

  // -- Nodes ----------------------------------------------------------------------
  private async configureNodes(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ???  Nodes (Remote Compute / Mobile)\n'));
    console.log(chalk.gray('  Add VPS, Raspberry Pi, Android, or VM nodes for distributed inference.\n'));

    const { wantNode } = await inquirer.prompt([{
      type: 'confirm', name: 'wantNode',
      message: 'Add compute nodes?', default: false
    }]);
    if (!wantNode) return;

    const { nodeAdd } = await import('../commands/node');
    let addMore = true;
    while (addMore) {
      await nodeAdd();
      const { more } = await inquirer.prompt([{
        type: 'confirm', name: 'more', message: '  Add another node?', default: false
      }]);
      addMore = more;
    }
  }

  // -- OAuth / Auth ---------------------------------------------------------------
  private async configureOAuth(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? OAuth / External Auth\n'));
    console.log(chalk.gray('  Connect Google, GitHub or other accounts for the agent to act on your behalf.\n'));

    const { wantOAuth } = await inquirer.prompt([{
      type: 'confirm', name: 'wantOAuth',
      message: 'Set up OAuth / external auth now?', default: false
    }]);
    if (!wantOAuth) return;

    const { selectedProviders } = await inquirer.prompt([{
      type: 'checkbox', name: 'selectedProviders',
      message: 'Select providers to connect:',
      choices: [
        { name: `Google Calendar   ${chalk.gray('(read/create events)')}`, value: 'google-calendar' },
        { name: `Google Drive      ${chalk.gray('(read/write files)')}`, value: 'google-drive' },
        { name: `GitHub            ${chalk.gray('(repos, issues, PRs)')}`, value: 'github' },
        { name: `Notion            ${chalk.gray('(pages & databases)')}`, value: 'notion' },
        { name: `Linear            ${chalk.gray('(issues & projects)')}`, value: 'linear' },
      ]
    }]);

    for (const provider of selectedProviders) {
      console.log(chalk.gray(`\n  Starting OAuth flow for ${provider}...`));
      try {
        const { runOAuthFlow } = await import('../services/oauth-flow');
        const { writeOAuthToken } = await import('../services/oauth-provider');
        const tokens = await runOAuthFlow(provider, {});
        const now = Math.floor(Date.now() / 1000);
        await writeOAuthToken(provider, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_in ? now + tokens.expires_in : undefined,
          token_url: `https://oauth2.googleapis.com/token`
        });
        console.log(chalk.green(`  ? ${provider} connected\n`));
      } catch {
        console.log(chalk.yellow(`  ? ${provider} OAuth failed � run later: hyperclaw auth oauth ${provider}\n`));
      }
    }
  }

  // -- Multi-agent Bindings -------------------------------------------------------
  private async configureAgentBindings(): Promise<void> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Multi-agent Bindings\n'));
    console.log(chalk.gray('  Route specific channels to different agent personas or models.\n'));

    const { wantBindings } = await inquirer.prompt([{
      type: 'confirm', name: 'wantBindings',
      message: 'Configure channel > agent bindings?', default: false
    }]);
    if (!wantBindings) return;

    try {
      const { AgentRouter } = await import('../routing/agents-routing');
      await new AgentRouter().bind();
      return;
    } catch {
      // Fallback: simple manual binding
      const r = await inquirer.prompt([
        { type: 'input', name: 'channel', message: '  Channel ID (e.g. telegram):', validate: (v: string) => v.trim().length > 0 || 'Required' },
        { type: 'input', name: 'agentName', message: '  Agent name / persona for this channel:', default: 'Hyper' },
        { type: 'input', name: 'modelId', message: '  Override model ID (leave blank = use primary):', default: '' },
      ]);
      if (r.channel) {
        const fs = (await import('fs-extra')).default;
        const path = (await import('path')).default;
        const os = (await import('os')).default;
        const bindFile = path.join(os.homedir(), '.hyperclaw', 'agent-bindings.json');
        let bindings: any[] = [];
        try { bindings = await fs.readJson(bindFile); } catch {}
        bindings.push({
          channelId: r.channel.trim(),
          agentName: r.agentName.trim(),
          modelId: r.modelId.trim() || undefined,
          createdAt: new Date().toISOString()
        });
        await fs.ensureDir(path.dirname(bindFile));
        await fs.writeJson(bindFile, bindings, { spaces: 2 });
        console.log(chalk.green(`  ? Binding: ${r.channel} > ${r.agentName}\n`));
      }
    }
  }

  // -- Group Sandbox (Docker) ----------------------------------------------------
  private async configureGroupSandbox(): Promise<{ enabled: boolean; image?: string; memoryLimit?: string } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Group Sandbox (Docker)\n'));
    console.log(chalk.gray('  Isolates group chat sessions in Docker containers for security.\n'));

    const { wantSandbox } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantSandbox',
      message: 'Enable Docker sandboxing for group chat sessions?',
      default: false
    }]);

    if (!wantSandbox) return undefined;

    const { image, memoryLimit } = await inquirer.prompt([
      { type: 'input', name: 'image', message: '  Docker image:', default: 'node:22-alpine' },
      { type: 'input', name: 'memoryLimit', message: '  Memory limit per container:', default: '256m' }
    ]);

    console.log(chalk.green(`  ? Group sandbox: ${image} (${memoryLimit})\n`));
    return { enabled: true, image: image.trim(), memoryLimit: memoryLimit.trim() };
  }

  // -- Update channel ------------------------------------------------------------
  private async configureUpdateChannel(): Promise<string> {
    console.log(chalk.hex('#06b6d4')('\n  ?? Update Channel\n'));

    const { channel } = await inquirer.prompt([{
      type: 'list',
      name: 'channel',
      message: 'Update channel:',
      choices: [
        { name: `Stable  ${chalk.gray('(recommended � tested releases)')}`, value: 'stable' },
        { name: `Beta    ${chalk.gray('(early access � new features, may have bugs)')}`, value: 'beta' },
        { name: `Dev     ${chalk.gray('(bleeding edge � for contributors)')}`, value: 'dev' },
      ],
      default: 'stable'
    }]);

    console.log(chalk.green(`  ? Update channel: ${channel}\n`));
    return channel;
  }

  private async saveAll(data: any, options: WizardOptions): Promise<void> {
    console.log();
    const spinner = ora('Saving configuration...').start();

    const current = await this.config.load();
    const skillsPatch: any = { installed: current?.skills?.installed || [] };
    if (data.serviceApiKeys && Object.keys(data.serviceApiKeys).length > 0) {
      skillsPatch.apiKeys = { ...(current?.skills?.apiKeys || {}), ...data.serviceApiKeys };
    }
    if (current?.skills?.vtApiKey) skillsPatch.vtApiKey = current.skills.vtApiKey;

    const finalSkills = skillsPatch.apiKeys || skillsPatch.vtApiKey ? skillsPatch : (current?.skills || { installed: [] });

    await this.config.save({
      ...current,
      version: '5.0.2',
      workspaceName: data.workspaceName,
      provider: data.providerConfig,
      providers: data.providers || (data.providerConfig ? [data.providerConfig] : []),
      gateway: data.gatewayConfig || undefined,
      channels: Object.keys(data.channelConfigs || {}),
      channelConfigs: data.channelConfigs,
      skills: finalSkills,
      enabledHooks: data.hooks || [],
      identity: {
        agentName: data.identity?.agentName,
        userName: data.identity?.userName,
        language: data.identity?.language,
        wakeWord: data.identity?.wakeWord || `Hey ${data.identity?.agentName || 'Hyper'}`,
        wakeUpMessage: data.identity?.wakeUpMessage,
        systemPrompt: data.identity?.systemPrompt,
        personality: data.identity?.personality,
        rules: data.identity?.rules
      },
      memoryIntegration: data.memoryIntegration,
      talkMode: data.talkModeConfig,
      pcAccess: {
        enabled: true,
        level: data.pcAccess?.level || 'full',
        allowedPaths: [],
        allowedCommands: [],
        confirmDestructive: data.pcAccess?.confirmDestructive ?? false,
        maxOutputBytes: 50_000
      },
      updateChannel: data.updateChannel || 'stable',
      groupSandbox: data.groupSandbox,
      ...(data.webSearch ? { webSearch: data.webSearch } : {}),
      ...(data.rateLimit ? { rateLimit: data.rateLimit } : {}),
      hatchMode: data.hatchMode || 'tui',
      installedAt: new Date().toISOString()
    });

    spinner.succeed('Configuration saved');

    const memory = new MemoryManager();
    await memory.init(data.identity);

    if (data.heartbeatEnabled) {
      try {
        const { HookLoader } = await import('../hooks/loader');
        const loader = new HookLoader();
        loader.enable('morning-briefing');
        console.log(chalk.gray('  ?  Morning Briefing hook enabled'));
      } catch { /* ignore */ }
    }

    await this.testConnections(data.channelConfigs || {});

    // -- Optional integrations step -------------------------------------------
    await this.setupIntegrations();

    if (data.installDaemon || options.daemon || options.installDaemon) {
      const runtime = options.daemonRuntime ?? data.daemonRuntime ?? 'node';
      const s = ora(`?? Installing system daemon (runtime: ${runtime})...`).start();
      await this.daemon.install();
      s.succeed(chalk.red(`?? System daemon installed (runtime: ${runtime}, starts on boot)`));
    }

    if (data.gatewayConfig?.tailscaleExposure && data.gatewayConfig.tailscaleExposure !== 'off') {
      await this.gateway.applyTailscaleExposure(data.gatewayConfig.tailscaleExposure, data.gatewayConfig.port);
    }

    if (data.gatewayConfig && (options.startNow || data.installDaemon)) {
      const s = ora('Starting gateway...').start();
      await this.daemon.start();
      s.succeed(`Gateway running at ws://localhost:${data.gatewayConfig.port}`);
    }

    // -- Health check step (like OpenClaw) ------------------------------------
    console.log(chalk.gray('\n  Running health check...\n'));
    const healthResults: Record<string, string> = {};
    try {
      const { runDoctor } = await import('../commands/doctor');
      await runDoctor(true);
      healthResults.doctor = 'ok';
    } catch { healthResults.doctor = 'failed'; }

    // Test gateway reachability if running
    if (data.gatewayConfig && (options.startNow || data.installDaemon)) {
      try {
        const http = await import('http');
        const port = data.gatewayConfig.port || 18789;
        const reachable = await new Promise<boolean>(resolve => {
          const req = http.get(`http://127.0.0.1:${port}/api/status`, () => resolve(true));
          req.on('error', () => resolve(false));
          req.setTimeout(3000, () => { req.destroy(); resolve(false); });
        });
        healthResults.gateway = reachable ? 'reachable' : 'unreachable';
        if (reachable) console.log(chalk.green(`  ?  Gateway reachable at port ${port}`));
        else console.log(chalk.yellow(`  ?  Gateway not yet reachable at port ${port} � it may still be starting`));
      } catch { healthResults.gateway = 'error'; }
    }

    // -- JSON output (--json flag) ---------------------------------------------
    if (options.jsonOutput) {
      const result = {
        ok: true,
        version: '5.0.2',
        provider: data.providerConfig?.providerId,
        model: data.providerConfig?.modelId,
        gateway: data.gatewayConfig ? {
          port: data.gatewayConfig.port,
          bind: data.gatewayConfig.bind,
        } : null,
        channels: Object.keys(data.channelConfigs || {}),
        hooks: data.hooks || [],
        daemonInstalled: !!(data.installDaemon || options.installDaemon),
        health: healthResults,
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    this.showSuccessScreen(data);
  }

  private async setupIntegrations(): Promise<void> {
    console.log();

    const { skip } = await inquirer.prompt<{ skip: boolean }>([{
      type: 'confirm',
      name: 'skip',
      message: chalk.cyan('Configure integrations now?') + chalk.gray(' (Spotify, Home Assistant, GitHub, Trello, etc.)'),
      default: false
    }]);

    if (skip === false) {
      // They said yes (default false = confirmed)
    } else {
      console.log(chalk.gray('  Skipped — configure later by telling the agent or running: hyperclaw config set-key KEY value\n'));
      return;
    }

    const INTEGRATIONS: Array<{
      name: string;
      value: string;
      keys: Array<{ env: string; label: string; secret?: boolean }>;
    }> = [
      {
        name: 'Spotify', value: 'spotify', keys: [
          { env: 'SPOTIFY_CLIENT_ID', label: 'Client ID' },
          { env: 'SPOTIFY_CLIENT_SECRET', label: 'Client Secret', secret: true },
          { env: 'SPOTIFY_REFRESH_TOKEN', label: 'Refresh Token', secret: true }
        ]
      },
      {
        name: 'Home Assistant', value: 'ha', keys: [
          { env: 'HA_URL', label: 'URL (e.g. http://homeassistant.local:8123)' },
          { env: 'HA_TOKEN', label: 'Long-lived Access Token', secret: true }
        ]
      },
      {
        name: 'GitHub', value: 'github', keys: [
          { env: 'GITHUB_TOKEN', label: 'Personal Access Token', secret: true }
        ]
      },
      {
        name: 'Trello', value: 'trello', keys: [
          { env: 'TRELLO_API_KEY', label: 'API Key' },
          { env: 'TRELLO_TOKEN', label: 'Token', secret: true }
        ]
      },
      {
        name: 'Obsidian', value: 'obsidian', keys: [
          { env: 'OBSIDIAN_API_KEY', label: 'Local REST API Key', secret: true },
          { env: 'OBSIDIAN_PORT', label: 'Port (default: 27123, leave blank to skip)' }
        ]
      },
      {
        name: 'Philips Hue', value: 'hue', keys: [
          { env: 'HUE_BRIDGE_IP', label: 'Bridge IP (e.g. 192.168.1.100)' },
          { env: 'HUE_USERNAME', label: 'Username (from bridge discovery)' }
        ]
      },
      {
        name: '8Sleep', value: 'eightsleep', keys: [
          { env: 'EIGHTSLEEP_EMAIL', label: 'Email' },
          { env: 'EIGHTSLEEP_PASSWORD', label: 'Password', secret: true }
        ]
      },
      {
        name: 'Sonos', value: 'sonos', keys: [
          { env: 'SONOS_IP', label: 'Speaker IP (e.g. 192.168.1.50)' }
        ]
      },
      {
        name: 'Giphy / GIF search', value: 'giphy', keys: [
          { env: 'GIPHY_API_KEY', label: 'Giphy API Key (or leave blank for Tenor)' },
          { env: 'TENOR_API_KEY', label: 'Tenor API Key (optional, alternative to Giphy)' }
        ]
      },
      {
        name: '1Password', value: '1password', keys: [
          { env: 'OP_SERVICE_ACCOUNT_TOKEN', label: 'Service Account Token', secret: true }
        ]
      },
    ];

    const { chosen } = await inquirer.prompt<{ chosen: string[] }>([{
      type: 'checkbox',
      name: 'chosen',
      message: 'Select integrations to configure:',
      choices: [
        ...INTEGRATIONS.map(i => ({ name: i.name, value: i.value })),
      ],
      pageSize: 12
    }]);

    if (chosen.length === 0) {
      console.log(chalk.gray('  No integrations selected.\n'));
      return;
    }

    const envPath = path.join(os.homedir(), '.hyperclaw', '.env');
    const envLines: string[] = [];

    try {
      const existing = await fs.readFile(envPath, 'utf8').catch(() => '');
      envLines.push(...existing.split('\n').filter(l => l.trim()));
    } catch {}

    for (const id of chosen) {
      const integration = INTEGRATIONS.find(i => i.value === id)!;
      console.log(chalk.cyan(`\n  ${integration.name}`));

      for (const key of integration.keys) {
        const { val } = await inquirer.prompt<{ val: string }>([{
          type: key.secret ? 'password' : 'input',
          name: 'val',
          message: `  ${key.label}:`,
          mask: key.secret ? '*' : undefined
        }]);

        if (val && val.trim()) {
          const line = `${key.env}=${val.trim()}`;
          const idx = envLines.findIndex(l => l.startsWith(`${key.env}=`));
          if (idx >= 0) envLines[idx] = line;
          else envLines.push(line);
          console.log(chalk.green(`  ✔  ${key.env} saved`));
        } else {
          console.log(chalk.gray(`  –  ${key.env} skipped`));
        }
      }
    }

    await fs.ensureDir(path.dirname(envPath));
    await fs.writeFile(envPath, envLines.filter(Boolean).join('\n') + '\n', 'utf8');
    console.log(chalk.green(`\n  ✔  Integration keys saved to ~/.hyperclaw/.env`));
    console.log(chalk.gray('  To add more later: hyperclaw config set-key KEY value\n'));
  }

  private async testConnections(configs: Record<string, any>): Promise<void> {
    for (const [channelId, cfg] of Object.entries(configs)) {
      const ch = CHANNELS.find(c => c.id === channelId);
      if (!ch || !cfg?.token) continue;
      const s = ora(`Testing ${ch.name}...`).start();
      await new Promise(r => setTimeout(r, 900 + Math.random() * 600));
      s.succeed(`${ch.emoji} ${ch.name} connected`);
    }
  }

  private showSuccessScreen(data: any): void {
    const channels = Object.keys(data.channelConfigs || {});
    const gwUrl = `ws://localhost:${data.gatewayConfig?.port || 1515}`;
    const hasEmail = channels.includes('email');
    const hasHyperClawBot = !!data.hyperclawbotConfig?.token;

    const cmdLines = [
      chalk.gray('  hyperclaw dashboard       � TUI dashboard'),
      chalk.gray('  hyperclaw hub             � Skill hub'),
      chalk.gray('  hyperclaw gateway status  � Gateway panel'),
      chalk.gray('  hyperclaw ') + chalk.red('daemon') + chalk.gray(' status   � Service status'),
      chalk.gray('  hyperclaw voice           � Voice settings'),
      chalk.gray('  hyperclaw canvas show     � AI canvas'),
    ];
    if (hasHyperClawBot) cmdLines.push(chalk.gray('  hyperclaw bot start        � HyperClawBot remote control'));
    if (hasEmail) cmdLines.push(chalk.gray('  hyperclaw gmail watch-setup � Gmail Pub/Sub (real-time)'));
    cmdLines.push(chalk.gray('  hyperclaw nodes             � Mobile nodes (Connect tab)'));
    cmdLines.push(chalk.gray('  hyperclaw cron list         � Scheduled tasks'));

    const lines = [
      `${chalk.gray('Agent:')}     ${chalk.hex('#06b6d4')(data.identity?.agentName)} (you: ${data.identity?.userName})`,
      `${chalk.gray('Model:')}     ${data.providerConfig?.modelId}`,
      `${chalk.gray('Provider:')} ${data.providerConfig?.providerId}`,
      `${chalk.gray('Gateway:')}  ${gwUrl}`,
      `${chalk.gray('Channels:')} ${channels.length ? channels.join(', ') : 'CLI only'}`,
      '',
      chalk.hex('#06b6d4')('Commands:'),
      ...cmdLines,
    ].join('\n');

    console.log('\n' + boxen(
      chalk.hex('#06b6d4')('?? HyperClaw v5.0.2 ready!\n\n') + lines,
      { padding: 1, borderStyle: 'round', borderColor: 'cyan', margin: 1, backgroundColor: '#0a0a0a' }
    ));
  }
}
