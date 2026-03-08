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
    displayName: '🎭 Anthropic (API Key)',
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
    id: 'anthropic-oauth',
    displayName: '🎭 Anthropic (OAuth — Claude Code/Max)',
    authType: 'oauth',
    authLabel: 'Claude OAuth credentials',
    authHint: 'Reuses ~/.claude/.credentials.json (Claude Code CLI) or macOS Keychain "Claude Code-credentials"',
    models: [
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextK: 200, reasoning: true, flagship: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextK: 200, reasoning: true },
    ]
  },
  {
    id: 'anthropic-setup-token',
    displayName: '🎭 Anthropic (setup-token)',
    authType: 'api_key',
    authLabel: 'Anthropic setup-token',
    authHint: 'Run `claude setup-token` on any machine → paste the token here',
    models: [
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextK: 200, reasoning: true, flagship: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextK: 200, reasoning: true },
    ]
  },
  {
    id: 'vercel-ai',
    displayName: '▲ Vercel AI Gateway',
    authType: 'api_key',
    authLabel: 'Vercel AI Gateway API Key',
    authHint: 'vercel.com/docs/ai — multi-model proxy (AI_GATEWAY_API_KEY)',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    models: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (via Vercel)', contextK: 128, flagship: true },
      { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet (via Vercel)', contextK: 200 },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash (via Vercel)', contextK: 1000, fast: true },
    ]
  },
  {
    id: 'opencode-zen',
    displayName: '🧘 OpenCode Zen (multi-model proxy)',
    authType: 'api_key',
    authLabel: 'OpenCode Zen API Key',
    authHint: 'opencode.ai/auth — OPENCODE_API_KEY',
    baseUrl: 'https://api.opencode.ai/v1',
    models: [
      { id: 'auto', name: 'Auto (best available)', contextK: 200, flagship: true },
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
    baseUrl: 'https://api.openai.com/v1',
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
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
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
    baseUrl: 'https://api.x.ai/v1',
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
    baseUrl: 'https://api.minimaxi.chat/v1',
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
    baseUrl: 'https://api.moonshot.cn/v1',
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
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
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
    id: 'groq',
    displayName: '⚡ Groq (Fast Inference)',
    authType: 'api_key',
    authLabel: 'Groq API Key',
    authHint: 'console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', contextK: 128, flagship: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', contextK: 128, fast: true },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextK: 32 },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B', contextK: 8, fast: true },
    ]
  },
  {
    id: 'mistral',
    displayName: '🌀 Mistral AI',
    authType: 'api_key',
    authLabel: 'Mistral API Key',
    authHint: 'console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', contextK: 128, flagship: true },
      { id: 'mistral-medium-latest', name: 'Mistral Medium', contextK: 128 },
      { id: 'mistral-small-latest', name: 'Mistral Small', contextK: 128, fast: true },
      { id: 'codestral-latest', name: 'Codestral (code)', contextK: 256 },
    ]
  },
  {
    id: 'deepseek',
    displayName: '🔬 DeepSeek',
    authType: 'api_key',
    authLabel: 'DeepSeek API Key',
    authHint: 'platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', contextK: 64, flagship: true },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 (reasoning)', contextK: 64, reasoning: true },
    ]
  },
  {
    id: 'perplexity',
    displayName: '🔍 Perplexity (Search-augmented)',
    authType: 'api_key',
    authLabel: 'Perplexity API Key',
    authHint: 'perplexity.ai/settings/api',
    baseUrl: 'https://api.perplexity.ai',
    models: [
      { id: 'sonar-pro', name: 'Sonar Pro (search)', contextK: 200, flagship: true },
      { id: 'sonar', name: 'Sonar (search, fast)', contextK: 128, fast: true },
      { id: 'sonar-reasoning', name: 'Sonar Reasoning', contextK: 128, reasoning: true },
    ]
  },
  {
    id: 'huggingface',
    displayName: '🤗 Hugging Face',
    authType: 'api_key',
    authLabel: 'HuggingFace API Token',
    authHint: 'huggingface.co/settings/tokens',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    models: [
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextK: 128, flagship: true },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextK: 128 },
      { id: 'mistralai/Mistral-7B-Instruct-v0.3', name: 'Mistral 7B', contextK: 32, fast: true },
    ]
  },
  {
    id: 'ollama',
    displayName: '🦙 Ollama (Local)',
    authType: 'none',
    authLabel: 'No API key needed',
    authHint: 'ollama.ai — run `ollama serve` first',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3.3', name: 'Llama 3.3 (local)', contextK: 128, flagship: true },
      { id: 'mistral', name: 'Mistral (local)', contextK: 32 },
      { id: 'codellama', name: 'CodeLlama (local)', contextK: 16 },
      { id: 'phi4', name: 'Phi-4 (local)', contextK: 16, fast: true },
      { id: '__manual__', name: 'Enter model name manually', contextK: 128 },
    ]
  },
  {
    id: 'lmstudio',
    displayName: '🖥️ LM Studio (Local)',
    authType: 'none',
    authLabel: 'No API key needed',
    authHint: 'lmstudio.ai — enable local server in app',
    baseUrl: 'http://localhost:1234/v1',
    models: [{ id: '__manual__', name: 'Enter loaded model ID', contextK: 128, flagship: true }],
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
