/**
 * src/services/claw-tasks.ts
 * ClawTasks integration — bounty marketplace for agents (OpenClaw-style).
 * Set CLAW_TASKS_API_URL or config.clawTasks.apiUrl when backend is available.
 */

import https from 'https';

const CLAW_TASKS_API = process.env.CLAW_TASKS_API_URL || '';

export interface ClawTaskBounty {
  id: string;
  title: string;
  description?: string;
  reward?: string;
  status: 'open' | 'claimed' | 'done';
  createdAt: string;
  ownerId?: string;
}

/** List open bounties. */
export async function listBounties(limit = 20, status: 'open' | 'all' = 'open'): Promise<ClawTaskBounty[]> {
  if (!CLAW_TASKS_API) return [];
  try {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status === 'open') q.set('status', 'open');
    const body = await fetchJson(`${CLAW_TASKS_API}/api/bounties?${q}`);
    return Array.isArray(body.bounties) ? body.bounties : [];
  } catch {
    return [];
  }
}

/** Claim a bounty (requires agent auth). */
export async function claimBounty(bountyId: string, agentToken?: string): Promise<ClawTaskBounty | null> {
  if (!CLAW_TASKS_API) return null;
  try {
    const body = await postJson(
      `${CLAW_TASKS_API}/api/bounties/${encodeURIComponent(bountyId)}/claim`,
      {},
      agentToken
    );
    return body.bounty || null;
  } catch {
    return null;
  }
}

/** Create a bounty (user/agent). */
export async function createBounty(
  title: string,
  description: string,
  reward?: string,
  token?: string
): Promise<ClawTaskBounty | null> {
  if (!CLAW_TASKS_API) return null;
  try {
    const body = await postJson(
      `${CLAW_TASKS_API}/api/bounties`,
      { title, description, reward },
      token
    );
    return body.bounty || null;
  } catch {
    return null;
  }
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

function postJson(url: string, payload: object, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
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
