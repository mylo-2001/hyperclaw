/**
 * src/infra/cost-tracker.ts
 * Token counting + per-session cost summary. Persists usage for reporting.
 */

import fs from 'fs-extra';
import path from 'path';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
}

export interface CostEntry {
  sessionId: string;
  source?: string;
  /** Optional: tenant ID for multi-tenant billing */
  tenantId?: string;
  timestamp: string;
  usage: TokenUsage;
  costUsd: number;
  model?: string;
}

/** Rough cost per 1M tokens by provider/model (Claude Sonnet ballpark). */
const DEFAULT_COST_PER_1M_INPUT = 3;
const DEFAULT_COST_PER_1M_OUTPUT = 15;

export function estimateCost(
  usage?: TokenUsage,
  model?: string
): number {
  if (!usage) return 0;
  const inp = (usage.input || 0) + (usage.cacheRead || 0);
  const inputCost = (inp / 1e6) * DEFAULT_COST_PER_1M_INPUT;
  const outputCost = (usage.output || 0) / 1e6 * DEFAULT_COST_PER_1M_OUTPUT;
  return inputCost + outputCost;
}

/** Path to cost log file for a session. */
function getCostLogPath(baseDir: string, sessionId: string): string {
  return path.join(baseDir, 'costs', `session-${sessionId}.jsonl`);
}

/** Append a cost entry for a session. */
export async function recordUsage(
  baseDir: string,
  sessionId: string,
  usage: TokenUsage,
  opts?: { source?: string; model?: string; tenantId?: string }
): Promise<void> {
  const costUsd = estimateCost(usage, opts?.model);
  const entry: CostEntry = {
    sessionId,
    source: opts?.source,
    tenantId: opts?.tenantId,
    timestamp: new Date().toISOString(),
    usage,
    costUsd,
    model: opts?.model
  };
  const dir = path.join(baseDir, 'costs');
  await fs.ensureDir(dir);
  const fp = getCostLogPath(baseDir, sessionId);
  await fs.appendFile(fp, JSON.stringify(entry) + '\n');
}

/** Read and aggregate all entries for a session. */
export async function getSessionSummary(
  baseDir: string,
  sessionId: string
): Promise<{ input: number; output: number; cacheRead: number; costUsd: number; runs: number }> {
  const fp = getCostLogPath(baseDir, sessionId);
  if (!(await fs.pathExists(fp))) {
    return { input: 0, output: 0, cacheRead: 0, costUsd: 0, runs: 0 };
  }
  const lines = (await fs.readFile(fp, 'utf8')).trim().split('\n').filter(Boolean);
  let input = 0, output = 0, cacheRead = 0, costUsd = 0;
  for (const line of lines) {
    try {
      const e: CostEntry = JSON.parse(line);
      input += e.usage.input || 0;
      output += e.usage.output || 0;
      cacheRead += (e.usage.cacheRead || 0);
      costUsd += e.costUsd || 0;
    } catch {}
  }
  return { input, output, cacheRead, costUsd, runs: lines.length };
}

/** Get global summary across all sessions. */
export async function getGlobalSummary(baseDir: string): Promise<{
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCostUsd: number;
  totalRuns: number;
}> {
  const dir = path.join(baseDir, 'costs');
  if (!(await fs.pathExists(dir))) {
    return { sessions: 0, totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCostUsd: 0, totalRuns: 0 };
  }
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith('session-') && f.endsWith('.jsonl'));
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCostUsd = 0, totalRuns = 0;
  for (const f of files) {
    const fp = path.join(dir, f);
    const content = await fs.readFile(fp, 'utf8').catch(() => '');
    for (const line of content.trim().split('\n').filter(Boolean)) {
      try {
        const e: CostEntry = JSON.parse(line);
        totalInput += e.usage.input || 0;
        totalOutput += e.usage.output || 0;
        totalCacheRead += (e.usage.cacheRead || 0);
        totalCostUsd += e.costUsd || 0;
        totalRuns++;
      } catch {}
    }
  }
  return {
    sessions: files.length,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCostUsd,
    totalRuns
  };
}
