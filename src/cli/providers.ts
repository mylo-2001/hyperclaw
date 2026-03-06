/**
 * src/cli/providers.ts
 * Provider registry — all supported AI providers + model metadata.
 * Mirrors OpenClaw's provider abstraction layer.
 */
import chalk from 'chalk';

export interface ModelMeta {
  id: string;
  name: string;
  contextK: number;       // context window in K tokens
  reasoning?: boolean;    // has chain-of-thought / reasoning mode
  vision?: boolean;
  fast?: boolean;
  flagship?: boolean;
}

export interface Provider {
  id: string;
  displayName: string;
  authType: 'api_key' | 'oauth' | 'none';
  authLabel: string;
  authHint?: string;
  baseUrl?: string;
  models: ModelMeta[];
  /** Supports voice note transcription (speech-to-text). Shown in wizard. */
  supportsTranscription?: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    displayName: '🎭 Anthropic',
    authType: 'api_key',
    authLabel: 'Anthropic API Key',
    authHint: 'console.anthropic.com → API Keys',
    models: [
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextK: 200, reasoning: true, flagship: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextK: 200, reasoning: true },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextK: 200, fast: true },
    ]
  },
  {
    id: 'openrouter',
    displayName: '🌐 OpenRouter',
    authType: 'api_key',
    authLabel: 'OpenRouter API Key',
    authHint: 'openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    supportsTranscription: true,  // routes to OpenAI/Google
    models: [
      { id: 'openrouter/auto', name: 'Auto (best available)', contextK: 200, flagship: true },
      { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6 (via OR)', contextK: 200, reasoning: true },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (via OR)', contextK: 200 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextK: 128, vision: true },
      { id: 'openai/o3', name: 'o3 (reasoning)', contextK: 200, reasoning: true },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextK: 1000, fast: true },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextK: 1000, reasoning: true },
      { id: 'x-ai/grok-3', name: 'Grok 3', contextK: 131, reasoning: true },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', contextK: 64, reasoning: true },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextK: 128 },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', contextK: 128 },
      { id: 'mistralai/mistral-large', name: 'Mistral Large', contextK: 128 },
    ]
  },
  {
    id: 'openai',
    displayName: '🧠 OpenAI',
    authType: 'api_key',
    authLabel: 'OpenAI API Key',
    authHint: 'platform.openai.com/api-keys',
    supportsTranscription: true,  // Whisper API
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextK: 128, vision: true, flagship: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextK: 128, fast: true },
      { id: 'o3', name: 'o3 (reasoning)', contextK: 200, reasoning: true },
      { id: 'o4-mini', name: 'o4-mini (reasoning)', contextK: 200, reasoning: true, fast: true },
    ]
  },
  {
    id: 'google',
    displayName: '🔍 Google',
    authType: 'api_key',
    authLabel: 'Google AI API Key',
    authHint: 'aistudio.google.com/app/apikey',
    supportsTranscription: true,  // Gemini multimodal audio
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextK: 1000, reasoning: true, flagship: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextK: 1000, fast: true },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextK: 2000 },
    ]
  },
  {
    id: 'xai',
    displayName: '⚡ xAI (Grok)',
    authType: 'api_key',
    authLabel: 'xAI API Key',
    authHint: 'console.x.ai',
    models: [
      { id: 'grok-3', name: 'Grok 3', contextK: 131, reasoning: true, flagship: true },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', contextK: 131, fast: true },
    ]
  },
  {
    id: 'minimax',
    displayName: '🎯 MiniMax',
    authType: 'api_key',
    authLabel: 'MiniMax API Key',
    authHint: 'platform.minimaxi.com',
    models: [
      { id: 'MiniMax-Text-01', name: 'MiniMax Text-01', contextK: 1000, flagship: true },
      { id: 'abab6.5s-chat', name: 'ABAB 6.5S', contextK: 245 },
    ]
  },
  {
    id: 'moonshot',
    displayName: '🌙 Moonshot (Kimi)',
    authType: 'api_key',
    authLabel: 'Moonshot API Key',
    authHint: 'platform.moonshot.cn',
    models: [
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', contextK: 128, flagship: true },
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', contextK: 8, fast: true },
    ]
  },
  {
    id: 'qwen',
    displayName: '🐉 Qwen (Alibaba)',
    authType: 'api_key',
    authLabel: 'DashScope API Key',
    authHint: 'dashscope.aliyuncs.com',
    models: [
      { id: 'qwen-max', name: 'Qwen Max', contextK: 32, flagship: true },
      { id: 'qwen-plus', name: 'Qwen Plus', contextK: 128 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', contextK: 128, fast: true },
      { id: 'qwen3-235b-a22b', name: 'Qwen3 235B', contextK: 32, reasoning: true },
    ]
  },
  {
    id: 'zai',
    displayName: '🔧 Z.AI',
    authType: 'api_key',
    authLabel: 'Z.AI API Key',
    authHint: 'z.ai',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextK: 128, flagship: true },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextK: 128, fast: true },
    ]
  },
  {
    id: 'litellm',
    displayName: '🔀 LiteLLM (proxy)',
    authType: 'api_key',
    authLabel: 'LiteLLM Master Key',
    authHint: 'Your self-hosted LiteLLM proxy key',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (via proxy)', contextK: 128, flagship: true },
    ]
  },
  {
    id: 'cloudflare',
    displayName: '☁️  Cloudflare AI Gateway',
    authType: 'api_key',
    authLabel: 'Cloudflare API Token',
    authHint: 'dash.cloudflare.com → AI → Gateway',
    models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (CF)', contextK: 128, flagship: true },
    ]
  },
  {
    id: 'copilot',
    displayName: '🤖 GitHub Copilot',
    authType: 'oauth',
    authLabel: 'GitHub OAuth Token',
    authHint: 'github.com/settings/tokens',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Copilot)', contextK: 128, flagship: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet (Copilot)', contextK: 200 },
    ]
  },
  {
    id: 'custom',
    displayName: '🔌 Custom (OpenAI-compatible API)',
    authType: 'api_key',
    authLabel: 'API Key',
    authHint: 'Any OpenAI-compatible /chat/completions API (e.g. Ads Power, Proxies, new LLM APIs)',
    models: [{ id: '__manual__', name: 'Enter model ID manually', contextK: 128, flagship: true }],
  },
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find(p => p.id === id);
}

/** Providers that support voice note transcription. Shown in wizard. */
export function getTranscriptionProviders(): Provider[] {
  return PROVIDERS.filter(p => p.supportsTranscription);
}

export function formatModel(m: ModelMeta): string {
  const badges: string[] = [];
  if (m.flagship) badges.push(chalk.yellow('★'));
  if (m.reasoning) badges.push(chalk.magenta('reasoning'));
  if (m.fast) badges.push(chalk.green('fast'));
  if (m.vision) badges.push(chalk.cyan('vision'));
  const ctx = m.contextK >= 1000 ? `${m.contextK}K` : `${m.contextK}K`;
  return `${badges.join(' ')} ${m.name} ${chalk.gray(`ctx ${ctx}`)}`.trim();
}
