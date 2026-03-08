/**
 * src/services/cost-tracker.ts
 * Token cost tracking per session and per day.
 * Stores log in ~/.hyperclaw/cost-log.json
 */

import fs from 'fs-extra';
import path from 'path';
import { getHyperClawDir } from '../infra/paths';

const getCostLog = () => path.join(getHyperClawDir(), 'cost-log.json');

// Price per 1M tokens (USD) — input / output
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  // Anthropic
  'claude-opus-4':       { in: 15.00, out: 75.00 },
  'claude-opus-4-5':     { in: 15.00, out: 75.00 },
  'claude-sonnet-4':     { in:  3.00, out: 15.00 },
  'claude-sonnet-4-5':   { in:  3.00, out: 15.00 },
  'claude-haiku-4-5':    { in:  0.80, out:  4.00 },
  // OpenAI
  'gpt-4o':              { in:  2.50, out: 10.00 },
  'gpt-4o-mini':         { in:  0.15, out:  0.60 },
  'o3-mini':             { in:  1.10, out:  4.40 },
  'o1':                  { in: 15.00, out: 60.00 },
  // OpenRouter (via anthropic)
  'anthropic/claude-opus-4-5': { in: 15.00, out: 75.00 },
  'anthropic/claude-sonnet-4-5': { in: 3.00, out: 15.00 },
  'openai/gpt-4o':       { in:  2.50, out: 10.00 },
  // Local / Ollama
  'llama3':              { in:  0.00, out:  0.00 },
  'mistral':             { in:  0.00, out:  0.00 },
  'phi3':                { in:  0.00, out:  0.00 },
};

export interface CostEntry {
  sessionId: string;
  date: string;        // YYYY-MM-DD
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ts: string;          // ISO timestamp
}

function getPrices(model: string): { in: number; out: number } {
  // Exact match
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  // Prefix match (e.g. 'claude-sonnet-4-5-20251101' → 'claude-sonnet-4-5')
  for (const key of Object.keys(MODEL_PRICES)) {
    if (model.startsWith(key)) return MODEL_PRICES[key];
  }
  // Default: $1/$3 per M (rough midrange)
  return { in: 1.00, out: 3.00 };
}

export function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = getPrices(model);
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

async function loadLog(): Promise<CostEntry[]> {
  try { return await fs.readJson(getCostLog()); } catch { return []; }
}

async function saveLog(log: CostEntry[]): Promise<void> {
  await fs.ensureDir(path.dirname(getCostLog()));
  // Keep last 5000 entries
  const trimmed = log.slice(-5000);
  await fs.writeJson(getCostLog(), trimmed, { spaces: 2 });
}

export async function recordCost(
  model: string,
  usage: { input: number; output: number },
  sessionId = 'cli'
): Promise<void> {
  const cost = calcCostUsd(model, usage.input, usage.output);
  const entry: CostEntry = {
    sessionId,
    date: new Date().toISOString().slice(0, 10),
    model,
    inputTokens: usage.input,
    outputTokens: usage.output,
    costUsd: cost,
    ts: new Date().toISOString()
  };
  const log = await loadLog();
  log.push(entry);
  await saveLog(log);
}

export async function getDailyCost(date?: string): Promise<{ costUsd: number; inputTokens: number; outputTokens: number; turns: number }> {
  const d = date || new Date().toISOString().slice(0, 10);
  const log = await loadLog();
  const entries = log.filter(e => e.date === d);
  return {
    costUsd: entries.reduce((s, e) => s + e.costUsd, 0),
    inputTokens: entries.reduce((s, e) => s + e.inputTokens, 0),
    outputTokens: entries.reduce((s, e) => s + e.outputTokens, 0),
    turns: entries.length
  };
}

export async function getSessionCost(sessionId: string): Promise<{ costUsd: number; inputTokens: number; outputTokens: number; turns: number }> {
  const log = await loadLog();
  const entries = log.filter(e => e.sessionId === sessionId);
  return {
    costUsd: entries.reduce((s, e) => s + e.costUsd, 0),
    inputTokens: entries.reduce((s, e) => s + e.inputTokens, 0),
    outputTokens: entries.reduce((s, e) => s + e.outputTokens, 0),
    turns: entries.length
  };
}

export function formatSessionSummary(
  model: string,
  usage: { input: number; output: number; cacheRead?: number },
  sessionCost?: { costUsd: number; turns: number }
): string {
  const cost = calcCostUsd(model, usage.input, usage.output);
  const lines = [
    '─── Session ────────────────────────────',
    `  Model:     ${model}`,
    `  In:        ${usage.input.toLocaleString()} tokens`,
    `  Out:       ${usage.output.toLocaleString()} tokens`,
    usage.cacheRead ? `  Cache:     ${usage.cacheRead.toLocaleString()} tokens (saved)` : '',
    `  This turn: $${cost.toFixed(4)}`,
    sessionCost ? `  Session:   $${sessionCost.costUsd.toFixed(4)} (${sessionCost.turns} turns)` : '',
    '────────────────────────────────────────'
  ].filter(Boolean);
  return lines.join('\n');
}
