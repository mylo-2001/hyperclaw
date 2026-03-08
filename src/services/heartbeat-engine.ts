/**
 * src/services/heartbeat-engine.ts
 * OpenClaw-style Heartbeat Engine — proactive wake-ups, briefings, monitoring.
 */

import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { getConfigPath } from '../infra/paths';

export interface HeartbeatConfig {
  morningBriefing?: { enabled?: boolean; cron?: string };
}

async function getConfig(): Promise<HeartbeatConfig> {
  try {
    const cfg = await fs.readJson(getConfigPath());
    return (cfg.heartbeat ?? {}) as HeartbeatConfig;
  } catch {
    return {};
  }
}

async function getGatewayConfig(): Promise<{ port: number; authToken?: string }> {
  try {
    const cfg = await fs.readJson(getConfigPath());
    const authToken = cfg?.gateway?.authToken || process.env.HYPERCLAW_GATEWAY_TOKEN || '';
    return {
      port: cfg?.gateway?.port ?? 18789,
      authToken: authToken || undefined
    };
  } catch {
    return { port: 18789 };
  }
}

/** Generate morning briefing via agent (POST /api/chat). */
export async function runMorningBriefing(): Promise<string> {
  const { port, authToken } = await getGatewayConfig();

  const prompt = `Generate a brief morning briefing (3-5 bullets) for the user based on:
- MEMORY.md and knowledge graph (projects, preferences, recent facts)
- Today's reminders (list_reminders)
- Any relevant context

Be concise. Format as markdown bullets. No preamble.`;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ message: prompt });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload))
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/chat',
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.response || j.error || '(no response)');
        } catch {
          resolve(data || '(parse error)');
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Briefing timeout'));
    });
    req.write(payload);
    req.end();
  });
}

/** Persist briefing to HEARTBEAT.md and daily log. */
export async function persistBriefing(text: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const ts = new Date().toISOString();

  const heartbeatPath = path.join(HC_DIR, 'HEARTBEAT.md');
  const content = `## Morning Briefing — ${today}\n\n${text}\n\n---\n*Generated ${ts}*\n`;
  await fs.ensureDir(HC_DIR);
  if (await fs.pathExists(heartbeatPath)) {
    const existing = await fs.readFile(heartbeatPath, 'utf8');
    await fs.writeFile(heartbeatPath, content + '\n' + existing.slice(0, 8000), 'utf8');
  } else {
    await fs.writeFile(heartbeatPath, `# HEARTBEAT.md — Proactive Briefings\n\n${content}`, 'utf8');
  }

  const logDir = path.join(HC_DIR, 'logs');
  const logPath = path.join(logDir, `heartbeat-${today}.md`);
  await fs.ensureDir(logDir);
  await fs.appendFile(logPath, `\n## ${ts}\n\n${text}\n`, 'utf8');
}
