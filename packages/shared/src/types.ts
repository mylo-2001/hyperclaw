/**
 * @hyperclaw/shared — shared types across all packages
 */

export type ProviderID = 'anthropic' | 'openrouter' | 'custom' | 'openai' | 'xai' | 'groq' | 'local' | 'ollama';
export type UpdateChannel = 'stable' | 'beta' | 'dev';
export type DmPolicy = 'allowlist' | 'open' | 'pairing';
export type SandboxMode = 'none' | 'non-main' | 'always';

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

export interface HyperClawAgentDefaults {
  name?: string;
  personality?: string;
  sandbox?: { mode: SandboxMode };
}

export interface HyperClawToolsConfig {
  allowlist?: string[];
  blocklist?: string[];
  dockerSandbox?: { enabled: boolean };
}

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
  agents?: { defaults?: HyperClawAgentDefaults };
  tools?: HyperClawToolsConfig;
  gateway?: HyperClawGatewayConfig;
  skills?: HyperClawSkillsConfig;
  update?: HyperClawUpdateConfig;
  moltbook?: HyperClawMoltbookConfig;
  clawTasks?: HyperClawClawTasksConfig;
}
