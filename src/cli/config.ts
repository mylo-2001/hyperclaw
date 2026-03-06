/**
 * src/cli/config.ts
 * ConfigStore — live config mutation + reload, secret scrubbing, key rotation.
 * HyperClaw live config plane (not just read — also writes & notifies gateway).
 */
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { getHyperClawDir, getConfigPath } from '../infra/paths';
import { resolveChannelToken } from '../infra/env-resolve';

const getHC_DIR = () => getHyperClawDir();
const getCFG_FILE = () => getConfigPath();

export interface HyperClawConfig {
  workspaceName?: string;
  version?: string;
  provider?: {
    providerId: string;
    apiKey?: string;
    modelId?: string;
    baseUrl?: string;
  };
  /** All configured providers (multi-provider support). First entry = primary. */
  providers?: Array<{
    providerId: string;
    apiKey?: string;
    /** Extra API keys for rotation/failover — gateway cycles through them on rate limit */
    apiKeys?: string[];
    modelId?: string;
    baseUrl?: string;
    /** Extended thinking / reasoning config (Anthropic, OpenAI o-series) */
    thinking?: { enabled: boolean; budgetTokens: number };
  }>;
  gateway?: {
    port: number;
    bind: string;
    authToken: string;
    tailscaleExposure: 'off' | 'serve' | 'funnel';
    runtime: 'node' | 'bun' | 'deno';
    enabledChannels: string[];
    hooks: boolean;
    /** SSH reverse tunnel for remote access (alternative to Tailscale) */
    sshTunnel?: { enabled: boolean; host: string; user: string; remotePort: number };
  };
  /** Docker sandboxing for group chat sessions */
  groupSandbox?: {
    enabled: boolean;
    image?: string;
    memoryLimit?: string;
  };
  channelConfigs?: Record<string, any>;
  pcAccess?: {
    enabled: boolean;
    level: 'read-only' | 'sandboxed' | 'full';
    allowedPaths: string[];
    allowedCommands: string[];
    confirmDestructive: boolean;
    maxOutputBytes: number;
  };
  channels?: string[];
  enabledHooks?: string[];
  identity?: {
    agentName?: string;
    userName?: string;
    language?: string;
    wakeWord?: string;
    /** First message the agent sends to channels when it comes online */
    wakeUpMessage?: string;
    /** Custom system prompt / instructions prepended to every conversation */
    systemPrompt?: string;
    personality?: string;
    rules?: string[];
  };
  memoryIntegration?: {
    vaultDir?: string;
    dailyNotes?: boolean;
    syncOnAppend?: boolean;
  };
  skills?: {
    installed: string[];
    vtApiKey?: string;
    /** API keys for any app (HackerOne, Bugcrowd, Synack, custom). Tools read these automatically. */
    apiKeys?: Record<string, string>;
  };
  talkMode?: {
    apiKey?: string;
    voiceId?: string;
    modelId?: string;
  };
  hatchMode?: string;
  updateChannel?: 'stable' | 'beta' | 'dev';
  rateLimit?: { maxPerMinute?: number; maxPerHour?: number };
  installedAt?: string;
}

export class ConfigStore {

  async load(): Promise<HyperClawConfig> {
    try {
      const cfg = await fs.readJson(getCFG_FILE());
      // Apply env fallbacks for channel tokens
      if (cfg.channelConfigs) {
        for (const [chId, ch] of Object.entries(cfg.channelConfigs as Record<string, any>)) {
          const tok = resolveChannelToken(chId, ch?.token || ch?.botToken);
          if (tok && !ch?.token) (ch as any).token = tok;
          if (tok && !ch?.botToken) (ch as any).botToken = tok;
        }
      }
      return cfg;
    } catch { return {}; }
  }

  async save(cfg: HyperClawConfig): Promise<void> {
    await fs.ensureDir(getHC_DIR());
    await fs.writeJson(getCFG_FILE(), cfg, { spaces: 2 });
    await fs.chmod(getCFG_FILE(), 0o600);
  }

  async patch(patch: Partial<HyperClawConfig>): Promise<void> {
    const current = await this.load();
    await this.save(deepMerge(current, patch) as HyperClawConfig);
  }

  // ── Provider ─────────────────────────────────────────────────────────────────

  async setProviderKey(providerId: string, apiKey: string): Promise<void> {
    const cfg = await this.load();
    await this.patch({ provider: { ...cfg.provider, providerId, apiKey } as any });
    console.log(chalk.green(`  ✅ API key saved for ${providerId}`));
  }

  async setModel(modelId: string): Promise<void> {
    const cfg = await this.load();
    await this.patch({ provider: { ...cfg.provider, modelId } as any });
    console.log(chalk.green(`  ✅ Model: ${modelId}`));
  }

  async setServiceApiKey(serviceId: string, apiKey: string): Promise<void> {
    const cfg = await this.load();
    const apiKeys = { ...(cfg.skills?.apiKeys || {}), [serviceId]: apiKey };
    await this.patch({ skills: { ...cfg.skills, installed: cfg.skills?.installed || [], apiKeys } as any });
    console.log(chalk.green(`  ✅ Service API key saved for ${serviceId}`));
  }

  // ── Channels ──────────────────────────────────────────────────────────────────

  async enableChannel(channelId: string, channelConfig?: any): Promise<void> {
    const cfg = await this.load();
    const channels = cfg.gateway?.enabledChannels || [];
    if (!channels.includes(channelId)) channels.push(channelId);
    const patch: Partial<HyperClawConfig> = {
      gateway: { ...cfg.gateway!, enabledChannels: channels }
    };
    if (channelConfig) {
      patch.channelConfigs = { ...cfg.channelConfigs, [channelId]: channelConfig };
    }
    await this.patch(patch);
    console.log(chalk.green(`  ✅ Channel enabled: ${channelId}`));
  }

  async disableChannel(channelId: string): Promise<void> {
    const cfg = await this.load();
    const channels = (cfg.gateway?.enabledChannels || []).filter(c => c !== channelId);
    await this.patch({ gateway: { ...cfg.gateway!, enabledChannels: channels } });
    console.log(chalk.green(`  ✅ Channel disabled: ${channelId}`));
  }

  // ── Gateway ───────────────────────────────────────────────────────────────────

  async setGatewayPort(port: number): Promise<void> {
    const cfg = await this.load();
    await this.patch({ gateway: { ...cfg.gateway!, port } });
  }

  async setGatewayBind(bind: string): Promise<void> {
    const cfg = await this.load();
    await this.patch({ gateway: { ...cfg.gateway!, bind } });
  }

  async generateToken(): Promise<string> {
    const token = require('crypto').randomBytes(32).toString('base64url');
    const cfg = await this.load();
    await this.patch({ gateway: { ...cfg.gateway!, authToken: token } });
    return token;
  }

  // ── Display ───────────────────────────────────────────────────────────────────

  async show(scrub = true): Promise<void> {
    const cfg = await this.load();
    const display = scrub ? scrubSecrets(cfg) : cfg;

    console.log(chalk.bold.cyan('\n  🦅 HYPERCLAW CONFIGURATION\n'));
    printSection('Provider', display.provider);
    printSection('Gateway', display.gateway);
    printSection('Identity', display.identity);
    printSection('PC Access', display.pcAccess);

    if (display.channelConfigs && Object.keys(display.channelConfigs).length > 0) {
      console.log(chalk.bold.white('  Channel Configs:'));
      for (const [ch, v] of Object.entries(display.channelConfigs)) {
        const scrubbed = scrubChannelConfig(v as any);
        console.log(`    ${chalk.cyan(ch)}: ${JSON.stringify(scrubbed).slice(0, 80)}`);
      }
      console.log();
    }

    if (display.skills?.installed?.length) {
      console.log(chalk.bold.white('  Skills:'));
      display.skills.installed.forEach(s => console.log(`    • ${s}`));
      console.log();
    }

    console.log(chalk.gray(`  Config file: ${getCFG_FILE()}`));
    console.log();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deepMerge(base: any, patch: any): any {
  const result = { ...base };
  for (const key of Object.keys(patch || {})) {
    if (patch[key] !== null && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      result[key] = deepMerge(base[key] || {}, patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
}

function scrubSecrets(cfg: HyperClawConfig): any {
  const s = JSON.parse(JSON.stringify(cfg));
  if (s.provider?.apiKey) s.provider.apiKey = '●●●●●●●●';
  if (s.gateway?.authToken) s.gateway.authToken = s.gateway.authToken ? '●●●●●●●●' : '(none)';
  if (s.skills?.apiKeys) {
    const keys = Object.keys(s.skills.apiKeys);
    s.skills.apiKeys = Object.fromEntries(keys.map(k => [k, '●●●●●●●●']));
  }
  return s;
}

function scrubChannelConfig(ch: any): any {
  const s = { ...ch };
  const secretFields = ['token', 'accessToken', 'apiKey', 'appSecret', 'appPassword',
    'signingSecret', 'channelSecret', 'secretKey', 'password', 'verifyToken'];
  for (const f of secretFields) {
    if (s[f]) s[f] = '●●●●●●●●';
  }
  return s;
}

function printSection(label: string, data: any): void {
  if (!data || Object.keys(data).length === 0) return;
  console.log(chalk.bold.white(`  ${label}:`));
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      console.log(`    ${chalk.gray(k)}: ${(v as any[]).join(', ') || '(none)'}`);
    } else {
      console.log(`    ${chalk.gray(k)}: ${v}`);
    }
  }
  console.log();
}

export { ConfigStore as ConfigManager };
