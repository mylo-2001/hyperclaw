/**
 * src/agent/skill-loader.ts
 * Load skills from workspace + bundled. Validation, lifecycle hooks.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
// One level up from dist/ — works for both local dev and global npm install
const BUNDLED_SKILLS = path.join(__dirname, '..', 'skills');
const WORKSPACE_SKILLS = path.join(HC_DIR, 'workspace', 'skills');

/** Max size for a single SKILL.md (chars). */
const MAX_SKILL_CONTENT_SIZE = 200_000;

/** Valid skill id: lowercase, digits, dash, underscore. */
const ID_REGEX = /^[a-z0-9][a-z0-9-_]*$/;

export interface LoadedSkill {
  id: string;
  path: string;
  content: string;
  capabilities?: string;
  /** From validation / manifest */
  title?: string;
  version?: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate skill id and content (manifest checks). */
export function validateSkill(id: string, content: string): SkillValidationResult {
  const errors: string[] = [];
  if (!id || id.length > 64) {
    errors.push('id must be 1–64 characters');
  } else if (!ID_REGEX.test(id)) {
    errors.push('id must be lowercase alphanumeric with only - or _');
  }
  const trimmed = (content || '').trim();
  if (!trimmed) errors.push('content is empty');
  if (trimmed.length > MAX_SKILL_CONTENT_SIZE) {
    errors.push(`content exceeds ${MAX_SKILL_CONTENT_SIZE} characters`);
  }
  return { valid: errors.length === 0, errors };
}

/** Extract manifest (title, version) from content. */
function extractManifest(content: string): { title?: string; version?: string } {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const versionMatch = content.match(/^(?:version|Version):\s*(\S+)/m);
  return {
    title: titleMatch ? titleMatch[1].trim().slice(0, 120) : undefined,
    version: versionMatch ? versionMatch[1].trim().slice(0, 32) : undefined
  };
}

export interface SkillLifecycleHooks {
  onBeforeLoad?: () => void | Promise<void>;
  onAfterLoad?: (skills: LoadedSkill[]) => void | Promise<void>;
  onUnload?: (skills: LoadedSkill[]) => void | Promise<void>;
}

const lifecycleHooks: SkillLifecycleHooks[] = [];

export function registerSkillLifecycle(hooks: SkillLifecycleHooks): void {
  lifecycleHooks.push(hooks);
}

async function runBeforeLoad(): Promise<void> {
  for (const h of lifecycleHooks) {
    if (h.onBeforeLoad) await Promise.resolve(h.onBeforeLoad());
  }
}

async function runAfterLoad(skills: LoadedSkill[]): Promise<void> {
  for (const h of lifecycleHooks) {
    if (h.onAfterLoad) await Promise.resolve(h.onAfterLoad(skills));
  }
}

async function runUnload(skills: LoadedSkill[]): Promise<void> {
  for (const h of lifecycleHooks) {
    if (h.onUnload) await Promise.resolve(h.onUnload(skills));
  }
}

function extractCapabilities(content: string): string {
  const capMatch = content.match(/## Capabilities?\s*\n+([\s\S]*?)(?=\n## |\n# |$)/i);
  if (capMatch) return capMatch[1].trim().slice(0, 200);
  const firstPara = content.replace(/^#.*\n+/, '').split(/\n\n/)[0]?.trim();
  return firstPara ? firstPara.slice(0, 200) : '';
}

export async function loadSkills(opts?: { skipValidation?: boolean }): Promise<LoadedSkill[]> {
  await runBeforeLoad();

  const skills: LoadedSkill[] = [];

  for (const base of [BUNDLED_SKILLS, WORKSPACE_SKILLS]) {
    if (!(await fs.pathExists(base))) continue;
    const dirs = await fs.readdir(base);
    for (const id of dirs) {
      const skillPath = path.join(base, id, 'SKILL.md');
      if (!(await fs.pathExists(skillPath))) continue;
      const content = await fs.readFile(skillPath, 'utf8');
      if (skills.some(s => s.id === id)) continue;

      if (!opts?.skipValidation) {
        const v = validateSkill(id, content);
        if (!v.valid) continue; // skip invalid skills (could log v.errors)
      }

      const manifest = extractManifest(content);
      skills.push({
        id,
        path: skillPath,
        content,
        capabilities: extractCapabilities(content),
        title: manifest.title,
        version: manifest.version
      });
    }
  }

  lastLoaded = skills;
  await runAfterLoad(skills);
  return skills;
}

let lastLoaded: LoadedSkill[] = [];

/** Unload current skills (run onUnload), then load again. */
export async function reloadSkills(): Promise<LoadedSkill[]> {
  await runUnload(lastLoaded);
  return loadSkills();
}

export function buildSkillsContext(skills: LoadedSkill[]): string {
  if (skills.length === 0) return '';
  const capabilityList = skills
    .filter(s => s.capabilities)
    .map(s => `- ${s.id}: ${s.capabilities}`)
    .join('\n');
  const header = capabilityList ? `\nCapability summary:\n${capabilityList}\n\n` : '';
  const blocks = skills.map(s => `## Skill: ${s.id}\n\n${s.content}`).join('\n\n---\n\n');
  return `\n\n# Loaded Skills\n${header}${blocks}\n`;
}

/** Capability discovery: return id + summary for each loaded skill. */
export function getSkillCapabilities(skills: LoadedSkill[]): Array<{ id: string; capabilities: string }> {
  return skills
    .filter(s => s.capabilities)
    .map(s => ({ id: s.id, capabilities: s.capabilities! }));
}

/** Create or overwrite a skill from agent (self-writing skills). */
export async function writeSkill(
  skillId: string,
  opts: { name?: string; description?: string; content: string }
): Promise<{ path: string; id: string; dir: string }> {
  const id = skillId.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'unnamed-skill';
  const dir = path.join(WORKSPACE_SKILLS, id);
  await fs.ensureDir(dir);
  const header = opts.name || id
    ? `# ${opts.name || id}\n\n${opts.description ? `> ${opts.description}\n\n` : ''}`
    : '';
  const full = header + opts.content.trim();
  await fs.writeFile(path.join(dir, 'SKILL.md'), full, 'utf8');
  return { path: path.join(dir, 'SKILL.md'), id, dir };
}
