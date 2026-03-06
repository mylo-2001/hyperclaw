/**
 * src/infra/observability.ts
 * Agent run traces: tool calls, latency, usage, failure attribution.
 */

export interface ToolTraceEntry {
  name: string;
  input: unknown;
  result: string;
  at: string;
}

export interface AgentRunTrace {
  sessionId?: string;
  source?: string;
  startTime: string;
  endTime?: string;
  toolCalls: ToolTraceEntry[];
  usage?: { input: number; output: number; cacheRead?: number };
  /** Rough cost estimate (USD) from input/output tokens */
  costUsd?: number;
  error?: string;
}

/** Rough cost per 1M tokens (Claude Sonnet ballpark). */
const COST_PER_1M_INPUT = 3;
const COST_PER_1M_OUTPUT = 15;

export function estimateCost(usage?: { input: number; output: number; cacheRead?: number }): number {
  if (!usage) return 0;
  const inp = (usage.input || 0) + (usage.cacheRead || 0);
  return (inp / 1e6) * COST_PER_1M_INPUT + (usage.output || 0) / 1e6 * COST_PER_1M_OUTPUT;
}

export function createRunTracer(sessionId?: string, source?: string): {
  trace: AgentRunTrace;
  onToolCall: (name: string, input: unknown) => void;
  onToolResult: (name: string, result: string) => void;
  onRunEnd: (usage?: { input: number; output: number; cacheRead?: number }, error?: string) => void;
} {
  const startTime = new Date().toISOString();
  const toolCalls: ToolTraceEntry[] = [];
  const pending: Array<{ name: string; input: unknown }> = [];

  const trace: AgentRunTrace = {
    sessionId,
    source,
    startTime,
    toolCalls
  };

  return {
    trace,
    onToolCall(name: string, input: unknown) {
      pending.push({ name, input });
    },
    onToolResult(name: string, result: string) {
      const head = pending.shift();
      toolCalls.push({
        name: name || head?.name || 'unknown',
        input: head?.input ?? {},
        result: result.slice(0, 500),
        at: new Date().toISOString()
      });
    },
    onRunEnd(usage?, error?) {
      trace.endTime = new Date().toISOString();
      trace.usage = usage;
      trace.costUsd = estimateCost(usage);
      trace.error = error;
    }
  };
}

/** List trace files (for querying). */
export async function listTraces(baseDir: string, limit = 50): Promise<AgentRunTrace[]> {
  try {
    const fs = await import('fs-extra');
    const path = await import('path');
    const dir = path.join(baseDir, 'traces');
    if (!(await fs.pathExists(dir))) return [];
    const files = (await fs.readdir(dir))
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => path.join(dir, f));
    const stats = await Promise.all(files.map(async (fp: string) => ({ fp, mtime: (await fs.stat(fp)).mtime.getTime() })));
    stats.sort((a, b) => b.mtime - a.mtime);
    const out: AgentRunTrace[] = [];
    for (const { fp } of stats.slice(0, limit)) {
      try {
        out.push(await fs.readJson(fp));
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

/** Write trace to file (e.g. ~/.hyperclaw/traces/). */
export async function writeTraceToFile(
  baseDir: string,
  trace: AgentRunTrace
): Promise<string | null> {
  try {
    const fs = await import('fs-extra');
    const path = await import('path');
    const dir = path.join(baseDir, 'traces');
    await fs.ensureDir(dir);
    const name = `run-${trace.startTime.replace(/[:.]/g, '-')}.json`;
    const fp = path.join(dir, name);
    await fs.writeJson(fp, trace, { spaces: 0 });
    return fp;
  } catch {
    return null;
  }
}
