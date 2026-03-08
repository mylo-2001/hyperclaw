/**
 * src/cli/config.ts
 * ConfigStore — live config mutation + reload, secret scrubbing, key rotation.
 * HyperClaw live config plane (not just read — also writes & notifies gateway).
 */
import fs from 'fs-extra';
import chalk from 'chalk';
import { getHyperClawDir, getConfigPath } from '../infra/paths';
import { resolveChannelToken, getProviderCredentialAsync } from '../infra/env-resolve';

const getHC_DIR = () => getHyperClawDir();
const getCFG_FILE = () => getConfigPath();

// ─── Broadcast Groups ─────────────────────────────────────────────────────────

/**
 * Broadcast group configuration.
 * Keys are WhatsApp peer IDs (group JIDs or E.164 numbers for DMs).
 * Value is the array of agent IDs to run when a message arrives in that peer.
 * The special `strategy` key controls parallel vs sequential dispatch.
 */
export interface BroadcastConfig {
  /** How to dispatch to multiple agents. Default: "parallel" */
  strategy?: 'parallel' | 'sequential';
  /** peerId → agentId[] map */
  [peerId: string]: string[] | 'parallel' | 'sequential' | undefined;
}

// ─── Bindings ─────────────────────────────────────────────────────────────────

/** Peer match shape inside a binding rule. */
export interface BindingPeerMatch {
  kind: 'dm' | 'group' | 'channel';
  /** Exact peer/channel/room ID. "*" matches any. */
  id: string;
}

/** A single binding rule entry. */
export interface BindingRule {
  agentId: string;
  match: {
    /** Channel name (e.g. "whatsapp", "telegram", "slack"). "*" matches all. */
    channel?: string;
    /** Specific account ID on multi-account channels. "*" matches all. */
    accountId?: string;
    /** Peer (DM sender, group, or channel). */
    peer?: BindingPeerMatch;
    /** Discord guild ID. */
    guildId?: string;
    /** Slack team/workspace ID. */
    teamId?: string;
    /** Discord role IDs that must be present (all must match). */
    roles?: string[];
  };
}

// ─── Agents ───────────────────────────────────────────────────────────────────

/** Sandbox configuration for an agent or as the global default. */
export interface AgentSandboxConfig {
  /** Sandbox mode. "off" = never sandbox; "all" = always; "non-main" = only non-main sessions. */
  mode?: 'off' | 'all' | 'non-main';
  /** Container scope. "session" (one per session), "agent" (one per agent), "shared" (shared across agents). */
  scope?: 'session' | 'agent' | 'shared';
  workspaceRoot?: string;
  workspaceAccess?: 'read-only' | 'read-write';
  docker?: {
    image?: string;
    memoryLimit?: string;
    cpuLimit?: string;
    setupCommand?: string;
    env?: Record<string, string>;
  };
  browser?: {
    enabled?: boolean;
    headless?: boolean;
  };
  prune?: {
    onSessionEnd?: boolean;
    maxAgeSec?: number;
  };
}

/** Tool policy for an agent. */
export interface AgentToolPolicy {
  /** Named tool profile shortcut (e.g. "coding", "messaging"). */
  profile?: string;
  allow?: string[];
  deny?: string[];
  sandbox?: { tools?: { allow?: string[]; deny?: string[] } };
  elevated?: { enabled?: boolean; allowFrom?: string[] };
  byProvider?: Record<string, { profile?: string; allow?: string[]; deny?: string[] }>;
}

/** A single agent definition in agents.list. */
export interface AgentListItem {
  id: string;
  /** Human-readable display name. */
  name?: string;
  /** Agent workspace directory. */
  workspace?: string;
  /** Mark as default agent (used when no binding matches). */
  default?: boolean;
  /** Provider/model override for this agent. */
  model?: string;
  /** Per-agent sandbox config (overrides agents.defaults.sandbox). */
  sandbox?: AgentSandboxConfig;
  /** Per-agent tool policy (overrides global tools). */
  tools?: AgentToolPolicy;
  /** Agent-specific identity. */
  identity?: {
    name?: string;
    emoji?: string;
    systemPrompt?: string;
  };
}

/** Global agent defaults applied to all agents. */
export interface AgentDefaults {
  workspace?: string;
  sandbox?: AgentSandboxConfig;
  tools?: AgentToolPolicy;
}

/** Full agents configuration block. */
export interface AgentsConfig {
  defaults?: AgentDefaults;
  list?: AgentListItem[];
}

// ─── Session ──────────────────────────────────────────────────────────────────

export type DmScope =
  | 'main'
  | 'per-peer'
  | 'per-channel-peer'
  | 'per-account-channel-peer';

export interface SessionResetConfig {
  mode?: 'daily' | 'idle' | 'never';
  atHour?: number;
  idleMinutes?: number;
}

export interface SessionMaintenanceConfig {
  mode?: 'warn' | 'enforce';
  pruneAfter?: string;
  maxEntries?: number;
  rotateBytes?: string;
  resetArchiveRetention?: string;
  maxDiskBytes?: string;
  highWaterBytes?: string;
}

export interface SessionSendPolicyRule {
  action: 'allow' | 'deny';
  match: {
    channel?: string;
    chatType?: 'direct' | 'group' | 'channel';
    keyPrefix?: string;
    rawKeyPrefix?: string;
  };
}

export interface SessionConfig {
  /** How to isolate DM sessions. Default: "main". */
  dmScope?: DmScope;
  /** Main session key name. Default: "main". */
  mainKey?: string;
  /** Map of canonical identity → provider-prefixed peer IDs. */
  identityLinks?: Record<string, string[]>;
  /** Session reset policy. */
  reset?: SessionResetConfig;
  /** Per-type reset overrides. */
  resetByType?: {
    direct?: SessionResetConfig;
    group?: SessionResetConfig;
    thread?: SessionResetConfig;
  };
  /** Per-channel reset overrides. */
  resetByChannel?: Record<string, SessionResetConfig>;
  /** Extra reset trigger strings. */
  resetTriggers?: string[];
  /** Session store path (supports {agentId} template). */
  store?: string;
  /** Session maintenance settings. */
  maintenance?: SessionMaintenanceConfig;
  /** Message send policy rules. */
  sendPolicy?: {
    rules?: SessionSendPolicyRule[];
    default?: 'allow' | 'deny';
  };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export interface ToolsConfig {
  profile?: string;
  allow?: string[];
  deny?: string[];
  sandbox?: { tools?: { allow?: string[]; deny?: string[] } };
  elevated?: {
    enabled?: boolean;
    allowFrom?: string[];
  };
  byProvider?: Record<string, { profile?: string; allow?: string[]; deny?: string[] }>;
  subagents?: { tools?: { allow?: string[]; deny?: string[] } };
}

// ─── Main config ──────────────────────────────────────────────────────────────

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
    /** "local" = gateway runs on this host. "remote" = CLI/app connects to remote gateway (SSH tunnel or Tailscale) */
    mode?: 'local' | 'remote';
    /** Remote gateway connection (used when mode is "remote") */
    remote?: {
      url: string;        // e.g. "http://127.0.0.1:18789" (SSH tunnel) or "https://machine.tailnet.ts.net"
      token?: string;
      password?: string;
      tlsFingerprint?: string;  // pin remote TLS cert when using wss://
    };
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

  // ── Multi-agent ────────────────────────────────────────────────────────────

  /** Named agent definitions and shared defaults. */
  agents?: AgentsConfig;

  /**
   * Binding rules: maps inbound channel/account/peer → agentId.
   * Evaluated in order; first match wins.
   * Broadcast groups (broadcast key) take precedence when set.
   */
  bindings?: BindingRule[];

  /**
   * Broadcast groups: run multiple agents for the same peer simultaneously.
   * Keys are peer IDs (WhatsApp JIDs, E.164 DM numbers, etc.).
   * Current scope: WhatsApp (web channel).
   */
  broadcast?: BroadcastConfig;

  // ── Session ────────────────────────────────────────────────────────────────

  /** Session lifecycle, isolation, and maintenance settings. */
  session?: SessionConfig;

  // ── Tools ─────────────────────────────────────────────────────────────────

  /** Global tool policy (applied before agent-specific policies). */
  tools?: ToolsConfig & {
    /**
     * exec tool configuration.
     * Keys: backgroundMs, timeoutSec, cleanupMs, notifyOnExit, notifyOnExitEmptySuccess.
     */
    exec?: {
      /** Auto-background after this delay (ms). Default: 10000 */
      backgroundMs?: number;
      /** Kill process after this many seconds. Default: 1800 */
      timeoutSec?: number;
      /** TTL for finished sessions in memory (ms). Default: 1800000 */
      cleanupMs?: number;
      /** Enqueue system event when a backgrounded exec exits. Default: true */
      notifyOnExit?: boolean;
      /** Also notify on successful no-output exits. Default: false */
      notifyOnExitEmptySuccess?: boolean;
      /** Host exec mode: "sandbox" (default) | "gateway" | "deny" */
      host?: 'sandbox' | 'gateway' | 'deny';
      /** Security level: "ask" | "allow" | "deny" */
      security?: 'ask' | 'allow' | 'deny';
      /** Restrict apply_patch to workspace root only. Default: true */
      applyPatch?: { workspaceOnly?: boolean };
      /** Safe command bins allowed without exec approval */
      safeBins?: string[];
    };
    /** Filesystem access guardrails. */
    fs?: {
      /** Restrict read/write/edit to workspace root only. Default: false */
      workspaceOnly?: boolean;
    };
    /** Session visibility for session tools. */
    sessions?: {
      /** "self" | "tree" | "agent" | "all" */
      visibility?: 'self' | 'tree' | 'agent' | 'all';
    };
    /** Sub-agent delegation guardrails. */
    subagents?: {
      tools?: { allow?: string[]; deny?: string[] };
      allowAgents?: string[];
    };
  };
}

export class ConfigStore {

  /** Load raw config from disk (no hydration). Use for persistence to avoid writing resolved secrets back. */
  async loadRaw(): Promise<HyperClawConfig> {
    try {
      return (await fs.readJson(getCFG_FILE())) as HyperClawConfig;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return {};
      console.error('[config] Failed to load config:', e?.message ?? String(e));
      throw e; // H5: Don't return {} on parse error — callers get explicit failure
    }
  }

  /** Load config with env/credentials hydration for runtime use. Do NOT pass the result to save — use patch/save with explicit values only. */
  async load(): Promise<HyperClawConfig> {
    try {
      const cfg = await fs.readJson(getCFG_FILE()) as HyperClawConfig;
      // Apply env fallbacks for channel tokens (in-memory only; never persisted)
      if (cfg.channelConfigs) {
        for (const [chId, ch] of Object.entries(cfg.channelConfigs as Record<string, any>)) {
          const tok = resolveChannelToken(chId, ch?.token || ch?.botToken);
          if (tok && !ch?.token) (ch as any).token = tok;
          if (tok && !ch?.botToken) (ch as any).botToken = tok;
        }
      }
      // H-2: Hydrate provider.apiKey from CredentialsStore/AuthStore when missing (in-memory only)
      if (cfg.provider && !cfg.provider.apiKey) {
        const key = await getProviderCredentialAsync(cfg);
        if (key) (cfg.provider as any).apiKey = key;
      }
      return cfg;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return {};
      console.error('[config] Failed to load config:', e?.message ?? String(e));
      throw e; // H5: Don't return {} on parse error — callers get explicit failure
    }
  }

  async save(cfg: HyperClawConfig): Promise<void> {
    // H-8: Atomic write — write to temp file then rename so a crash mid-write
    // never leaves a partially-written (corrupt) hyperclaw.json behind.
    const target = getCFG_FILE();
    const tmp = target + '.tmp';
    await fs.ensureDir(getHC_DIR());
    await fs.writeJson(tmp, cfg, { spaces: 2 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, target);
  }

  /** Merge patch into raw config and save. Uses loadRaw() so hydrated secrets from env/store are never written back. */
  async patch(patch: Partial<HyperClawConfig>): Promise<void> {
    const raw = await this.loadRaw();
    await this.save(deepMerge(raw, patch) as HyperClawConfig);
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
    // C-6: Use safe defaults instead of non-null assertion — cfg.gateway may be
    // undefined on a fresh install (before `hyperclaw init` completes).
    const gwBase = cfg.gateway ?? { port: 18789, bind: '127.0.0.1', authToken: '', runtime: 'node' as const, enabledChannels: [], hooks: true, tailscaleExposure: 'off' as const };
    const channels = gwBase.enabledChannels ?? [];
    if (!channels.includes(channelId)) channels.push(channelId);
    const patch: Partial<HyperClawConfig> = {
      gateway: { ...gwBase, enabledChannels: channels }
    };
    if (channelConfig) {
      patch.channelConfigs = { ...cfg.channelConfigs, [channelId]: channelConfig };
    }
    await this.patch(patch);
    console.log(chalk.green(`  ✅ Channel enabled: ${channelId}`));
  }

  async disableChannel(channelId: string): Promise<void> {
    const cfg = await this.load();
    const gwBase = cfg.gateway ?? { port: 18789, bind: '127.0.0.1', authToken: '', runtime: 'node' as const, enabledChannels: [], hooks: true, tailscaleExposure: 'off' as const };
    const channels = (gwBase.enabledChannels ?? []).filter(c => c !== channelId);
    await this.patch({ gateway: { ...gwBase, enabledChannels: channels } });
    console.log(chalk.green(`  ✅ Channel disabled: ${channelId}`));
  }

  // ── Gateway ───────────────────────────────────────────────────────────────────

  async setGatewayPort(port: number): Promise<void> {
    const cfg = await this.load();
    const gwBase = cfg.gateway ?? { port: 18789, bind: '127.0.0.1', authToken: '', runtime: 'node' as const, enabledChannels: [], hooks: true, tailscaleExposure: 'off' as const };
    await this.patch({ gateway: { ...gwBase, port } });
  }

  async setGatewayBind(bind: string): Promise<void> {
    const cfg = await this.load();
    const gwBase = cfg.gateway ?? { port: 18789, bind: '127.0.0.1', authToken: '', runtime: 'node' as const, enabledChannels: [], hooks: true, tailscaleExposure: 'off' as const };
    await this.patch({ gateway: { ...gwBase, bind } });
  }

  async generateToken(): Promise<string> {
    const token = require('crypto').randomBytes(32).toString('base64url');
    const cfg = await this.load();
    const gwBase = cfg.gateway ?? { port: 18789, bind: '127.0.0.1', authToken: '', runtime: 'node' as const, enabledChannels: [], hooks: true, tailscaleExposure: 'off' as const };
    await this.patch({ gateway: { ...gwBase, authToken: token } });
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

// H-9: deepMerge intentionally REPLACES arrays (no concat) so that callers can
// clear a list by passing []. Keys with value `undefined` are skipped so partial
// patch objects never accidentally nullify existing fields.
function deepMerge(base: any, patch: any): any {
  const result = { ...base };
  for (const key of Object.keys(patch || {})) {
    if (patch[key] === undefined) continue; // skip — do not erase existing value
    if (patch[key] !== null && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      result[key] = deepMerge(base[key] || {}, patch[key]);
    } else {
      result[key] = patch[key]; // scalars and arrays are replaced, not merged
    }
  }
  return result;
}

function scrubSecrets(cfg: HyperClawConfig): any {
  const s = JSON.parse(JSON.stringify(cfg));
  // Single-provider key
  if (s.provider?.apiKey) s.provider.apiKey = '●●●●●●●●';
  // M-6: Multi-provider array keys (providers[].apiKey and providers[].apiKeys[])
  if (Array.isArray(s.providers)) {
    for (const p of s.providers) {
      if (p.apiKey) p.apiKey = '●●●●●●●●';
      if (Array.isArray(p.apiKeys)) p.apiKeys = p.apiKeys.map(() => '●●●●●●●●');
    }
  }
  // Gateway auth token + remote credentials
  if (s.gateway?.authToken) s.gateway.authToken = '●●●●●●●●';
  if (s.gateway?.remote?.token) s.gateway.remote.token = '●●●●●●●●';
  if (s.gateway?.remote?.password) s.gateway.remote.password = '●●●●●●●●';
  // Voice/talk mode API key
  if (s.talkMode?.apiKey) s.talkMode.apiKey = '●●●●●●●●';
  // Service/skill API keys
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
