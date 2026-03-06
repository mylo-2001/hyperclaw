/**
 * src/infra/api-keys-guide.ts
 * Setup steps for known API keys — hyperclaw auth add / config set-key
 * When a user adds a known service, we show them step-by-step instructions.
 */

export interface ApiKeyGuide {
  serviceId: string;
  name: string;
  setupSteps: string[];
  url?: string;
  envVar?: string;
}

export const API_KEYS_GUIDE: ApiKeyGuide[] = [
  {
    serviceId: 'anthropic',
    name: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    url: 'platform.anthropic.com',
    setupSteps: [
      '1. Go to platform.anthropic.com → API Keys.',
      '2. Sign up / sign in with an Anthropic account.',
      '3. Create Key — copy it (starts with sk-ant-). Not shown again!',
      '',
      '  🔗 platform.anthropic.com/settings/keys'
    ]
  },
  {
    serviceId: 'openai',
    name: 'OpenAI (GPT)',
    envVar: 'OPENAI_API_KEY',
    url: 'platform.openai.com',
    setupSteps: [
      '1. Go to platform.openai.com → API keys.',
      '2. Create new secret key — copy it (starts with sk-). Not shown again!',
      '3. You need billing enabled for production use.',
      '',
      '  🔗 platform.openai.com/api-keys'
    ]
  },
  {
    serviceId: 'openrouter',
    name: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    url: 'openrouter.ai',
    setupSteps: [
      '1. Go to openrouter.ai → Keys.',
      '2. Sign in (Google/GitHub).',
      '3. Create Key — copy it. OpenRouter provides access to many models (Claude, GPT etc.).',
      '',
      '  🔗 openrouter.ai/keys'
    ]
  },
  {
    serviceId: 'tavily',
    name: 'Tavily (Web Search)',
    envVar: 'TAVILY_API_KEY',
    url: 'tavily.com',
    setupSteps: [
      '1. Go to tavily.com → Sign up.',
      '2. Dashboard → API Keys → Create API Key.',
      '3. Copy the key. Used for the web-search skill.',
      '',
      '  🔗 app.tavily.com'
    ]
  },
  {
    serviceId: 'elevenlabs',
    name: 'ElevenLabs (TTS)',
    envVar: 'ELEVENLABS_API_KEY',
    url: 'elevenlabs.io',
    setupSteps: [
      '1. Go to elevenlabs.io → Profile → API Key.',
      '2. Copy the API key (or create a new one).',
      '3. Used for talk mode (voice responses).',
      '',
      '  🔗 elevenlabs.io/app/settings/api-keys'
    ]
  },
  {
    serviceId: 'deepl',
    name: 'DeepL (Translation)',
    envVar: 'DEEPL_API_KEY',
    url: 'deepl.com',
    setupSteps: [
      '1. Go to deepl.com/pro-api → Get API key.',
      '2. Sign up (free tier available).',
      '3. Account → API keys — copy the Authentication Key.',
      '',
      '  🔗 deepl.com/pro-api'
    ]
  },
  {
    serviceId: 'github',
    name: 'GitHub (PAT)',
    envVar: 'GITHUB_TOKEN',
    url: 'github.com',
    setupSteps: [
      '1. GitHub → Settings → Developer settings → Personal access tokens.',
      '2. Generate new token (classic or fine-grained).',
      '3. Select scopes: repo, read:user etc. depending on use case.',
      '',
      '  🔗 github.com/settings/tokens'
    ]
  },
  {
    serviceId: 'xai',
    name: 'xAI (Grok)',
    envVar: 'XAI_API_KEY',
    url: 'x.ai',
    setupSteps: [
      '1. Go to console.x.ai → API keys.',
      '2. Sign in and create a new key.',
      '3. Copy the key.',
      '',
      '  🔗 console.x.ai'
    ]
  },
  {
    serviceId: 'google',
    name: 'Google AI (Gemini)',
    envVar: 'GOOGLE_AI_API_KEY',
    url: 'ai.google.dev',
    setupSteps: [
      '1. Go to aistudio.google.com/apikey.',
      '2. Get API key or Create API key.',
      '3. Copy the key.',
      '',
      '  🔗 aistudio.google.com/apikey'
    ]
  }
];

const SERVICE_ID_MAP = new Map(API_KEYS_GUIDE.map(g => [g.serviceId.toLowerCase(), g]));

/** Known name aliases (e.g. anthropic, claude -> anthropic) */
const ALIASES: Record<string, string> = {
  claude: 'anthropic',
  gpt: 'openai',
  xai: 'xai',
  google: 'google'
};

export function getApiKeyGuide(serviceId: string): ApiKeyGuide | null {
  const id = serviceId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return SERVICE_ID_MAP.get(id) ?? SERVICE_ID_MAP.get(ALIASES[id] ?? '') ?? null;
}

/** For unknown services — generic API key instructions */
export const GENERIC_API_KEY_STEPS = [
  'For an unknown service:',
  '1. Go to the official service website (e.g. developers.xxx.com).',
  '2. Sign up / sign in. An account is usually required.',
  '3. Look for "API Keys", "Credentials", "Developer" or "Integrations" section.',
  '4. Create a new API key or token. Copy it immediately — many services do not show it again.',
  '5. Keep it secret — do not share it or commit it to a repo.',
  '',
  '  💡 Known services: anthropic, openai, openrouter, tavily, elevenlabs, deepl, github, xai, google'
];
