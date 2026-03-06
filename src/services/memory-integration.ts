/**
 * src/services/memory-integration.ts
 * Memory integration — sync MEMORY.md to Obsidian vault, write daily notes,
 * make interaction logs searchable via Raycast / Hazel.
 *
 * Config in hyperclaw.json:
 *   memoryIntegration: {
 *     vaultDir: "/path/to/obsidian/vault",  // or any folder Raycast/Hazel index
 *     dailyNotes: true,
 *     syncOnAppend: true
 *   }
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { getConfigPath, getHyperClawDir } from '../infra/paths';

const MEMORY_FILE = path.join(getHyperClawDir(), 'MEMORY.md');

export interface MemoryIntegrationConfig {
  vaultDir?: string;
  dailyNotes?: boolean;
  syncOnAppend?: boolean;
}

async function getConfig(): Promise<MemoryIntegrationConfig> {
  try {
    const cfg = await fs.readJson(getConfigPath());
    return (cfg.memoryIntegration ?? {}) as MemoryIntegrationConfig;
  } catch {
    return {};
  }
}

/** Sync MEMORY.md to vault (Obsidian / Raycast / Hazel). */
export async function syncMemoryToVault(vaultDir: string): Promise<void> {
  const target = path.join(vaultDir, 'HyperClaw-MEMORY.md');
  if (await fs.pathExists(MEMORY_FILE)) {
    await fs.ensureDir(vaultDir);
    await fs.copy(MEMORY_FILE, target, { overwrite: true });
  }
}

/** Write daily note with session summary and new facts. */
export async function writeDailyNote(
  vaultDir: string,
  date: string, // YYYY-MM-DD
  content: { sessionId?: string; turnCount?: number; newFacts?: string[] }
): Promise<void> {
  const filename = `${date}.md`;
  const target = path.join(vaultDir, 'HyperClaw', filename);
  await fs.ensureDir(path.dirname(target));

  const lines: string[] = [
    `# HyperClaw — ${date}`,
    '',
    `> Auto-generated daily note from HyperClaw interactions.`,
    ''
  ];

  if (content.sessionId && (content.turnCount ?? 0) > 0) {
    lines.push(`## Session ${content.sessionId}`);
    lines.push(`- Turns: ${content.turnCount}`);
    lines.push('');
  }

  if (content.newFacts?.length) {
    lines.push('## New memories');
    for (const f of content.newFacts) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  const body = lines.join('\n');
  if (await fs.pathExists(target)) {
    await fs.appendFile(target, '\n---\n' + body);
  } else {
    await fs.writeFile(target, body);
  }
}

/** Append new fact to daily note (for incremental updates). */
export async function appendToDailyNote(
  vaultDir: string,
  date: string,
  fact: string
): Promise<void> {
  const filename = `${date}.md`;
  const target = path.join(vaultDir, 'HyperClaw', filename);
  await fs.ensureDir(path.dirname(target));

  const line = `- ${new Date().toISOString().slice(11, 19)} ${fact}\n`;
  if (!(await fs.pathExists(target))) {
    await fs.writeFile(target, `# HyperClaw — ${date}\n\n`);
  }
  await fs.appendFile(target, line);
}

/** Called after MEMORY.md append — sync to vault + optionally add to daily note. */
export async function onMemoryAppended(facts: Array<{ fact: string }>): Promise<void> {
  const cfg = await getConfig();
  const vaultDir = cfg.vaultDir;
  if (!vaultDir) return;

  if (cfg.syncOnAppend !== false) {
    await syncMemoryToVault(vaultDir);
  }

  if (cfg.dailyNotes && facts.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    for (const f of facts) {
      await appendToDailyNote(vaultDir, today, f.fact);
    }
  }
}

/** Called on session end — sync + write session summary to daily note. */
export async function onSessionEnd(payload: {
  sessionId?: string;
  turnCount?: number;
  newFacts?: string[];
}): Promise<void> {
  const cfg = await getConfig();
  const vaultDir = cfg.vaultDir;
  if (!vaultDir || !cfg.dailyNotes) return;

  await syncMemoryToVault(vaultDir);
  const today = new Date().toISOString().slice(0, 10);
  await writeDailyNote(vaultDir, today, {
    sessionId: payload.sessionId,
    turnCount: payload.turnCount,
    newFacts: payload.newFacts
  });
}
