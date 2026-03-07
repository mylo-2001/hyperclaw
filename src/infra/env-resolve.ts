/**
 * src/infra/env-resolve.ts
 * Resolve config values from env fallbacks. All .env.example vars are wired here.
 *
 * Path environment variables (processed by packages/shared/src/paths.ts):
 *   HYPERCLAW_HOME        Override base home dir (default: ~/). Used to compute ~/.hyperclaw.
 *   HYPERCLAW_STATE_DIR   Override entire state dir (default: ~/.hyperclaw).
 *   HYPERCLAW_CONFIG_PATH Override config file path (default: ~/.hyperclaw/hyperclaw.json).
 *
 * Gateway environment variables:
 *   HYPERCLAW_GATEWAY_TOKEN   Gateway WebSocket auth token.
 *   HYPERCLAW_PORT            Default gateway port (fallback, config takes precedence).
 *
 * Provider keys (resolved by resolveProviderApiKey):
 *   ANTHROPIC_API_KEY    OPENAI_API_KEY    OPENROUTER_API_KEY    XAI_API_KEY    GOOGLE_AI_API_KEY
 *
 * Channel tokens (resolved by resolveChannelToken):
 *   TELEGRAM_BOT_TOKEN    DISCORD_BOT_TOKEN    SLACK_BOT_TOKEN
 *   (others: <CHANNEL_ID_UPPER>_BOT_TOKEN)
 *
 * Service / skill keys:
 *   HACKERONE_API_USERNAME  HACKERONE_API_TOKEN  BUGCROWD_API_TOKEN  SYNACK_API_TOKEN
 *   (others: <SERVICE_ID_UPPER>_API_KEY)
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

// ── Path env helpers ─────────────────────────────────────────────────────────

/**
 * Returns a summary of active path environment overrides.
 * Useful for `hyperclaw health -v` and `hyperclaw status --all`.
 */
export function resolvePathEnvOverrides(): {
  hyperclawHome?: string;
  stateDir?: string;
  configPath?: string;
  gatewayToken?: string;
} {
  return {
    ...(process.env.HYPERCLAW_HOME ? { hyperclawHome: process.env.HYPERCLAW_HOME } : {}),
    ...(process.env.HYPERCLAW_STATE_DIR ? { stateDir: process.env.HYPERCLAW_STATE_DIR } : {}),
    ...(process.env.HYPERCLAW_CONFIG_PATH ? { configPath: process.env.HYPERCLAW_CONFIG_PATH } : {}),
    ...(process.env.HYPERCLAW_GATEWAY_TOKEN ? { gatewayToken: '(set)' } : {})
  };
}
