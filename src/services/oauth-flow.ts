/**
 * src/services/oauth-flow.ts
 * Full OAuth authorization code flow — open browser, receive callback, exchange for tokens.
 * Use: hyperclaw auth oauth <provider>
 */

import http from 'http';
import crypto from 'crypto';
import { writeOAuthToken } from './oauth-provider';
import os from 'os';
import path from 'path';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const REDIRECT_PORT = 38789;
const REDIRECT_PATH = '/oauth/callback';

export interface OAuthProviderConfig {
  authorize_url: string;
  token_url: string;
  scopes: string[];
  client_id: string;
  client_secret?: string;
}

const PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_url: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/aiplatform'],
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET
  },
  'google-gmail': {
    authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_url: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'],
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET
  },
  microsoft: {
    authorize_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'profile', 'offline_access', 'https://cognitiveservices.azure.com/.default'],
    client_id: process.env.AZURE_OAUTH_CLIENT_ID || process.env.MICROSOFT_OAUTH_CLIENT_ID || '',
    client_secret: process.env.AZURE_OAUTH_CLIENT_SECRET || process.env.MICROSOFT_OAUTH_CLIENT_SECRET
  }
};

export async function runOAuthFlow(
  providerId: string,
  opts?: { clientId?: string; clientSecret?: string; scopes?: string[] }
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const cfg = PROVIDERS[providerId];
  if (!cfg) {
    throw new Error(`OAuth provider "${providerId}" not configured. Supported: google, google-gmail (Gmail Pub/Sub), microsoft. Anthropic/OpenAI: use "hyperclaw auth add" (API keys) or "hyperclaw auth setup-token anthropic" for Claude Pro/Max.`);
  }

  const clientId = opts?.clientId || cfg.client_id || process.env.OAUTH_CLIENT_ID;
  const clientSecret = opts?.clientSecret || cfg.client_secret || process.env.OAUTH_CLIENT_SECRET;
  const scopes = opts?.scopes || cfg.scopes;

  if (!clientId) {
    const hint = providerId === 'google'
      ? 'Set GOOGLE_OAUTH_CLIENT_ID or OAUTH_CLIENT_ID. Create at: https://console.cloud.google.com/apis/credentials'
      : providerId === 'microsoft'
      ? 'Set AZURE_OAUTH_CLIENT_ID. Create at: https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
      : 'Set OAUTH_CLIENT_ID or pass --client-id';
    throw new Error(`OAuth client_id required. ${hint}`);
  }

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  });

  const authUrl = `${cfg.authorize_url}?${authParams}`;

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (error) {
        res.writeHead(400);
        res.end(`<h1>OAuth error</h1><p>${error}</p><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('<h1>No code received</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error('No authorization code received'));
        return;
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`,
        code_verifier: codeVerifier
      });
      if (clientSecret) body.set('client_secret', clientSecret);
      body.set('client_id', clientId);

      try {
        const tokenRes = await fetch(cfg.token_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
          res.writeHead(400);
          res.end(`<h1>Token error</h1><p>${tokenData.error}</p><p>You can close this tab.</p>`);
          server.close();
          reject(new Error(tokenData.error_description || tokenData.error));
          return;
        }
        res.writeHead(200);
        res.end('<h1>Success!</h1><p>HyperClaw has received your tokens. You can close this tab and return to the terminal.</p>');
        server.close();
        resolve({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in
        });
      } catch (e: any) {
        res.writeHead(500);
        res.end(`<h1>Error</h1><p>${e.message}</p><p>You can close this tab.</p>`);
        server.close();
        reject(e);
      }
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      try {
        const { exec } = require('child_process');
        const opener = process.platform === 'win32' ? `start "" "${authUrl}"` : (process.platform === 'darwin' ? 'open' : 'xdg-open') + ` "${authUrl}"`;
        exec(opener);
      } catch { /* ignore */ }
    });

    server.on('error', (err) => { server.close(); reject(err); });
  });
}
