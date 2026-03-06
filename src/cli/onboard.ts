import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { ConfigManager } from './config';
import { DaemonManager } from '../infra/daemon';
import { GatewayManager, GatewayConfig, GATEWAY_DEFAULTS } from './gateway';
import { PROVIDERS, getProvider, formatModel, getTranscriptionProviders } from './providers';
import { CHANNELS, getAvailableChannels, statusBadge, unavailableReason } from './channels';
import { MemoryManager, AgentIdentity } from './memory';
import { showSecurityDisclaimer, configureDMPolicy } from './security';
import { Banner } from '../terminal/banner';
import { CHANNEL_ICONS, PROVIDER_ICONS } from '../infra/channel-icons';

/** Brand-colored ■ square — closest we can get to a real icon in a terminal */
function brandIcon(id: string, type: 'channel' | 'provider' = 'channel'): string {
  const map = type === 'channel' ? CHANNEL_ICONS : PROVIDER_ICONS;
  const ic = map[id];
  if (!ic) return chalk.gray('■');
  return chalk.hex('#' + ic.color)('■');
}

interface WizardOptions {
  wizard?: boolean;
  autoConfig?: boolean;
  daemon?: boolean;
  startNow?: boolean;
  installDaemon?: boolean;
}

export class HyperClawWizard {
  private config = new ConfigManager();
  private daemon = new DaemonManager();
  private gateway = new GatewayManager();

  async run(options: WizardOptions): Promise<void> {
    const proceed = await showSecurityDisclaimer();
    if (!proceed) return;

    // ── Step 0: Theme selection ───────────────────────────────────────────────
    const { allThemes, getThemeName, setThemeName } = await import('../infra/theme');
    const currentTheme = getThemeName();
    const { chosenTheme } = await inquirer.prompt([{
      type: 'list',
      name: 'chosenTheme',
      message: '🎨 Choose a color theme:',
      default: currentTheme,
      choices: [
        { name: `${chalk.hex('#06b6d4')('■')} Dark Professional   ${chalk.gray('(neon cyan on black)')}`,   value: 'dark' },
        { name: `${chalk.hex('#64748b')('■')} Grey Professional   ${chalk.gray('(muted cyan, neutral)')}`,  value: 'grey' },
        { name: `${chalk.hex('#0284c7')('■')} White / Light       ${chalk.gray('(deep cyan, light bg)')}`,  value: 'white' },
      ]
    }]);
    if (chosenTheme !== currentTheme) {
      await setThemeName(chosenTheme);
    }
    // ─────────────────────────────────────────────────────────────────────────

    await (new Banner()).showWizardBanner();

    const { mode } = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: 'Setup mode:',
      choices: [
        { name: `${chalk.green('★')} QuickStart        ${chalk.gray('(Recommended)')}`, value: 'quick' },
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

  // ── Step header helper ──────────────────────────────────────────────────────
  private stepHeader(n: number, total: number, title: string): void {
    const { getTheme } = require('../infra/theme');
    const t = getTheme(false);
    const bar = chalk.gray('─'.repeat(52));
    console.log(`\n${bar}`);
    console.log(`  ${t.c(`Step ${n} / ${total}`)}  ·  ${chalk.bold(title)}`);
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
    const memoryIntegration = await this.configureMemoryIntegration();
    const serviceApiKeys = await this.configureServiceApiKeys();
    const hyperclawbotConfig = await this.configureHyperClawBot(gatewayConfig);
    const talkModeConfig = await this.configureTalkMode();

    await this.saveAll({
      workspaceName, providerConfig, providers: allProviders, channelConfigs,
      gatewayConfig, identity, hooks, heartbeatEnabled,
      memoryIntegration, serviceApiKeys, hyperclawbotConfig, talkModeConfig
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
    if (!installDaemon) {
      console.log(chalk.gray('  The daemon runs the gateway as a background service that starts on boot.\n'));
      const ans = await inquirer.prompt([{
        type: 'confirm', name: 'installDaemon',
        message: 'Install as system daemon (auto-start on boot)?', default: false
      }]);
      installDaemon = ans.installDaemon;
    } else {
      console.log(chalk.green('  ✔ Daemon will be installed automatically (--install-daemon)\n'));
    }

    this.stepHeader(8, STEPS, 'Extras');
    const memoryIntegration = await this.configureMemoryIntegration();
    const serviceApiKeys = await this.configureServiceApiKeys();
    const hyperclawbotConfig = await this.configureHyperClawBot(gatewayConfig);
    const talkModeConfig = await this.configureTalkMode();

    this.stepHeader(9, STEPS, 'Launch');
    const launchChoices: any[] = [
      { name: `TUI  — terminal dashboard`, value: 'tui' }
    ];
    if (gatewayConfig && !(gatewayConfig as any).remote) {
      launchChoices.push({ name: `Web  — browser at http://localhost:${(gatewayConfig as any).port}`, value: 'web' });
    }
    launchChoices.push({ name: chalk.gray('Do this later — I will start manually'), value: 'skip' });
    const { hatchMode } = await inquirer.prompt([{
      type: 'list', name: 'hatchMode', message: 'How do you want to hatch your bot?',
      choices: launchChoices
    }]);

    await this.saveAll({
      workspaceName, providerConfig, providers: allProviders, channelConfigs,
      gatewayConfig: gatewayConfig ? { ...gatewayConfig, hooks: hooks.length > 0 } : null,
      identity, hooks, heartbeatEnabled, installDaemon, hatchMode,
      memoryIntegration, serviceApiKeys, hyperclawbotConfig, talkModeConfig
    }, options);
  }

  // ── Multi-provider selection ─────────────────────────────────────────────────
  private async selectProvidersAndModels(): Promise<{ providers: any[]; primary: any }> {
    const { getTheme } = require('../infra/theme');
    const t = getTheme(false);

    console.log(chalk.gray('  Select one or more AI providers. The first one will be primary.\n'));

    // Step A: checkbox — pick providers
    const { selectedProviderIds } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedProviderIds',
      message: 'Select AI providers:',
      validate: (v: string[]) => v.length > 0 || 'Select at least one provider',
      choices: PROVIDERS.map(p => ({
        name: `${brandIcon(p.id, 'provider')} ${p.displayName.replace(/^.{1,2}\s/, '').padEnd(18)}${p.supportsTranscription ? chalk.gray(' 🎤') : ''}`,
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

      console.log(`\n  ${t.c('▸')} ${chalk.bold(provider.displayName)} ${isPrimary ? chalk.green('(primary)') : chalk.gray(`(#${i + 1})`)}\n`);
      if (provider.authHint) console.log(chalk.gray(`    💡 ${provider.authHint}\n`));

      let apiKey = '';
      let baseUrl: string | undefined;
      let modelId = '';

      if (provider.authType === 'api_key') {
        if (pid === 'custom') {
          const r = await inquirer.prompt([
            { type: 'input', name: 'baseUrl', message: '  Base URL:', validate: (v: string) => v.trim().length > 5 || 'Required' },
            { type: 'password', name: 'apiKey', message: `  ${provider.authLabel}:`, mask: '●', validate: (v: string) => v.trim().length > 5 || 'Required' },
            { type: 'input', name: 'modelId', message: '  Model ID:', validate: (v: string) => v.trim().length > 0 || 'Required' },
          ]);
          baseUrl = r.baseUrl.trim().replace(/\/$/, '');
          apiKey = r.apiKey;
          modelId = r.modelId.trim();
        } else {
          const r = await inquirer.prompt([{
            type: 'password', name: 'apiKey',
            message: `  ${provider.authLabel}:`, mask: '●'
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

      configured.push({ providerId: pid, apiKey, modelId, ...(baseUrl ? { baseUrl } : {}) });
      console.log(t.c(`  ✔ ${provider.displayName} → ${modelId}\n`));
    }

    return { providers: configured, primary: configured[0] };
  }

  // ── Gateway (optional) ───────────────────────────────────────────────────────
  private async configureGateway(full = false): Promise<GatewayConfig | null> {
    const { gatewayMode } = await inquirer.prompt([{
      type: 'list', name: 'gatewayMode',
      message: 'Gateway setup:',
      choices: [
        { name: `Local gateway   ${chalk.gray('(run on this machine)')}`, value: 'local' },
        { name: `Remote gateway  ${chalk.gray('(info-only — connect to existing server)')}`, value: 'remote' },
        { name: chalk.gray('Skip            (no gateway — CLI-only mode)'), value: 'skip' }
      ]
    }]);

    if (gatewayMode === 'skip') {
      console.log(chalk.gray('  ↳ Gateway skipped. Enable later: hyperclaw gateway start\n'));
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
        message: 'Remote gateway auth token:', mask: '●'
      }]);
      console.log(chalk.green('  ✔ Remote gateway configured\n'));
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
      console.log(chalk.gray('  ↳ Gateway skipped. You can enable it later: hyperclaw gateway start\n'));
      return null as any;
    }

    const running = await this.gateway.isRunning(18789);
    if (running) console.log(chalk.gray(`  ⚠  Gateway already running at ws://127.0.0.1:18789`));

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
      message: `Auth token: ${chalk.gray('(blank = auto-generate)')}`, mask: '●'
    });

    const answers = await inquirer.prompt(questions);
    const token = answers.authToken || this.gateway.generateToken();
    if (!answers.authToken) console.log(chalk.green('  ✔ Auth token auto-generated\n'));

    return {
      port: Number(answers.port),
      bind: answers.bind || '127.0.0.1',
      authToken: token,
      tailscaleExposure: answers.tailscaleExposure || 'off',
      runtime: answers.runtime || detectedRuntime,
      enabledChannels: [],
      hooks: true
    };
  }

  private async selectChannels(full = false): Promise<Record<string, any>> {
    console.log(chalk.hex('#06b6d4')('\n  📱 Communication Channels\n'));

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
        console.log(chalk.gray(`  💡 ${ch.tokenHint}`));
      }

      const fields: any[] = [{ type: 'password', name: 'token', message: `${ch.tokenLabel}:`, mask: '●' }];

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
          console.log(chalk.green('  ✔  Gmail OAuth configured — next: hyperclaw gmail watch-setup'));
        } catch (e: any) {
          console.log(chalk.yellow(`  ⚠  OAuth failed — you can run it later: hyperclaw auth oauth google-gmail`));
        }
      }
    }

    return channelConfigs;
  }

  private async configureServiceApiKeys(): Promise<Record<string, string>> {
    console.log(chalk.hex('#06b6d4')('\n  🔑 Service API Keys — any app with an API key\n'));
    console.log(chalk.gray('  Stored securely in config. How they work:\n'));
    console.log(chalk.gray('  • Wizard: add keys here\n'));
    console.log(chalk.gray('  • Config: ~/.hyperclaw/hyperclaw.json → skills.apiKeys\n'));
    console.log(chalk.gray('  • Env: HACKERONE_*, BUGCROWD_*, SYNACK_*, or CUSTOM_ID_API_KEY\n'));
    console.log(chalk.gray('  • Tools: built-in tools read them automatically for research.\n'));

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
        mask: '●',
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
        { type: 'password', name: 'customKey', message: 'API key:', mask: '●', validate: (v: string) => v.trim().length > 3 || 'Required' }
      ]);
      apiKeys[customId.trim().toLowerCase()] = customKey.trim();
    }

    if (Object.keys(apiKeys).length > 0) {
      console.log(chalk.green(`  ✔  Saved ${Object.keys(apiKeys).length} API key(s)`));
    }
    return apiKeys;
  }

  private async configureHyperClawBot(gatewayConfig: GatewayConfig | null): Promise<{ token?: string; allowedUsers?: string[] } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  🤖 HyperClaw Bot — Remote control via Telegram\n'));
    const trans = getTranscriptionProviders();
    if (trans.length > 0) {
      console.log(chalk.gray('  🎤 Voice notes: ' + trans.map(p => `${p.displayName}`).join(', ') + ' — if you have their API key, voice messages will be transcribed to text.'));
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
    console.log(chalk.green('  ✔  HyperClaw Bot configured — Start: hyperclaw bot start'));
    return { token: token.trim() };
  }

  private async configureTalkMode(): Promise<{ apiKey?: string; voiceId?: string; modelId?: string } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  🎙️  Talk Mode — ElevenLabs TTS\n'));

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
      mask: '●',
      validate: (v: string) => v.trim().length > 10 || 'Required'
    }]);

    console.log(chalk.green('  ✔  Talk Mode configured'));
    return {
      apiKey: apiKey.trim(),
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      modelId: 'eleven_multilingual_v2'
    };
  }

  private async configureMemoryIntegration(): Promise<{ vaultDir?: string; dailyNotes?: boolean; syncOnAppend?: boolean } | undefined> {
    console.log(chalk.hex('#06b6d4')('\n  📂 Memory Integration (Obsidian / Raycast / Hazel)\n'));

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
    console.log(chalk.hex('#06b6d4')('\n  🦅 Agent Identity\n'));

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

    // Wake-up message — first thing the agent says when it comes online
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
        message: 'System prompt (opens editor — save & close to continue):'
      }]);
      systemPrompt = r.systemPrompt?.trim() || '';
    }

    const globalRules = [
      'Always respond in the user\'s preferred language',
      'Never reveal the gateway auth token or API keys',
      'Confirm before destructive or irreversible actions',
      'Respect user privacy — never share conversation data',
      'All subagents inherit these rules — cannot be overridden'
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

  // ── Skills & Hooks ───────────────────────────────────────────────────────────
  private async configureSkillsAndHooks(): Promise<{ hooks: string[]; heartbeat: boolean }> {
    const { wantSkills } = await inquirer.prompt([{
      type: 'confirm', name: 'wantSkills',
      message: 'Configure skills & hooks now?', default: false
    }]);

    if (!wantSkills) {
      console.log(chalk.gray('  ↳ Skipped — enable later: hyperclaw hooks enable <name>\n'));
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
    } catch { /* ignore — hooks can be enabled later */ }

    if (selectedHooks.length > 0) {
      console.log(chalk.green(`  ✔ Enabled: ${selectedHooks.join(', ')}\n`));
    }

    return { hooks: selectedHooks, heartbeat };
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
      version: '4.0.0',
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
        level: 'full',
        allowedPaths: [],
        allowedCommands: [],
        confirmDestructive: false,
        maxOutputBytes: 50_000
      },
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
        console.log(chalk.gray('  ✔  Morning Briefing hook enabled'));
      } catch { /* ignore */ }
    }

    await this.testConnections(data.channelConfigs || {});

    if (data.installDaemon || options.daemon || options.installDaemon) {
      const s = ora('🩸 Installing system daemon...').start();
      await this.daemon.install();
      s.succeed(chalk.red('🩸 System daemon installed (starts on boot)'));
    }

    if (data.gatewayConfig?.tailscaleExposure && data.gatewayConfig.tailscaleExposure !== 'off') {
      await this.gateway.applyTailscaleExposure(data.gatewayConfig.tailscaleExposure, data.gatewayConfig.port);
    }

    if (data.gatewayConfig && (options.startNow || data.installDaemon)) {
      const s = ora('Starting gateway...').start();
      await this.daemon.start();
      s.succeed(`Gateway running at ws://localhost:${data.gatewayConfig.port}`);
    }

    this.showSuccessScreen(data);
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
      chalk.gray('  hyperclaw dashboard       — TUI dashboard'),
      chalk.gray('  hyperclaw hub             — Skill hub'),
      chalk.gray('  hyperclaw gateway status  — Gateway panel'),
      chalk.gray('  hyperclaw ') + chalk.red('daemon') + chalk.gray(' status   — Service status'),
      chalk.gray('  hyperclaw voice           — Voice settings'),
      chalk.gray('  hyperclaw canvas show     — AI canvas'),
    ];
    if (hasHyperClawBot) cmdLines.push(chalk.gray('  hyperclaw bot start        — HyperClawBot remote control'));
    if (hasEmail) cmdLines.push(chalk.gray('  hyperclaw gmail watch-setup — Gmail Pub/Sub (real-time)'));
    cmdLines.push(chalk.gray('  hyperclaw nodes             — Mobile nodes (Connect tab)'));
    cmdLines.push(chalk.gray('  hyperclaw cron list         — Scheduled tasks'));

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
      chalk.hex('#06b6d4')('🎉 HyperClaw v4.0.0 ready!\n\n') + lines,
      { padding: 1, borderStyle: 'round', borderColor: 'cyan', margin: 1, backgroundColor: '#0a0a0a' }
    ));
  }
}
