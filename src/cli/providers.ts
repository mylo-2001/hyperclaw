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
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextK: 200, reasoning: true, flagship: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextK: 200, reasoning: true },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextK: 200, fast: true },
      { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', contextK: 200, reasoning: true },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextK: 200 },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextK: 200 },
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', contextK: 200, reasoning: true },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextK: 200, fast: true },
    ]
  },
  {
    id: 'anthropic-oauth',
    displayName: '🎭 Anthropic (OAuth — Claude Code/Max)',
    authType: 'oauth',
    authLabel: 'Claude OAuth credentials',
    authHint: 'Reuses ~/.claude/.credentials.json (Claude Code CLI) or macOS Keychain "Claude Code-credentials"',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextK: 200, reasoning: true, flagship: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextK: 200, reasoning: true },
    ]
  },
  {
    id: 'anthropic-setup-token',
    displayName: '🎭 Anthropic (setup-token)',
    authType: 'api_key',
    authLabel: 'Anthropic setup-token',
    authHint: 'Run `claude setup-token` on any machine → paste the token here',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextK: 200, reasoning: true, flagship: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextK: 200, reasoning: true },
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
      { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (via Vercel)', contextK: 200 },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (via Vercel)', contextK: 1000, fast: true },
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
      // Auto-routing
      { id: 'openrouter/auto', name: 'Auto (best available)', contextK: 200, flagship: true },
      // Anthropic — verified OpenRouter slugs
      { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5', contextK: 200, reasoning: true },
      { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextK: 200 },
      { id: 'anthropic/claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', contextK: 200, reasoning: true },
      { id: 'anthropic/claude-3-5-haiku', name: 'Claude 3.5 Haiku', contextK: 200, fast: true },
      // OpenAI — verified slugs
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextK: 128, vision: true },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', contextK: 128, fast: true },
      { id: 'openai/o3-mini', name: 'o3-mini (reasoning)', contextK: 200, reasoning: true, fast: true },
      // Google — verified slugs
      { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro', contextK: 1000, reasoning: true },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', contextK: 1000, fast: true },
      // xAI — verified slug
      { id: 'x-ai/grok-3', name: 'Grok 3', contextK: 131, reasoning: true },
      // DeepSeek — verified slug
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', contextK: 64, reasoning: true },
      { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3', contextK: 64 },
      // Meta Llama — verified slug
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextK: 128 },
      // Mistral — verified slug
      { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', contextK: 128 },
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
      // GPT-5 series
      { id: 'gpt-5.2', name: 'GPT-5.2', contextK: 1000, vision: true, flagship: true },
      { id: 'gpt-5.1', name: 'GPT-5.1', contextK: 1000, vision: true },
      { id: 'gpt-5', name: 'GPT-5', contextK: 1000, vision: true },
      // GPT-4 series
      { id: 'gpt-4.1', name: 'GPT-4.1', contextK: 1000, vision: true },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextK: 1000, fast: true },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextK: 1000, fast: true },
      { id: 'gpt-4o', name: 'GPT-4o', contextK: 128, vision: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextK: 128, fast: true },
      // Reasoning
      { id: 'o4-mini', name: 'o4-mini (reasoning)', contextK: 200, reasoning: true, fast: true },
      { id: 'o3', name: 'o3 (reasoning)', contextK: 200, reasoning: true },
      { id: 'o3-mini', name: 'o3-mini (reasoning)', contextK: 200, reasoning: true, fast: true },
      { id: 'o1', name: 'o1 (reasoning)', contextK: 200, reasoning: true },
      { id: 'o1-mini', name: 'o1-mini (reasoning)', contextK: 128, reasoning: true, fast: true },
      // Codex
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (code)', contextK: 1000 },
      { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex (code)', contextK: 1000 },
      { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex (code)', contextK: 1000 },
      { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max (code)', contextK: 1000 },
      { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini (code)', contextK: 1000, fast: true },
      { id: 'gpt-5-codex', name: 'GPT-5 Codex (code)', contextK: 1000 },
    ]
  },
  {
    id: 'google',
    displayName: '🔍 Google',
    authType: 'api_key',
    authLabel: 'Google AI API Key',
    authHint: 'aistudio.google.com/app/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    supportsTranscription: true,  // Voice transcription uses native generateContent endpoint, not OpenAI-compat baseUrl
    models: [
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (preview)', contextK: 1000, reasoning: true, flagship: true },
      { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image (preview)', contextK: 1000, vision: true },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (preview)', contextK: 1000, fast: true },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextK: 1000, reasoning: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextK: 1000, fast: true },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (free)', contextK: 1000, fast: true },
      { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro TTS (audio)', contextK: 1000 },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (free)', contextK: 1000, fast: true },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite (free)', contextK: 1000, fast: true },
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
      { id: 'grok-4', name: 'Grok 4', contextK: 256, reasoning: true, flagship: true },
      { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast (reasoning)', contextK: 256, reasoning: true, fast: true },
      { id: 'grok-3', name: 'Grok 3', contextK: 131, reasoning: true },
      { id: 'grok-3-fast', name: 'Grok 3 Fast', contextK: 131, fast: true },
      { id: 'grok-imagine-image', name: 'Grok Imagine (image gen)', contextK: 1 },
    ]
  },
  {
    id: 'minimax',
    displayName: '🎯 MiniMax',
    authType: 'api_key',
    authLabel: 'MiniMax API Key',
    authHint: 'platform.minimax.io (international) or minimaxi.com (CN)',
    baseUrl: 'https://api.minimax.io/v1',
    models: [
      { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextK: 1000, flagship: true },
      { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', contextK: 1000, fast: true },
      { id: 'MiniMax-M2.1', name: 'MiniMax M2.1', contextK: 1000 },
      { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax M2.1 Highspeed', contextK: 1000, fast: true },
      { id: 'MiniMax-M2', name: 'MiniMax M2', contextK: 1000 },
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
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking (reasoning)', contextK: 128, reasoning: true, flagship: true },
      { id: 'kimi-k2-thinking-turbo', name: 'Kimi K2 Thinking Turbo', contextK: 128, reasoning: true, fast: true },
      { id: 'kimi-k2-0905-preview', name: 'Kimi K2 (Sep 2025 preview)', contextK: 128 },
      { id: 'kimi-k2-0711-preview', name: 'Kimi K2 (Jul 2025 preview)', contextK: 128 },
      { id: 'kimi-k2-turbo-preview', name: 'Kimi K2 Turbo (preview)', contextK: 128, fast: true },
      { id: 'kimi-latest', name: 'Kimi Latest', contextK: 128 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', contextK: 128 },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K', contextK: 32, fast: true },
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', contextK: 8, fast: true },
    ]
  },
  {
    id: 'qwen',
    displayName: '🐉 Qwen (Alibaba)',
    authType: 'api_key',
    authLabel: 'DashScope API Key',
    authHint: 'dashscope-intl.aliyuncs.com (international)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', contextK: 128, flagship: true, reasoning: true },
      { id: 'qwen3-235b-a22b-thinking', name: 'Qwen3 235B Thinking', contextK: 128, reasoning: true },
      { id: 'qwen3-235b-a22b-instruct', name: 'Qwen3 235B Instruct', contextK: 128 },
      { id: 'qwen-max-latest', name: 'Qwen Max (latest)', contextK: 32 },
      { id: 'qwen-plus-latest', name: 'Qwen Plus (latest)', contextK: 128 },
      { id: 'qwen-turbo-latest', name: 'Qwen Turbo (latest)', contextK: 128, fast: true },
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus (code)', contextK: 128 },
      { id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash (code)', contextK: 128, fast: true },
      { id: 'qwen3-vl-plus', name: 'Qwen3 VL Plus (vision)', contextK: 128, vision: true },
      { id: 'qwen3-vl-flash', name: 'Qwen3 VL Flash (vision)', contextK: 128, vision: true, fast: true },
      { id: 'qwen2.5-72b-instruct', name: 'Qwen2.5 72B Instruct', contextK: 128 },
    ]
  },
  {
    id: 'zai',
    displayName: '🔧 Z.AI (Zhipu GLM)',
    authType: 'api_key',
    authLabel: 'Z.AI API Key',
    authHint: 'api.z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: [
      { id: 'glm-5', name: 'GLM-5', contextK: 128, flagship: true },
      { id: 'glm-4.7', name: 'GLM-4.7', contextK: 128 },
      { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', contextK: 128, fast: true },
      { id: 'glm-4.7-flashx', name: 'GLM-4.7 FlashX', contextK: 128, fast: true },
      { id: 'glm-4.6', name: 'GLM-4.6', contextK: 128 },
      { id: 'glm-4.5', name: 'GLM-4.5', contextK: 128 },
      { id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextK: 128 },
      { id: 'glm-4.5-x', name: 'GLM-4.5 X', contextK: 128 },
      { id: 'glm-4.5-airx', name: 'GLM-4.5 AirX', contextK: 128 },
      { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash', contextK: 128, fast: true },
      { id: 'glm-4-32b-0414-128k', name: 'GLM-4 32B 128K', contextK: 128 },
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
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Copilot)', contextK: 200 },
    ]
  },
  {
    id: 'groq',
    displayName: '⚡ Groq (Fast Inference)',
    authType: 'api_key',
    authLabel: 'Groq API Key',
    authHint: 'console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    supportsTranscription: true,  // Whisper models
    models: [
      { id: 'groq/compound', name: 'Groq Compound', contextK: 128, flagship: true },
      { id: 'groq/compound-mini', name: 'Groq Compound Mini', contextK: 128, fast: true },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', contextK: 128 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', contextK: 128, fast: true },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', contextK: 128 },
      { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B (via Groq)', contextK: 128 },
      { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B (via Groq)', contextK: 128, fast: true },
      { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (via Groq)', contextK: 128, reasoning: true },
      { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 (via Groq)', contextK: 128 },
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
      { id: 'mistral-large-2512', name: 'Mistral Large (Dec 2025)', contextK: 128, flagship: true },
      { id: 'magistral-medium-2507', name: 'Magistral Medium (reasoning)', contextK: 128, reasoning: true },
      { id: 'magistral-small-2507', name: 'Magistral Small (reasoning)', contextK: 128, reasoning: true, fast: true },
      { id: 'mistral-small-2506', name: 'Mistral Small (Jun 2025)', contextK: 128, fast: true },
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
      { id: 'sonar-deep-research', name: 'Sonar Deep Research', contextK: 128, reasoning: true, flagship: true },
      { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', contextK: 128, reasoning: true },
      { id: 'sonar-pro', name: 'Sonar Pro (search)', contextK: 200 },
      { id: 'sonar', name: 'Sonar (search, fast)', contextK: 128, fast: true },
    ]
  },
  {
    id: 'cohere',
    displayName: '🧬 Cohere',
    authType: 'api_key',
    authLabel: 'Cohere API Key',
    authHint: 'dashboard.cohere.com/api-keys',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    models: [
      { id: 'command-a-03-2025', name: 'Command A (Mar 2025)', contextK: 256, flagship: true },
      { id: 'command-a-vision-07-2025', name: 'Command A Vision (Jul 2025)', contextK: 256, vision: true },
    ]
  },
  {
    id: 'huggingface',
    displayName: '🤗 Hugging Face',
    authType: 'api_key',
    authLabel: 'HuggingFace API Token',
    authHint: 'huggingface.co/settings/tokens',
    baseUrl: 'https://router.huggingface.co/v1',
    models: [
      // Qwen series
      { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', name: 'Qwen3 Coder 480B (code)', contextK: 128, flagship: true },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextK: 128 },
      // Llama
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextK: 128 },
      // Mistral
      { id: 'mistralai/Mistral-7B-Instruct-v0.3', name: 'Mistral 7B', contextK: 32, fast: true },
      // Other notable models
      { id: 'zai-org/GLM-4.5', name: 'GLM-4.5', contextK: 128 },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextK: 128 },
      // Manual entry — use full repo ID (e.g. "org/model-name")
      // Optional suffixes: :hf-inference :groq :cerebras :fastest :cheapest
      { id: '__manual__', name: 'Enter full repo ID (e.g. org/model-name)', contextK: 128 },
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
