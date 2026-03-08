/**
 * src/infra/api-key-validation.ts
 * M-5: API key format/prefix validation for known providers.
 * Returns an error message if invalid, null if valid or unknown provider.
 */

/** Prefix patterns for known providers (loose format check) */
const PROVIDER_PREFIXES: Record<string, string> = {
  anthropic: 'sk-ant-',
  'anthropic-setup-token': 'sk-ant-setup-',
  openai: 'sk-',
  openrouter: 'sk-or-',
  google: 'AIza',
  xai: 'xai-',
  tavily: 'tvly-',
  'opencode-zen': 'oc-',
  'vercel-ai': 'vercel_',
  groq: 'gsk_',
  perplexity: 'pplx-',
};

/** Minimum length per provider (provider may allow shorter, this is a sanity check) */
const MIN_LENGTH: Record<string, number> = {
  anthropic: 20,
  'anthropic-setup-token': 20,
  openai: 20,
  openrouter: 20,
  google: 20,
  xai: 20,
  tavily: 20,
  'opencode-zen': 10,
  'vercel-ai': 20,
  groq: 20,
};

/**
 * Validate API key format for a known provider.
 * @param providerId - Provider ID (e.g. anthropic, openrouter)
 * @param key - The API key to validate
 * @returns Error message if invalid, null if valid
 */
export function validateApiKeyFormat(providerId: string, key: string): string | null {
  const k = (key || '').trim();
  if (k.length < 8) return 'API key is too short';
  const pid = providerId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const prefix = PROVIDER_PREFIXES[pid];
  if (!prefix) return null; // Unknown provider: skip format check
  if (!k.startsWith(prefix)) {
    return `Expected key to start with "${prefix}" for ${providerId}. Double-check you copied the full key.`;
  }
  const min = MIN_LENGTH[pid];
  if (min && k.length < min) return `API key seems too short for ${providerId}`;
  return null;
}
