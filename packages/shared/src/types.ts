/**
 * @hyperclaw/shared — shared types across all packages
 */

export type ProviderID =
  | 'anthropic' | 'anthropic-oauth' | 'anthropic-setup-token'
  | 'openrouter' | 'openai' | 'custom'
  | 'xai' | 'groq' | 'mistral' | 'deepseek' | 'perplexity' | 'huggingface'
  | 'google' | 'minimax' | 'moonshot' | 'qwen' | 'zai'
  | 'litellm' | 'cloudflare' | 'copilot' | 'vercel-ai' | 'opencode-zen'
  | 'ollama' | 'lmstudio' | 'local';
export type UpdateChannel = 'stable' | 'beta' | 'dev';
export type DmPolicy = 'allowlist' | 'open' | 'pairing' | 'disabled';
export type SandboxMode = 'off' | 'all' | 'non-main';
export type SandboxScope = 'session' | 'agent' | 'shared';
export type DmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
export type BroadcastStrategy = 'parallel' | 'sequential';

export interface HyperClawProvider {
  providerId: ProviderID;
  modelId: string;
  baseUrl?: string;
}

export interface HyperClawChannel {
  id: string;
  type: string;
  enabled: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  token?: string;
}

// ─── Sandbox & Tools ──────────────────────────────────────────────────────────

export interface SandboxDockerConfig {
  image?: string;
  memoryLimit?: string;
  cpuLimit?: string;
  setupCommand?: string;
  env?: Record<string, string>;
}

export interface AgentSandboxConfig {
  mode?: SandboxMode;
  scope?: SandboxScope;
  workspaceRoot?: string;
  workspaceAccess?: 'read-only' | 'read-write';
  docker?: SandboxDockerConfig;
  browser?: { enabled?: boolean; headless?: boolean };
  prune?: { onSessionEnd?: boolean; maxAgeSec?: number };
}

export interface AgentToolPolicy {
  profile?: string;
  allow?: string[];
  deny?: string[];
  sandbox?: { tools?: { allow?: string[]; deny?: string[] } };
  elevated?: { enabled?: boolean; allowFrom?: string[] };
  byProvider?: Record<string, { profile?: string; allow?: string[]; deny?: string[] }>;
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export interface AgentListItem {
  id: string;
  name?: string;
  workspace?: string;
  default?: boolean;
  model?: string;
  sandbox?: AgentSandboxConfig;
  tools?: AgentToolPolicy;
  identity?: { name?: string; emoji?: string; systemPrompt?: string };
}

export interface HyperClawAgentDefaults {
  name?: string;
  workspace?: string;
  personality?: string;
  sandbox?: AgentSandboxConfig;
  tools?: AgentToolPolicy;
}

export interface AgentsConfig {
  defaults?: HyperClawAgentDefaults;
  list?: AgentListItem[];
}

// ─── Bindings ─────────────────────────────────────────────────────────────────

export interface BindingPeerMatch {
  kind: 'dm' | 'group' | 'channel';
  id: string;
}

export interface BindingRule {
  agentId: string;
  match: {
    channel?: string;
    accountId?: string;
    peer?: BindingPeerMatch;
    guildId?: string;
    teamId?: string;
    roles?: string[];
  };
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

export interface BroadcastConfig {
  strategy?: BroadcastStrategy;
  [peerId: string]: string[] | BroadcastStrategy | undefined;
}

// ─── Session ──────────────────────────────────────────────────────────────────

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

export interface SessionConfig {
  dmScope?: DmScope;
  mainKey?: string;
  identityLinks?: Record<string, string[]>;
  reset?: SessionResetConfig;
  resetByType?: { direct?: SessionResetConfig; group?: SessionResetConfig; thread?: SessionResetConfig };
  resetByChannel?: Record<string, SessionResetConfig>;
  resetTriggers?: string[];
  store?: string;
  maintenance?: SessionMaintenanceConfig;
  sendPolicy?: {
    rules?: Array<{ action: 'allow' | 'deny'; match: { channel?: string; chatType?: string; keyPrefix?: string; rawKeyPrefix?: string } }>;
    default?: 'allow' | 'deny';
  };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export interface HyperClawToolsConfig {
  profile?: string;
  allow?: string[];
  deny?: string[];
  /** Legacy fields */
  allowlist?: string[];
  blocklist?: string[];
  dockerSandbox?: { enabled: boolean };
  sandbox?: { tools?: { allow?: string[]; deny?: string[] } };
  elevated?: { enabled?: boolean; allowFrom?: string[] };
  byProvider?: Record<string, { profile?: string; allow?: string[]; deny?: string[] }>;
  subagents?: { tools?: { allow?: string[]; deny?: string[] } };
}

// ─── Top-level config ─────────────────────────────────────────────────────────

export interface HyperClawGatewayConfig {
  port?: number;
  token?: string;
  tailscale?: { enabled: boolean; hostname?: string };
}

export interface HyperClawSkillsConfig {
  apiKeys?: Record<string, string>;
}

export interface HyperClawUpdateConfig {
  channel?: UpdateChannel;
}

export interface HyperClawMoltbookConfig {
  apiUrl?: string;
}

export interface HyperClawClawTasksConfig {
  apiUrl?: string;
}

/** Full configuration shape for ~/.hyperclaw/hyperclaw.json */
export interface HyperClawConfig {
  provider?: HyperClawProvider;
  channels?: HyperClawChannel[];
  /** Named agents + shared defaults. */
  agents?: AgentsConfig;
  /** Binding rules: channel/peer → agentId. Evaluated in order; first match wins. */
  bindings?: BindingRule[];
  /** Broadcast groups: run multiple agents for the same peer. */
  broadcast?: BroadcastConfig;
  /** Session lifecycle and isolation settings. */
  session?: SessionConfig;
  tools?: HyperClawToolsConfig;
  gateway?: HyperClawGatewayConfig;
  skills?: HyperClawSkillsConfig;
  update?: HyperClawUpdateConfig;
  moltbook?: HyperClawMoltbookConfig;
  clawTasks?: HyperClawClawTasksConfig;
}
