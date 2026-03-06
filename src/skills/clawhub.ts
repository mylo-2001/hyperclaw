/**
 * src/skills/clawhub.ts
 * ClawHub skill registry integration — search and install skills from the public registry.
 * Compatible with HyperClaw Skill Hub (clawhub.com).
 */

import https from 'https';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import tar from 'tar';
import { getHyperClawDir } from '../infra/paths';

const CLAWHUB_API = process.env.CLAWHUB_API_URL || 'https://clawhub.com';
const WORKSPACE_SKILLS = path.join(getHyperClawDir(), 'workspace', 'skills');

export interface ClawHubSkill {
  id: string;
  name: string;
  author?: string;
  description?: string;
  rating?: number;
  downloads?: number;
  version?: string;
  categories?: string[];
}

export async function searchSkills(query: string, category?: string): Promise<ClawHubSkill[]> {
  const q = new URLSearchParams({ q: query });
  if (category) q.set('category', category);
  const url = `${CLAWHUB_API}/api/skills/search?${q}`;
  try {
    const body = await fetchJson(url);
    return Array.isArray(body.skills) ? body.skills : (Array.isArray(body) ? body : []);
  } catch (e: any) {
    // Return empty when registry unavailable (network, timeout, 404)
    return [];
  }
}

export async function installSkill(skillId: string, version?: string): Promise<string> {
  const ver = version ? `@${version}` : '';
  const url = `${CLAWHUB_API}/api/skills/${encodeURIComponent(skillId)}/download${ver}`;
  try {
    const body = await fetchJson(url);
    const tarballUrl = body.url || body.tarball;
    if (!tarballUrl) throw new Error('No download URL in registry response');

    await fs.ensureDir(WORKSPACE_SKILLS);
    const destDir = path.join(WORKSPACE_SKILLS, skillId);
    await fs.ensureDir(destDir);

    // If body has content/skillMarkdown, write SKILL.md directly
    if (body.content || body.skillMarkdown) {
      const content = body.content || body.skillMarkdown;
      await fs.writeFile(path.join(destDir, 'SKILL.md'), content, 'utf8');
      return destDir;
    }

    // Fetch tarball and extract
    const tarballBuffer = await fetchBuffer(tarballUrl);
    const extractDir = path.join(path.dirname(destDir), `.skill-extract-${skillId}-${Date.now()}`);
    await fs.ensureDir(extractDir);
    try {
      const tarPath = path.join(extractDir, 'skill.tar.gz');
      await fs.writeFile(tarPath, tarballBuffer);
      await tar.x({ file: tarPath, cwd: extractDir });
      await fs.remove(tarPath);
      // Tarball may have package/ or skillId/ root; find SKILL.md
      const entries = await fs.readdir(extractDir);
      let skillDir = extractDir;
      const topSkill = path.join(extractDir, 'SKILL.md');
      if (!(await fs.pathExists(topSkill))) {
        const sub = entries.find(e => e !== 'package.json' && !e.startsWith('.'));
        if (sub) {
          const subPath = path.join(extractDir, sub);
          if ((await fs.stat(subPath)).isDirectory() && await fs.pathExists(path.join(subPath, 'SKILL.md'))) {
            skillDir = subPath;
          }
        }
      }
      await fs.copy(skillDir, destDir, { filter: (src) => !src.includes('node_modules') });
      // Ensure SKILL.md exists
      if (!(await fs.pathExists(path.join(destDir, 'SKILL.md')))) {
        throw new Error('Tarball did not contain SKILL.md');
      }
      return destDir;
    } finally {
      await fs.remove(extractDir).catch(() => {});
    }
  } catch (e: any) {
    if (e.message?.includes('ENOTFOUND') || e.code === 'ENOTFOUND') {
      throw new Error(`ClawHub registry unavailable. Install manually: mkdir -p ~/.hyperclaw/workspace/skills/${skillId} && add SKILL.md`);
    }
    throw e;
  }
}

export async function listInstalledFromClawHub(): Promise<string[]> {
  if (!(await fs.pathExists(WORKSPACE_SKILLS))) return [];
  const dirs = await fs.readdir(WORKSPACE_SKILLS);
  const out: string[] = [];
  for (const id of dirs) {
    const p = path.join(WORKSPACE_SKILLS, id, 'SKILL.md');
    if (await fs.pathExists(p)) out.push(id);
  }
  return out;
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'HyperClaw/4.0.2' }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Tarball download timeout')); });
    req.end();
  });
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'HyperClaw/4.0.2' }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON from registry'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}
