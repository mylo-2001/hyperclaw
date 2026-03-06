/**
 * src/agent/orchestrator.ts
 * Real orchestrator: multi-step planner with retry, session context, checkpointing, error recovery.
 * OpenClaw-level orchestration.
 */

import type { AgentEngineOptions, AgentEngineResult } from './engine';

export interface PlanStep {
  goal: string;
  done?: boolean;
  result?: string;
}

export interface OrchestratorCheckpoint {
  goal: string;
  steps: string[];
  completedIndices: number[];
  results: string[];
  lastError?: string;
}

export interface OrchestratorOptions extends AgentEngineOptions {
  /** Max retries per step before failing */
  maxStepRetries?: number;
  /** Enable checkpointing for partial resumption */
  checkpointable?: boolean;
  /** Restore from checkpoint (from previous run) */
  checkpoint?: OrchestratorCheckpoint;
  /** Callback when checkpoint is saved (e.g. for persistence) */
  onCheckpoint?: (cp: OrchestratorCheckpoint) => void | Promise<void>;
}

const PLAN_PROMPT = `Break this goal into 1-4 concrete, executable steps. Output ONLY numbered lines.
Format: 1. step one
2. step two
...
No other text.`;

const PARALLEL_PLAN_PROMPT = `Break this goal into 2-6 steps. Steps that can run IN PARALLEL (independent) put on the SAME line with | between them.
Format:
1. step one
2. step A | step B
3. step three
Example: "Compare Python vs Node for APIs" → 1. research Python for APIs | research Node for APIs
2. summarize comparison
Output ONLY numbered lines. No other text.`;

/** Parse parallel plan into waves: [['A'], ['B','C'], ['D']] = A then B||C then D. */
function parseParallelWaves(text: string): string[][] {
  const waves: string[][] = [];
  const lines = (text || '').trim().split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s*(.+)$/);
    if (!m) continue;
    const parts = m[1].split(/\|/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) waves.push(parts);
  }
  return waves;
}

/** Parse "1. X\n2. Y" into step strings. */
function parseSteps(text: string): string[] {
  const steps: string[] = [];
  const lines = (text || '').trim().split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s*(.+)$/);
    if (m) steps.push(m[1].trim());
  }
  return steps.length > 0 ? steps : [];
}

/** Multi-step with retry, session context, checkpointing, error recovery. */
export async function runMultiStep(
  goal: string,
  opts: OrchestratorOptions & Parameters<typeof import('./engine').runAgentEngine>[1]
): Promise<AgentEngineResult> {
  const { runAgentEngine } = await import('./engine');
  const maxRetries = opts.maxStepRetries ?? 2;
  const checkpointable = opts.checkpointable ?? false;
  let steps: string[];
  let results: string[] = [];
  let startIndex = 0;

  // Restore from checkpoint if provided
  if (opts.checkpoint && opts.checkpoint.goal === goal && opts.checkpoint.steps.length > 0) {
    steps = opts.checkpoint.steps;
    results = [...(opts.checkpoint.results ?? [])];
    startIndex = results.length;
  } else {
    const planOpts = opts.sessionId && opts.appendTranscript
      ? opts
      : { ...opts, sessionId: opts.sessionId, appendTranscript: opts.appendTranscript };
    const planResult = await runAgentEngine(
      `${PLAN_PROMPT}\n\nGoal: ${goal}`,
      planOpts
    );
    steps = parseSteps(planResult.text);
    if (steps.length === 0) return runAgentEngine(goal, opts);
  }

  let lastUsage: { input: number; output: number; cacheRead?: number } | undefined;

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];
    const ctx = results.length > 0
      ? `Previous results:\n${results.map((r, j) => `Step ${j + 1}: ${r.slice(0, 400)}${r.length > 400 ? '...' : ''}`).join('\n')}\n\n`
      : '';
    const message = `${ctx}Step ${i + 1}: ${step}`;

    let lastErr: string | undefined;
    let stepResult: AgentEngineResult | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      stepResult = await runAgentEngine(message, opts);
      if (stepResult.usage) lastUsage = stepResult.usage;
      if (!stepResult.error) {
        results.push(stepResult.text);
        if (checkpointable && opts.onCheckpoint) {
          await Promise.resolve(opts.onCheckpoint({
            goal,
            steps,
            completedIndices: [...Array(results.length)].map((_, k) => k),
            results: [...results]
          }));
        }
        break;
      }
      lastErr = stepResult.error;
      if (attempt < maxRetries && opts.onToken) {
        opts.onToken(`[Retry ${attempt + 1}/${maxRetries} for step ${i + 1}…]\n`);
      }
    }
    if (lastErr) {
      const summary = results.length > 0
        ? results.map((r, j) => `**Step ${j + 1}**\n${r}`).join('\n\n---\n\n') + `\n\n**Step ${i + 1}** (failed): ${lastErr}`
        : `Step ${i + 1} failed: ${lastErr}`;
      opts.onDone?.(summary);
      return { text: summary, error: lastErr, usage: lastUsage };
    }
  }

  const summary = results.map((r, i) => `**Step ${i + 1}**\n${r}`).join('\n\n---\n\n');
  opts.onDone?.(summary);
  return { text: summary, usage: lastUsage };
}

/** Parallel sub-agents: plan waves → run each wave in parallel (Promise.all) → aggregate. */
export async function runMultiStepParallel(
  goal: string,
  opts: OrchestratorOptions & Parameters<typeof import('./engine').runAgentEngine>[1]
): Promise<AgentEngineResult> {
  const { runAgentEngine } = await import('./engine');
  const planOpts = { ...opts, sessionId: undefined, appendTranscript: undefined };
  const planResult = await runAgentEngine(
    `${PARALLEL_PLAN_PROMPT}\n\nGoal: ${goal}`,
    planOpts
  );
  const waves = parseParallelWaves(planResult.text);
  if (waves.length === 0) return runAgentEngine(goal, opts);

  const allResults: string[] = [];
  let lastUsage = planResult.usage;

  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    const ctx = allResults.length > 0
      ? `Previous results:\n${allResults.map((r, j) => `Result ${j + 1}: ${r.slice(0, 300)}${r.length > 300 ? '...' : ''}`).join('\n')}\n\n`
      : '';
    const messages = wave.map((step, i) => `${ctx}Sub-task ${w + 1}.${i + 1}: ${step}`);
    const runOpts = { ...opts, onToken: undefined, onDone: undefined };
    const results = await Promise.all(messages.map(msg => runAgentEngine(msg, runOpts)));
    for (const r of results) {
      if (r.usage) lastUsage = r.usage;
      if (r.error) {
        const summary = allResults.map((r0, j) => `**Sub-agent ${j + 1}**\n${r0}`).join('\n\n---\n\n')
          + `\n\n**Failed**\n${r.text}`;
        opts.onDone?.(summary);
        return { text: summary, error: r.error, usage: lastUsage };
      }
      allResults.push(r.text);
    }
  }

  const summary = allResults.map((r, i) => `**Sub-agent ${i + 1}**\n${r}`).join('\n\n---\n\n');
  opts.onDone?.(summary);
  return { text: summary, usage: lastUsage };
}

/** Single-run passthrough (unchanged). */
export async function runWithPlan(
  message: string,
  opts: AgentEngineOptions & Parameters<typeof import('./engine').runAgentEngine>[1]
): Promise<AgentEngineResult> {
  const { runAgentEngine } = await import('./engine');
  return runAgentEngine(message, opts);
}

export async function planSteps(goal: string): Promise<PlanStep[]> {
  const { runAgentEngine } = await import('./engine');
  const r = await runAgentEngine(`${PLAN_PROMPT}\n\nGoal: ${goal}`, {});
  return parseSteps(r.text).map(g => ({ goal: g }));
}
