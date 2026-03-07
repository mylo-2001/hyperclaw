/**
 * src/agent/engine.ts
 * Unified Agent Engine — single entry point for AI logic.
 * Memory, skills, tools, sessions, routing under one surface.
 */

import path from 'path';
import fs from 'fs-extra';
import { getHyperClawDir, getConfigPath } from '../../../shared/src/index';
import type { HyperClawConfig } from '../../../shared/src/index';
import type { Tool } from './inference';

export interface AgentEngineOptions {
  sessionId?: string;
  source?: string;
  elevated?: boolean;
  transcript?: Array<{ role: string; content: string }>;
  onToken?: (token: string) => void;
  onDone?: (text: string) => void;
  onThinking?: (thought: string) => void;
  onToolCall?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: string) => void;
  onRunEnd?: (usage?: { input: number; output: number; cacheRead?: number }, error?: string) => void;
  daemonMode?: boolean;
  /** Thinking budget (tokens) for extended thinking (Anthropic). 0 = disabled. */
  thinkingBudget?: number;
  /** Override model from config */
  modelOverride?: string;
  /** Override workspace directory for context */
  workspace?: string;
}

export interface AgentEngineResult {
  text: string;
  error?: string;
  usage?: { input: number; output: number; cacheRead?: number };
}

const CHANNEL_SOURCES = ['telegram', 'discord', 'whatsapp', 'slack', 'signal', 'matrix', 'line', 'nostr', 'feishu', 'msteams', 'teams', 'instagram', 'messenger', 'twitter', 'viber', 'zalo'];

/**
 * Load workspace context: SOUL, AGENTS, MEMORY + custom .md
 */
export async function loadWorkspaceContext(hcDir?: string): Promise<string> {
  const dir = hcDir || getHyperClawDir();
  let context = '';
  const core = ['SOUL.md', 'AGENTS.md', 'MEMORY.md'];
  for (const f of core) {
    const fp = path.join(dir, f);
    if (fs.pathExistsSync(fp)) context += `## ${f}\n${fs.readFileSync(fp, 'utf8')}\n\n`;
  }
  try {
    const entries = fs.readdirSync(dir) as string[];
    for (const f of entries) {
      if (f.endsWith('.md') && !core.includes(f)) {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).isFile()) context += `## ${f}\n${fs.readFileSync(fp, 'utf8')}\n\n`;
      }
    }
  } catch {}
  return context;
}

/**
 * Load skills context (bundled + workspace)
 */
export async function loadSkillsContext(): Promise<string> {
  const { loadSkills, buildSkillsContext } = await import('./skill-loader');
  const skills = await loadSkills();
  return skills.length > 0 ? buildSkillsContext(skills) : '';
}

/**
 * Resolve tools with policy, PC access, elevation.
 */
export async function resolveTools(opts: {
  config: HyperClawConfig;
  source?: string;
  elevated?: boolean;
  sessionId?: string;
  daemonMode?: boolean;
  activeServer?: unknown;
}): Promise<Tool[]> {
  const { config, source, elevated, sessionId, daemonMode, activeServer } = opts;
  const cfg = config;

  // PC access: sandbox for channel sources unless elevated
  const sandboxNonMain = cfg?.agents?.defaults?.sandbox?.mode === 'non-main'
    && source && CHANNEL_SOURCES.includes(source);
  const { loadPCAccessConfig, getPCAccessTools } = await import('./pc-access');
  const pcCfg = await loadPCAccessConfig({ daemonMode });
  const dockerSandbox = cfg?.tools?.dockerSandbox?.enabled === true;
  const pcTools = (pcCfg.enabled && (!sandboxNonMain || elevated))
    ? getPCAccessTools({ dockerSandbox }) : [];

  // Sessions tools
  const { getSessionsTools } = await import('./sessions-tools');
  const sessionsTools = getSessionsTools(() => activeServer ?? null, sessionId);

  // Assemble all tools
  const { InferenceEngine, getBuiltinTools } = await import('./inference');
  const { getSubAgentTools } = await import('./sub-agent-tools');
  const { getBrowserTools } = await import('./browser-tools');
  const { getExtractionTools } = await import('./extraction-tools');
  const { getWebsiteWatchTools } = await import('./website-watch-tools');
  const { getVisionTools } = await import('./vision-tools');
  const { getBountyTools } = await import('./bounty-tools');
  const { loadMCPTools } = await import('../../../../src/services/mcp-loader');
  const { applyToolPolicy } = await import('../../../../src/infra/tool-policy');

  const CUSTOM_BASEURL_PROVIDERS = new Set(['groq','mistral','deepseek','perplexity','huggingface','ollama','lmstudio','local','xai','openai','google','minimax','moonshot','qwen','zai','litellm','cloudflare','copilot','vercel-ai','opencode-zen']);
  const isLocal = cfg?.provider?.providerId === 'local' || cfg?.provider?.providerId === 'ollama' || cfg?.provider?.providerId === 'lmstudio';
  const provider = cfg?.provider?.providerId === 'anthropic' || cfg?.provider?.providerId === 'anthropic-oauth' || cfg?.provider?.providerId === 'anthropic-setup-token' ? 'anthropic'
    : (cfg?.provider?.providerId === 'custom' || isLocal || CUSTOM_BASEURL_PROVIDERS.has(cfg?.provider?.providerId ?? '')) ? 'custom' : 'openrouter';
  const visionProvider: 'anthropic' | 'openrouter' = (cfg?.provider?.providerId === 'custom' || isLocal) ? 'openrouter' : (provider === 'anthropic' ? 'anthropic' : 'openrouter');
  const apiKey = await (await import('../../../../src/infra/env-resolve')).getProviderCredentialAsync(cfg);
  const visionTools = getVisionTools({ apiKey: apiKey || '', provider: visionProvider });
  const bountyTools = getBountyTools(cfg);

  let skillInvokeTools: Tool[] = [];
  try {
    const { loadSkills } = await import('./skill-loader');
    const { getSkillInvokeTools } = await import('./skill-runtime');
    const loaded = await loadSkills();
    skillInvokeTools = getSkillInvokeTools(loaded);
  } catch {}

  let allTools: Tool[] = [
    ...getBuiltinTools(),
    ...getSubAgentTools(),
    ...sessionsTools,
    ...pcTools,
    ...getBrowserTools(),
    ...getExtractionTools(),
    ...getWebsiteWatchTools(),
    ...visionTools,
    ...bountyTools,
    ...skillInvokeTools
  ];

  try {
    const mcpTools = await loadMCPTools();
    if (mcpTools.length > 0) allTools = [...allTools, ...mcpTools];
  } catch {}

  const policyConfig = (cfg?.tools ? {
    profile: (cfg.tools as { profile?: string }).profile,
    allow: (cfg.tools as { allow?: string[] }).allow ?? (cfg.tools as { allowlist?: string[] }).allowlist,
    deny: (cfg.tools as { deny?: string[] }).deny ?? (cfg.tools as { blocklist?: string[] }).blocklist,
    byProvider: (cfg.tools as { byProvider?: Record<string, { profile?: string; allow?: string[]; deny?: string[] }> }).byProvider
  } : undefined) as Parameters<typeof applyToolPolicy>[1];
  let tools = applyToolPolicy(allTools, policyConfig, {
    provider: cfg?.provider?.providerId === 'anthropic' ? 'anthropic' : 'openrouter',
    model: cfg?.provider?.modelId
  });

  const { applyDestructiveGate } = await import('../../../../src/infra/destructive-gate');
  tools = applyDestructiveGate(tools, { elevated: elevated ?? false, source, sessionId });

  return tools;
}

/**
 * Run agent: context + tools + inference.
 */
export async function runAgentEngine(
  message: string,
  opts: AgentEngineOptions & { activeServer?: unknown; appendTranscript?: (sid: string, role: string, content: string) => void }
): Promise<AgentEngineResult> {
  const cfg: HyperClawConfig = await fs.readJson(getConfigPath()).catch(() => ({}));
  const CUSTOM_BASEURL_IDS = new Set(['groq','mistral','deepseek','perplexity','huggingface','ollama','lmstudio','local','xai','openai','google','minimax','moonshot','qwen','zai','litellm','cloudflare','copilot','vercel-ai','opencode-zen']);
  const isLocalProvider = cfg?.provider?.providerId === 'local' || cfg?.provider?.providerId === 'ollama' || cfg?.provider?.providerId === 'lmstudio';
  const apiKey = await (await import('../../../../src/infra/env-resolve')).getProviderCredentialAsync(cfg);
  if (!apiKey && !isLocalProvider) {
    return { text: 'No API key configured. Run: hyperclaw config set-key', error: 'no_api_key' };
  }

  // Resolve baseUrl from providers registry (for Groq, Mistral, DeepSeek, etc.)
  const { getProvider } = await import('../../../../src/cli/providers');
  const providerMeta = getProvider(cfg?.provider?.providerId ?? '');
  const registryBaseUrl = providerMeta?.baseUrl;

  const sid = opts.sessionId;
  if (sid && opts.appendTranscript) opts.appendTranscript(sid, 'user', message);

  // Build context
  let context = await loadWorkspaceContext(opts.workspace);
  try {
    const { getContextSummary } = await import('../../../../src/services/knowledge-graph');
    const kg = await getContextSummary(25);
    if (kg) context += kg + '\n\n';
  } catch {}
  context += await loadSkillsContext();

  const serviceKeys = cfg?.skills?.apiKeys ? Object.keys(cfg.skills.apiKeys) : [];
  if (serviceKeys.length > 0) {
    context += `\n## Service API Keys (configured)\nAvailable for research/skills: ${serviceKeys.join(', ')}. Use hackerone_list_programs, bugcrowd_list_programs, synack_list_targets when applicable, or create_skill for custom integrations.\n\n`;
  }

  const tools = await resolveTools({
    config: cfg,
    source: opts.source,
    elevated: opts.elevated,
    sessionId: sid,
    daemonMode: opts.daemonMode,
    activeServer: opts.activeServer
  });

  const rawModel = opts.modelOverride || cfg?.provider?.modelId || 'claude-sonnet-4-5';
  const isLocal2 = cfg?.provider?.providerId === 'local' || cfg?.provider?.providerId === 'ollama' || cfg?.provider?.providerId === 'lmstudio';
  const model = rawModel.startsWith('ollama/') ? rawModel.slice(7) : rawModel;
  const isAnthropicVariant = cfg?.provider?.providerId === 'anthropic' || cfg?.provider?.providerId === 'anthropic-oauth' || cfg?.provider?.providerId === 'anthropic-setup-token';
  const provider: 'anthropic' | 'openrouter' | 'custom' | 'openai' = isAnthropicVariant ? 'anthropic'
    : (cfg?.provider?.providerId === 'custom' || isLocal2 || CUSTOM_BASEURL_IDS.has(cfg?.provider?.providerId ?? '')) ? 'custom' : 'openrouter';
  const resolvedBaseUrl = cfg?.provider?.baseUrl || registryBaseUrl || (isLocal2 ? 'http://localhost:11434/v1' : undefined);
  const ollamaBaseUrl = isLocal2 ? (cfg?.provider?.baseUrl || 'http://localhost:11434/v1') : undefined;
  const thinkingBudget = opts.thinkingBudget ?? 0;
  const maxTokens = thinkingBudget > 0 ? thinkingBudget + 4096 : 4096;

  try {
    const { InferenceEngine } = await import('./inference');
    const engineOpts = {
      model, apiKey, provider,
      system: context || undefined,
      tools,
      maxTokens,
      onToken: opts.onToken ?? (() => {}),
      onThinking: opts.onThinking,
      onToolCall: opts.onToolCall,
      onToolResult: opts.onToolResult,
      ...(provider === 'custom' ? { baseUrl: ollamaBaseUrl || resolvedBaseUrl || '' } : {}),
      ...(thinkingBudget > 0 && (model.includes('claude') || model.includes('anthropic'))
        ? { thinking: { budget_tokens: thinkingBudget } } : {})
    };
    const engine = new InferenceEngine(engineOpts);
    const result = await engine.run([{ role: 'user', content: message }]);
    const text = result.text || '(empty)';

    if (sid && opts.appendTranscript) opts.appendTranscript(sid, 'assistant', text);

    // Auto memory extraction
    try {
      const { AutoMemory } = await import('./memory-auto');
      const mem = new AutoMemory({ extractEveryNTurns: 1 });
      mem.addTurn('user', message);
      mem.addTurn('assistant', text);
      await mem.extract();
    } catch {}

    opts.onDone?.(text);
    opts.onRunEnd?.(result.usage);
    return { text, usage: result.usage };
  } catch (e: any) {
    const errText = `Error: ${e.message}`;
    opts.onDone?.(errText);
    opts.onRunEnd?.(undefined, e.message);
    return { text: errText, error: e.message };
  }
}
