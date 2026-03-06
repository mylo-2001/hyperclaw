import chalk from 'chalk';

export interface ModelMeta {
  id: string;
  displayName: string;
  contextK: number;
  reasoning?: boolean;
  vision?: boolean;
  recommended?: boolean;
}

export interface Provider {
  id: string;
  displayName: string;
  authType: 'api_key' | 'oauth' | 'none';
  authLabel: string;
  authHint?: string;
  baseUrl?: string;
  models: ModelMeta[];
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    displayName: 'OpenRouter (Recommended)',
    authType: 'api_key',
    authLabel: 'OpenRouter API key',
    authHint: 'Get at openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openrouter/auto', displayName: 'Auto (best available)', contextK: 200, recommended: true },
      { id: 'anthropic/claude-opus-4-5', displayName: 'Claude Opus 4.5', contextK: 200, reasoning: true, vision: true },
      { id: 'anthropic/claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', contextK: 200, vision: true },
      { id: 'openai/gpt-4o', displayName: 'GPT-4o', contextK: 128, vision: true },
      { id: 'openai/o3-mini', displayName: 'o3-mini', contextK: 128, reasoning: true },
      { id: 'google/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextK: 1000, vision: true },
      { id: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', contextK: 128 },
      { id: 'mistralai/mixtral-8x22b', displayName: 'Mixtral 8x22B', contextK: 64 },
      { id: 'a21/jamba-large-1.7', displayName: 'Jamba Large 1.7', contextK: 256 },
      { id: 'xai/grok-3-mini', displayName: 'Grok 3 Mini', contextK: 131, reasoning: true },
    ]
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic (Direct)',
    authType: 'api_key',
    authLabel: 'Anthropic API key',
    authHint: 'Get at console.anthropic.com',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-opus-4-5-20251101', displayName: 'Claude Opus 4.5', contextK: 200, reasoning: true, vision: true, recommended: true },
      { id: 'claude-sonnet-4-5-20251101', displayName: 'Claude Sonnet 4.5', contextK: 200, vision: true },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', contextK: 200, vision: true },
    ]
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    authType: 'api_key',
    authLabel: 'OpenAI API key',
    authHint: 'Get at platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', displayName: 'GPT-4o', contextK: 128, vision: true, recommended: true },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', contextK: 128, vision: true },
      { id: 'o3-mini', displayName: 'o3-mini', contextK: 128, reasoning: true },
      { id: 'o1', displayName: 'o1', contextK: 200, reasoning: true, vision: true },
    ]
  },
  {
    id: 'google',
    displayName: 'Google AI',
    authType: 'api_key',
    authLabel: 'Google AI API key',
    authHint: 'Get at aistudio.google.com',
    models: [
      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextK: 1000, vision: true, recommended: true },
      { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', contextK: 2000, vision: true },
    ]
  },
  {
    id: 'xai',
    displayName: 'xAI (Grok)',
    authType: 'api_key',
    authLabel: 'xAI API key',
    authHint: 'Get at console.x.ai',
    models: [
      { id: 'grok-3', displayName: 'Grok 3', contextK: 131, vision: true, recommended: true },
      { id: 'grok-3-mini', displayName: 'Grok 3 Mini', contextK: 131, reasoning: true },
    ]
  },
  {
    id: 'cloudflare',
    displayName: 'Cloudflare AI Gateway',
    authType: 'api_key',
    authLabel: 'Cloudflare API token',
    authHint: 'Get at dash.cloudflare.com',
    models: [
      { id: 'cf/@cf/meta/llama-3.1-70b-instruct', displayName: 'Llama 3.1 70B (via CF)', contextK: 128, recommended: true },
    ]
  },
  {
    id: 'litelm',
    displayName: 'LiteLLM (Self-hosted)',
    authType: 'api_key',
    authLabel: 'LiteLLM proxy URL + key',
    authHint: 'Format: http://localhost:4000|sk-...',
    models: [
      { id: 'litellm/auto', displayName: 'Proxy auto-detect', contextK: 128, recommended: true },
    ]
  },
  {
    id: 'local',
    displayName: 'Local (Ollama / llama.cpp)',
    authType: 'none',
    authLabel: '',
    authHint: 'Make sure Ollama is running at localhost:11434',
    models: [
      { id: 'ollama/llama3', displayName: 'Llama 3 (Ollama)', contextK: 8, recommended: true },
      { id: 'ollama/mistral', displayName: 'Mistral (Ollama)', contextK: 8 },
      { id: 'ollama/phi3', displayName: 'Phi-3 (Ollama)', contextK: 128 },
    ]
  }
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export function formatModel(m: ModelMeta): string {
  const tags: string[] = [];
  if (m.recommended) tags.push(chalk.green('★'));
  if (m.reasoning) tags.push(chalk.magenta('reasoning'));
  if (m.vision) tags.push(chalk.blue('vision'));
  const ctx = m.contextK >= 1000 ? `${m.contextK}k ctx` : `${m.contextK}k ctx`;
  return `${m.displayName} ${chalk.gray(`(${ctx})`)} ${tags.join(' ')}`;
}
