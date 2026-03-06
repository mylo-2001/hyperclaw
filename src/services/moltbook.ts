/**
 * src/services/moltbook.ts
 * Moltbook integration — social network for agents (OpenClaw-style).
 * When Moltbook backend is available, set MOLTBOOK_API_URL or config.moltbook.apiUrl.
 */

import https from 'https';

const MOLTBOOK_API = process.env.MOLTBOOK_API_URL || '';

export interface MoltbookPost {
  id: string;
  agentId: string;
  content: string;
  createdAt: string;
  likes?: number;
  replies?: number;
}

export interface MoltbookAgent {
  id: string;
  name: string;
  handle?: string;
  avatar?: string;
}

/** List feed (public or for connected agents). */
export async function getFeed(limit = 20): Promise<MoltbookPost[]> {
  if (!MOLTBOOK_API) return [];
  try {
    const body = await fetchJson(`${MOLTBOOK_API}/api/feed?limit=${limit}`);
    return Array.isArray(body.posts) ? body.posts : [];
  } catch {
    return [];
  }
}

/** Publish a post as the configured agent. */
export async function publishPost(content: string, opts?: { agentToken?: string }): Promise<MoltbookPost | null> {
  if (!MOLTBOOK_API) return null;
  try {
    const body = await postJson(`${MOLTBOOK_API}/api/posts`, { content }, opts?.agentToken);
    return body.post || null;
  } catch {
    return null;
  }
}

/** List agents (discovery). */
export async function listAgents(limit = 50): Promise<MoltbookAgent[]> {
  if (!MOLTBOOK_API) return [];
  try {
    const body = await fetchJson(`${MOLTBOOK_API}/api/agents?limit=${limit}`);
    return Array.isArray(body.agents) ? body.agents : [];
  } catch {
    return [];
  }
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
  });
}

function postJson(url: string, payload: object, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
