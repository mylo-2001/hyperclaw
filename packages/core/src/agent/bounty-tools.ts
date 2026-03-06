/**
 * src/agent/bounty-tools.ts
 * Service API tools — HackerOne, Bugcrowd, Synack + generic tools για οποιαδήποτε υπηρεσία με API key.
 * Τα keys από skills.apiKeys ή env (HACKERONE_*, BUGCROWD_*, CUSTOM_SERVICE_API_KEY, etc).
 */

import https from 'https';
import type { Tool } from './inference';
import { resolveServiceApiKey } from '../../../../src/infra/env-resolve';

const KNOWN_BOUNTY_SERVICES = ['hackerone', 'bugcrowd', 'synack'];

function fetchJson(url: string, auth?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    if (auth) {
      const h = opts.headers as Record<string, string>;
      if (auth.startsWith('Basic ') || auth.startsWith('Token ') || auth.startsWith('Bearer ')) h['Authorization'] = auth;
      else h['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    }
    https.get(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve({}); }
      });
    }).on('error', reject);
  });
}

export function getBountyTools(cfg: { skills?: { apiKeys?: Record<string, string> } } | null): Tool[] {
  const hackeroneKey = resolveServiceApiKey('hackerone', cfg);
  const bugcrowdKey = resolveServiceApiKey('bugcrowd', cfg);
  const synackKey = resolveServiceApiKey('synack', cfg);

  const tools: Tool[] = [];

  if (hackeroneKey) {
    tools.push({
      name: 'hackerone_list_programs',
      description: 'List HackerOne programs you have access to. Use for bug bounty research.',
      input_schema: { type: 'object', properties: { limit: { type: 'string', description: 'Max programs (default 20)' } } },
      handler: async (input) => {
        try {
          const auth = Buffer.from(hackeroneKey.includes(':') ? hackeroneKey : `:${hackeroneKey}`).toString('base64');
          const body = await fetchJson('https://api.hackerone.com/v1/hackers/programs', `Basic ${auth}`) as { data?: unknown[] };
          const progs = (body.data || []) as Record<string, unknown>[];
          const limit = parseInt((input.limit as string) || '20', 10);
          return progs.slice(0, limit).map((p) => {
            const attrs = p.attributes as Record<string, unknown> | undefined;
            return `- ${attrs?.name || p.id} (${attrs?.state || '?'})`;
          }).join('\n') || 'No programs found.';
        } catch (e: unknown) {
          return `Error: ${(e as Error).message}. Check HackerOne API key (username:token).`;
        }
      }
    });
  }

  if (bugcrowdKey) {
    tools.push({
      name: 'bugcrowd_list_programs',
      description: 'List Bugcrowd programs. Use for bug bounty research.',
      input_schema: { type: 'object', properties: { limit: { type: 'string', description: 'Max programs (default 20)' } } },
      handler: async (input) => {
        try {
          const auth = bugcrowdKey.startsWith('Token ') ? bugcrowdKey : `Token ${bugcrowdKey}`;
          const body = await fetchJson('https://api.bugcrowd.com/programs', auth) as { data?: unknown } | unknown[];
          const progs = (body && typeof body === 'object' && 'data' in body ? body.data : body) || [];
          const arr = Array.isArray(progs) ? progs : [progs];
          const limit = parseInt((input.limit as string) || '20', 10);
          return arr.slice(0, limit).map((p: Record<string, unknown>) => {
            const attrs = p.attributes as Record<string, unknown> | undefined;
            const name = attrs?.name || p.name || p.id || '?';
            const links = p.links as Record<string, string> | undefined;
            const linkUrl = links?.self || (p.url as string) || '';
            return `- ${name} ${linkUrl ? `(${linkUrl})` : ''}`;
          }).join('\n') || JSON.stringify(body).slice(0, 500);
        } catch (e: unknown) {
          return `Error: ${(e as Error).message}. Check Bugcrowd API token.`;
        }
      }
    });
  }

  if (synackKey) {
    tools.push({
      name: 'synack_list_targets',
      description: 'List Synack targets you have access to. Use for bug bounty research.',
      input_schema: { type: 'object', properties: {} },
      handler: async () => {
        try {
          const body = await fetchJson('https://api.synack.com/api/targets', `Bearer ${synackKey}`) as Record<string, unknown>;
          const targets = body.targets || body || [];
          const arr = Array.isArray(targets) ? targets : [targets];
          return arr.slice(0, 20).map((t: Record<string, unknown>) => `- ${t.name || t.slug || t.id || '?'}`).join('\n') || 'No targets or check Synack API.';
        } catch (e: unknown) {
          return `Error: ${(e as Error).message}. Check Synack API token.`;
        }
      }
    });
  }

  // Γενικό tool για οποιαδήποτε υπηρεσία με API key στο skills.apiKeys
  const apiKeys = cfg?.skills?.apiKeys ?? {};
  const genericServiceIds = Object.keys(apiKeys).filter(id => !KNOWN_BOUNTY_SERVICES.includes(id.toLowerCase()));
  if (genericServiceIds.length > 0) {
    tools.push({
      name: 'call_service_api',
      description: `Call external API for services with configured keys. Available: ${genericServiceIds.join(', ')}. Use when the user needs to query an API for a service they've added (Stripe, GitHub, custom APIs, etc).`,
      input_schema: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: `Service id from configured keys: ${genericServiceIds.join(', ')}` },
          url: { type: 'string', description: 'Full API URL (e.g. https://api.example.com/v1/resource) or path if baseUrl configured' },
          method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          body: { type: 'object', description: 'Request body for POST/PUT/PATCH (optional)' }
        },
        required: ['service_id', 'url']
      },
      handler: async (input: Record<string, unknown>) => {
        const serviceId = String(input.service_id || '').trim().toLowerCase();
        const url = String(input.url || '');
        const method = (String(input.method || 'GET').toUpperCase()) as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        const key = resolveServiceApiKey(serviceId, cfg);
        if (!key) return `Error: No API key for service "${serviceId}". Configure via: hyperclaw config set-service-key ${serviceId} <key>`;
        if (!url || !url.startsWith('http')) return 'Error: url must be a full URL (https://...).';
        try {
          const body = await genericHttpRequest(url, method, key, input.body as Record<string, unknown> | undefined);
          return typeof body === 'string' ? body : JSON.stringify(body, null, 2).slice(0, 8000);
        } catch (e: unknown) {
          return `Error: ${(e as Error).message}`;
        }
      }
    });
  }

  return tools;
}

function genericHttpRequest(
  url: string,
  method: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const authHeader = apiKey.startsWith('Bearer ') || apiKey.startsWith('Token ') || apiKey.startsWith('Basic ')
      ? apiKey
      : `Bearer ${apiKey}`;
    const bodyStr = body && method !== 'GET' ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve(data || '{}'); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
