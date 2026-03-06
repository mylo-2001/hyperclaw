/**
 * src/infra/api-keys-guide.ts
 * Setup steps for known API keys — hyperclaw auth add / config set-key
 * Όταν κάποιος προσθέτει υπηρεσία που γνωρίζουμε, του δείχνουμε βήμα-βήμα τι να κάνει.
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
      '1. Πήγαινε στο platform.anthropic.com → API Keys.',
      '2. Sign up / sign in με λογαριασμό Anthropic.',
      '3. Create Key — αντιγράψε το (ξεκινά με sk-ant-). Δεν εμφανίζεται ξανά!',
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
      '1. Πήγαινε στο platform.openai.com → API keys.',
      '2. Create new secret key — αντιγράψε το (ξεκινά με sk-). Δεν εμφανίζεται ξανά!',
      '3. Χρειάζεσαι billing enabled για παραγωγή.',
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
      '1. Πήγαινε στο openrouter.ai → Keys.',
      '2. Sign in (Google/GitHub).',
      '3. Create Key — αντιγράψε το. OpenRouter επιτρέπει πρόσβαση σε πολλά models (Claude, GPT κ.λπ.).',
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
      '1. Πήγαινε στο tavily.com → Sign up.',
      '2. Dashboard → API Keys → Create API Key.',
      '3. Αντιγράψε το key. Χρησιμοποιείται για skill web-search.',
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
      '1. Πήγαινε στο elevenlabs.io → Profile → API Key.',
      '2. Αντιγράψε το API key (ή δημιούργησε νέο).',
      '3. Χρησιμοποιείται για talk mode (φωνή σε απάντηση).',
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
      '1. Πήγαινε στο deepl.com/pro-api → Get API key.',
      '2. Sign up (free tier διαθέσιμο).',
      '3. Account → API keys — αντιγράψε το Authentication Key.',
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
      '2. Generate new token (classic ή fine-grained).',
      '3. Επιλογή scopes: repo, read:user κ.λπ. ανάλογα με χρήση.',
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
      '1. Πήγαινε στο console.x.ai → API keys.',
      '2. Sign in και δημιούργησε νέο key.',
      '3. Αντιγράψε το key.',
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
      '1. Πήγαινε στο aistudio.google.com/apikey.',
      '2. Get API key ή Create API key.',
      '3. Αντιγράψε το key.',
      '',
      '  🔗 aistudio.google.com/apikey'
    ]
  }
];

const SERVICE_ID_MAP = new Map(API_KEYS_GUIDE.map(g => [g.serviceId.toLowerCase(), g]));

/** Γνωστές παραλλαγές ονομάτων (π.χ. anthropic, claude -> anthropic) */
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

/** Όταν η υπηρεσία δεν είναι γνωστή — οδηγίες για custom API keys */
export const GENERIC_API_KEY_STEPS = [
  'Για άγνωστη υπηρεσία:',
  '1. Πήγαινε στην επίσημη σελίδα της υπηρεσίας (π.χ. developers.xxx.com).',
  '2. Sign up / sign in. Συνήθως χρειάζεται λογαριασμός.',
  '3. Ψάξε για "API Keys", "Credentials", "Developer" ή "Integrations" section.',
  '4. Δημιούργησε νέο API key ή token. Αντιγράψε το αμέσως — πολλές υπηρεσίες δεν το δείχνουν ξανά.',
  '5. Κράτα το μυστικό — μην το μοιράζεσαι ή το ανεβάζεις σε repo.',
  '',
  '  💡 Γνωστές: anthropic, openai, openrouter, tavily, elevenlabs, deepl, github, xai, google'
];
