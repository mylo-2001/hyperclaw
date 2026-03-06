/**
 * src/infra/env-resolve.ts
 * Resolve config values from env fallbacks. All .env.example vars are wired here.
 */

const CHANNEL_ENV: Record<string, string> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  discord: 'DISCORD_BOT_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
};

export function resolveGatewayToken(authTokenFromConfig: string): string {
  return authTokenFromConfig || process.env.HYPERCLAW_GATEWAY_TOKEN || '';
}

export function resolveProviderApiKey(
  cfg: { provider?: { providerId?: string; apiKey?: string } } | null
): string {
  if (!cfg) return '';
  const key = cfg.provider?.apiKey;
  if (key) return key;
  const pid = cfg.provider?.providerId || 'openrouter';
  switch (pid) {
    case 'openrouter': return process.env.OPENROUTER_API_KEY || '';
    case 'anthropic': return process.env.ANTHROPIC_API_KEY || '';
    case 'openai': return process.env.OPENAI_API_KEY || '';
    case 'xai': return process.env.XAI_API_KEY || '';
    case 'google': return process.env.GOOGLE_AI_API_KEY || '';
    case 'custom': return '';  // custom uses only config apiKey, no env fallback
    default: return process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  }
}

/** Resolve API key or OAuth access token (async). Use this when provider.authType may be 'oauth'. */
export async function getProviderCredentialAsync(
  cfg: { provider?: { providerId?: string; apiKey?: string; authType?: 'api_key' | 'oauth'; oauthTokenPath?: string } } | null
): Promise<string> {
  if (!cfg?.provider) return '';
  if ((cfg.provider as any).authType === 'oauth') {
    const { getProviderCredentialAsync: getOAuth } = await import('../services/oauth-provider');
    return getOAuth(cfg);
  }
  return resolveProviderApiKey(cfg);
}

const SERVICE_ENV: Record<string, string> = {
  hackerone: 'HACKERONE_API_USERNAME',   // HackerOne uses username:token
  'hackerone-token': 'HACKERONE_API_TOKEN',
  bugcrowd: 'BUGCROWD_API_TOKEN',
  synack: 'SYNACK_API_TOKEN',
};

/** Resolve API key for a service (bug bounty, research apps, etc.). Config first, then env. */
export function resolveServiceApiKey(
  serviceId: string,
  cfg: { skills?: { apiKeys?: Record<string, string> } } | null
): string {
  const key = cfg?.skills?.apiKeys?.[serviceId];
  if (key) return key;
  const envKey = SERVICE_ENV[serviceId] || `${serviceId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  return process.env[envKey] || process.env[envKey.replace(/-/g, '_')] || '';
}

export function resolveChannelToken(channelId: string, tokenFromConfig?: string): string {
  if (tokenFromConfig) return tokenFromConfig;
  const envKey = CHANNEL_ENV[channelId] || `${channelId.toUpperCase().replace(/-/g, '_')}_BOT_TOKEN`;
  return process.env[envKey] || process.env[`${channelId.toUpperCase()}_BOT_TOKEN`] || '';
}
