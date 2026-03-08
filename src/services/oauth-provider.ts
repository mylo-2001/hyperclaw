/**
 * src/services/oauth-provider.ts
 * OAuth for AI providers — use access_token (and refresh when expired) instead of API key.
 * Config: provider.authType = 'oauth', provider.oauthTokenPath = path to JSON.
 * File format: { access_token, refresh_token?, expires_at?, token_url?, client_id?, client_secret? }
 */

import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import { getHyperClawDir } from '../infra/paths';

export interface OAuthTokenFile {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;  // seconds since epoch
  token_url?: string;
  client_id?: string;
  client_secret?: string;
}

const DEFAULT_REFRESH_URLS: Record<string, string> = {
  google: 'https://oauth2.googleapis.com/token',
  openai: 'https://api.openai.com/v1/auth/refresh',
  anthropic: ''
};

function defaultTokenPath(providerId: string): string {
  return path.join(getHyperClawDir(), `oauth-${providerId}.json`);
}

export async function getProviderCredentialAsync(
  cfg: {
    provider?: {
      providerId?: string;
      apiKey?: string;
      authType?: 'api_key' | 'oauth';
      oauthTokenPath?: string;
    };
  } | null
): Promise<string> {
  if (!cfg?.provider) return '';

  const authType = cfg.provider.authType ?? 'api_key';
  if (authType === 'api_key') {
    const key = cfg.provider.apiKey;
    if (key) return key;
    const pid = cfg.provider.providerId || 'openrouter';
    switch (pid) {
      case 'openrouter': return process.env.OPENROUTER_API_KEY || '';
      case 'anthropic': return process.env.ANTHROPIC_API_KEY || '';
      case 'openai': return process.env.OPENAI_API_KEY || '';
      case 'xai': return process.env.XAI_API_KEY || '';
      case 'google': return process.env.GOOGLE_AI_API_KEY || '';
      default: return process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    }
  }

  const tokenPath = cfg.provider.oauthTokenPath || defaultTokenPath(cfg.provider.providerId || 'default');
  if (!(await fs.pathExists(tokenPath))) return '';

  let data: OAuthTokenFile;
  try {
    data = await fs.readJson(tokenPath);
  } catch {
    return '';
  }

  if (!data.access_token) return '';

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = data.expires_at ?? 0;
  if (expiresAt > 0 && now < expiresAt - 60) return data.access_token;

  if (!data.refresh_token) return data.access_token;

  const tokenUrl = data.token_url || DEFAULT_REFRESH_URLS[cfg.provider.providerId || ''] || '';
  if (!tokenUrl) return data.access_token;

  const refreshed = await refreshAccessToken({
    token_url: tokenUrl,
    refresh_token: data.refresh_token,
    client_id: data.client_id || process.env.OAUTH_CLIENT_ID,
    client_secret: data.client_secret || process.env.OAUTH_CLIENT_SECRET
  });

  if (refreshed.access_token) {
    data.access_token = refreshed.access_token;
    if (refreshed.expires_in) data.expires_at = now + refreshed.expires_in;
    await fs.writeJson(tokenPath, data, { spaces: 2 });
    return data.access_token;
  }

  return data.access_token;
}

async function refreshAccessToken(opts: {
  token_url: string;
  refresh_token: string;
  client_id?: string;
  client_secret?: string;
}): Promise<{ access_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refresh_token
  });
  if (opts.client_id) body.set('client_id', opts.client_id);
  if (opts.client_secret) body.set('client_secret', opts.client_secret);

  const u = new URL(opts.token_url);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve({ access_token: j.access_token, expires_in: j.expires_in });
        } catch {
          resolve({});
        }
      });
    });
    req.on('error', () => resolve({}));
    req.write(body.toString());
    req.end();
  });
}

/** Write token file (e.g. after OAuth callback or manual paste). */
export async function writeOAuthToken(
  providerId: string,
  token: OAuthTokenFile,
  customPath?: string
): Promise<void> {
  const p = customPath || defaultTokenPath(providerId);
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, token, { spaces: 2 });
}
