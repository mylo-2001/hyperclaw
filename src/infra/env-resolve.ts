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

/**
 * H-2: Resolve API key or OAuth access token (async).
 * Resolution order:
 *   1. cfg.provider.apiKey (in config file)
 *   2. CredentialsStore  (~/.hyperclaw/credentials/<providerId>.json)
 *   3. AuthStore         (~/.hyperclaw/auth.json providers map)
 *   4. Environment variables (per-provider mapping in resolveProviderApiKey)
 * Also handles authType === 'oauth' via the oauth-provider service.
 */
export async function getProviderCredentialAsync(
  cfg: { provider?: { providerId?: string; apiKey?: string; authType?: 'api_key' | 'oauth'; oauthTokenPath?: string } } | null
): Promise<string> {
  if (!cfg?.provider) return '';

  if ((cfg.provider as any).authType === 'oauth') {
    const { getProviderCredentialAsync: getOAuth } = await import('../services/oauth-provider');
    return getOAuth(cfg);
  }

  // 1. Config file key takes highest priority
  if (cfg.provider.apiKey) return cfg.provider.apiKey;

  const pid = cfg.provider.providerId || 'openrouter';

  // 2. Per-provider credentials file (profile-aware)
  try {
    const { CredentialsStore } = await import('../secrets/credentials-store');
    const { getHyperClawDir } = await import('./paths');
    const credStore = new CredentialsStore(getHyperClawDir());
    const cred = await credStore.get(pid);
    if (cred?.apiKey) return cred.apiKey;
  } catch (e) {
    if (process.env.DEBUG) console.error('[env-resolve] CredentialsStore:', (e as Error)?.message);
  }

  // 3. Auth store providers map (profile-aware)
  try {
    const { AuthStore } = await import('./device-auth-store');
    const { getHyperClawDir } = await import('./paths');
    const authStore = new AuthStore(getHyperClawDir());
    const key = await authStore.getProviderKey(pid);
    if (key) return key;
  } catch (e) {
    if (process.env.DEBUG) console.error('[env-resolve] AuthStore:', (e as Error)?.message);
  }

  // 4. Environment variable fallback
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
