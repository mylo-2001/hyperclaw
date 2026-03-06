/**
 * src/agent/memory-auto.ts
 * Auto-memory system — after every AI response, extract facts worth remembering
 * and append them to MEMORY.md automatically. No user intervention needed.
 *
 * How it works:
 * 1. User sends a message
 * 2. AI responds
 * 3. AFTER the response, we run a fast "extractor" pass on the conversation
 * 4. If something worth saving is found → append to MEMORY.md
 *
 * What gets saved:
 * - Facts about the user (name, job, preferences, location)
 * - Tasks the user wants done repeatedly
 * - Preferences ("I prefer X over Y", "always do X")
 * - Corrections ("no, my name is actually...")
 * - Goals and projects
 *
 * What does NOT get saved:
 * - One-off questions
 * - Sensitive info (passwords, CC numbers) — detected and skipped
 * - Duplicate info already in MEMORY.md
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const MEMORY_FILE = path.join(HC_DIR, 'MEMORY.md');
const SOUL_FILE = path.join(HC_DIR, 'SOUL.md');

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ExtractedFact {
  fact: string;
  category: 'preference' | 'identity' | 'task' | 'goal' | 'correction' | 'context';
  confidence: 'high' | 'medium';
}

// ─── Fast local extractor (no API call needed) ─────────────────────────────────

const PREFERENCE_PATTERNS = [
  /i (?:prefer|like|love|hate|dislike|always|never)\s+(.{5,80})/i,
  /(?:my favorite|my preferred)\s+(.{5,80})/i,
  /(?:please )?always\s+((?:use|do|write|respond|answer|format|reply)\s+.{5,60})/i,
  /don'?t (?:ever )?(.{5,60})/i,
  /(?:i want you to always)\s+(.{5,80})/i,
];

const IDENTITY_PATTERNS = [
  /(?:my name is|i'?m called|call me)\s+([A-ZΑ-Ωa-zα-ω][a-zα-ω]{1,30})/i,
  /i(?:'m| am) (?:a |an )?([A-Za-zΑ-Ωα-ω][\w\s]{3,40}?)(?:\.|,|$)/i,
  /i work (?:at|for|as)\s+(.{5,60})/i,
  /i(?:'m| am) (?:from|in|based in)\s+(.{3,40})/i,
  /my (?:job|role|position|title) is\s+(.{5,60})/i,
];

const GOAL_PATTERNS = [
  /i(?:'m| am) (?:working on|building|creating|developing)\s+(.{10,100})/i,
  /i want to\s+(.{10,100})/i,
  /my goal is (?:to\s+)?(.{10,100})/i,
  /i'?m trying to\s+(.{10,100})/i,
];

const SENSITIVE_PATTERNS = [
  /password/i, /passwd/i, /secret key/i, /api.?key/i,
  /credit.?card/i, /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/,
  /ssn|social security/i, /\b\d{3}-\d{2}-\d{4}\b/,
];

function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(text));
}

export function extractFactsLocally(turns: ChatTurn[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const userMessages = turns.filter(t => t.role === 'user').map(t => t.content);

  for (const msg of userMessages) {
    if (isSensitive(msg)) continue;

    for (const pattern of PREFERENCE_PATTERNS) {
      const m = msg.match(pattern);
      if (m?.[1] && m[1].length > 4) {
        facts.push({ fact: `User preference: ${m[1].trim()}`, category: 'preference', confidence: 'high' });
      }
    }

    for (const pattern of IDENTITY_PATTERNS) {
      const m = msg.match(pattern);
      if (m?.[1] && m[1].length > 2) {
        facts.push({ fact: `About user: ${m[1].trim()}`, category: 'identity', confidence: 'high' });
      }
    }

    for (const pattern of GOAL_PATTERNS) {
      const m = msg.match(pattern);
      if (m?.[1] && m[1].length > 8) {
        facts.push({ fact: `User goal: ${m[1].trim()}`, category: 'goal', confidence: 'medium' });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return facts.filter(f => {
    const key = f.fact.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Memory file operations ───────────────────────────────────────────────────

export async function readMemory(): Promise<string> {
  try { return await fs.readFile(MEMORY_FILE, 'utf8'); }
  catch { return ''; }
}

export async function appendMemory(facts: ExtractedFact[]): Promise<number> {
  if (facts.length === 0) return 0;

  const existing = await readMemory();
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;

  const newLines: string[] = [];
  const addedFacts: ExtractedFact[] = [];
  for (const f of facts) {
    // Don't duplicate
    if (existing.toLowerCase().includes(f.fact.toLowerCase().slice(0, 30))) continue;
    newLines.push(`- ${today} [${f.category}] ${f.fact}`);
    addedFacts.push(f);
    added++;
  }

  if (newLines.length === 0) return 0;

  await fs.ensureDir(HC_DIR);
  if (!(await fs.pathExists(MEMORY_FILE))) {
    await fs.writeFile(MEMORY_FILE, '# HyperClaw Memory\n\n');
  }
  await fs.appendFile(MEMORY_FILE, '\n' + newLines.join('\n') + '\n');

  // Memory integration (Obsidian / Raycast / Hazel)
  try {
    const { onMemoryAppended } = await import('../../../../src/services/memory-integration');
    await onMemoryAppended(addedFacts.map(f => ({ fact: f.fact })));
  } catch { /* ignore */ }

  return added;
}

export async function saveMemoryDirect(text: string): Promise<void> {
  await fs.ensureDir(HC_DIR);
  if (!(await fs.pathExists(MEMORY_FILE))) {
    await fs.writeFile(MEMORY_FILE, '# HyperClaw Memory\n\n');
  }
  const today = new Date().toISOString().slice(0, 10);
  await fs.appendFile(MEMORY_FILE, `\n- ${today} ${text}\n`);

  try {
    const { onMemoryAppended } = await import('../../../../src/services/memory-integration');
    await onMemoryAppended([{ fact: text }]);
  } catch { /* ignore */ }
}

// ─── AI-powered extraction (uses inference engine for better accuracy) ────────

export async function extractFactsWithAI(
  turns: ChatTurn[],
  inferenceOpts: { apiKey: string; model: string; provider: 'anthropic' | 'openrouter' }
): Promise<ExtractedFact[]> {
  // Only run if conversation is long enough to have something worth saving
  const totalText = turns.map(t => t.content).join(' ');
  if (totalText.length < 100) return [];

  // Use local extraction as baseline — fast and free
  const localFacts = extractFactsLocally(turns);

  // Only call AI if there might be more subtle facts
  // (skip if conversation is just a simple Q&A)
  const hasPersonalContext = /\b(I|my|me|mine|myself)\b/i.test(totalText);
  if (!hasPersonalContext) return localFacts;

  try {
    const { InferenceEngine } = await import('./inference');
    const engine = new InferenceEngine({
      model: inferenceOpts.model,
      apiKey: inferenceOpts.apiKey,
      provider: inferenceOpts.provider,
      maxTokens: 512,
      tools: []
    });

    const conversationSummary = turns
      .slice(-6) // last 6 turns only
      .map(t => `${t.role === 'user' ? 'User' : 'AI'}: ${t.content.slice(0, 300)}`)
      .join('\n');

    const result = await engine.run([{
      role: 'user',
      content: `Extract ONLY concrete, reusable facts about the USER from this conversation. 
Skip: passwords, API keys, one-off questions, assistant responses.
Include: name, job, preferences, ongoing projects, locations, recurring tasks.

Conversation:
${conversationSummary}

Respond with a JSON array of strings, each a short fact starting with "User".
If nothing worth saving, respond: []
Example: ["User's name is Alex", "User prefers TypeScript over JavaScript", "User is building a SaaS app"]`
    }]);

    // Parse AI response
    const clean = result.text.replace(/```json|```/g, '').trim();
    const aiFactStrings: string[] = JSON.parse(clean);

    // Merge with local facts, avoiding duplicates
    const allFacts = [...localFacts];
    const existingFactText = localFacts.map(f => f.fact.toLowerCase());

    for (const factStr of aiFactStrings) {
      if (!factStr || factStr.length < 5) continue;
      if (isSensitive(factStr)) continue;
      if (existingFactText.some(e => e.includes(factStr.toLowerCase().slice(0, 20)))) continue;

      // Categorize
      const cat: ExtractedFact['category'] =
        /prefer|like|hate|always|never|don't/i.test(factStr) ? 'preference' :
        /goal|want|trying|working on|building/i.test(factStr) ? 'goal' :
        /name|job|work|role|from|based/i.test(factStr) ? 'identity' : 'context';

      allFacts.push({ fact: factStr, category: cat, confidence: 'medium' });
    }

    return allFacts;
  } catch {
    // If AI extraction fails, fall back to local
    return localFacts;
  }
}

// ─── Auto-memory session handler ──────────────────────────────────────────────

export class AutoMemory {
  private turns: ChatTurn[] = [];
  private turnsSinceLastExtract = 0;
  private extractEveryNTurns: number;
  private useAI: boolean;
  private aiOpts?: { apiKey: string; model: string; provider: 'anthropic' | 'openrouter' };

  constructor(opts: {
    extractEveryNTurns?: number;
    useAI?: boolean;
    aiOpts?: { apiKey: string; model: string; provider: 'anthropic' | 'openrouter' };
  } = {}) {
    this.extractEveryNTurns = opts.extractEveryNTurns ?? 4;
    this.useAI = opts.useAI ?? false;
    this.aiOpts = opts.aiOpts;
  }

  addTurn(role: 'user' | 'assistant', content: string): void {
    this.turns.push({ role, content, timestamp: new Date().toISOString() });
    this.turnsSinceLastExtract++;
  }

  async maybeExtract(): Promise<number> {
    if (this.turnsSinceLastExtract < this.extractEveryNTurns) return 0;
    this.turnsSinceLastExtract = 0;
    return this.extract();
  }

  async extract(): Promise<number> {
    const facts = this.useAI && this.aiOpts
      ? await extractFactsWithAI(this.turns, this.aiOpts)
      : extractFactsLocally(this.turns);

    const saved = await appendMemory(facts);
    if (saved > 0) {
      console.log(chalk.gray(`  🧠 Auto-saved ${saved} fact${saved === 1 ? '' : 's'} to MEMORY.md`));
    }
    return saved;
  }

  clearTurns(): void { this.turns = []; }
  getTurns(): ChatTurn[] { return [...this.turns]; }
}

// ─── CLI helpers ──────────────────────────────────────────────────────────────

export async function showMemory(): Promise<void> {
  const content = await readMemory();
  if (!content.trim()) {
    console.log(chalk.gray('\n  🧠 MEMORY.md is empty\n'));
    return;
  }
  console.log(chalk.bold.cyan('\n  🧠 MEMORY\n'));
  const lines = content.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (line.startsWith('#')) console.log(chalk.bold.white(line));
    else if (line.startsWith('-')) {
      const parts = line.match(/^-\s+(\S+)\s+\[(\w+)\]\s+(.+)$/);
      if (parts) {
        const [, date, cat, fact] = parts;
        const catColor = cat === 'preference' ? chalk.cyan : cat === 'identity' ? chalk.yellow : cat === 'goal' ? chalk.green : chalk.gray;
        console.log(`  ${chalk.gray(date)} ${catColor(`[${cat}]`)} ${fact}`);
      } else {
        console.log(`  ${line}`);
      }
    }
  }
  console.log();
}

export async function clearMemory(): Promise<void> {
  await fs.writeFile(MEMORY_FILE, '# HyperClaw Memory\n\n');
  console.log(chalk.green('  ✅ Memory cleared\n'));
}

export async function searchMemory(query: string): Promise<void> {
  const content = await readMemory();
  const lines = content.split('\n').filter(l => l.toLowerCase().includes(query.toLowerCase()));
  if (lines.length === 0) {
    console.log(chalk.gray(`  No memories found for: "${query}"\n`));
    return;
  }
  console.log(chalk.bold.cyan(`\n  🔍 Memory search: "${query}"\n`));
  for (const line of lines) console.log(`  ${line}`);
  console.log();
}
