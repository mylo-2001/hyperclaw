/**
 * src/agent/runner.ts
 * `hyperclaw agent --message "..." --thinking high|medium|low`
 * Thin wrapper over runAgentEngine. Single runtime path.
 */

import chalk from 'chalk';
import ora from 'ora';
import { getConfigPath } from '../../../shared/src/index';
import fs from 'fs-extra';
import { runAgentEngine } from './engine';

export type ThinkingLevel = 'high' | 'medium' | 'low' | 'none';

const THINKING_BUDGET: Record<ThinkingLevel, number> = {
  high: 10000,
  medium: 4000,
  low: 1000,
  none: 0
};

export interface AgentRunOptions {
  message: string;
  thinking: ThinkingLevel;
  model?: string;
  sessionId?: string;
  stream?: boolean;
  workspace?: string;
  verbose?: boolean;
  /** Use multi-step planner (decompose → execute each step → aggregate) */
  multiStep?: boolean;
  /** Use parallel sub-agents (decompose → run independent steps in parallel) */
  parallel?: boolean;
}

export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const cfg = await fs.readJson(getConfigPath()).catch(() => null);
  if (!cfg) {
    console.log(chalk.red('\n  ✖  No configuration found. Run: hyperclaw init\n'));
    return;
  }

  const thinkingBudget = THINKING_BUDGET[opts.thinking];
  const model = opts.model || cfg.provider?.modelId || 'openrouter/auto';

  console.log(chalk.bold.cyan('\n  ⚡ HYPERCLAW AGENT RUN\n'));
  console.log(`  ${chalk.gray('Model:')}     ${model}`);
  console.log(`  ${chalk.gray('Thinking:')} ${opts.thinking} (budget: ${thinkingBudget} tokens)`);
  console.log(`  ${chalk.gray('Session:')}  ${opts.sessionId || 'ephemeral'}`);
  console.log();

  const spinner = ora(opts.parallel ? 'Planning & running sub-agents in parallel...' : opts.multiStep ? 'Planning & running steps...' : 'Thinking...').start();
  const thinkingLines: string[] = [];

  const engineOpts = {
    sessionId: opts.sessionId,
    source: 'cli',
    elevated: true,
    modelOverride: opts.model,
    workspace: opts.workspace,
    thinkingBudget,
    onToken: () => {},
    onThinking: opts.verbose ? (t: string) => thinkingLines.push(t) : undefined
  };

  const result = opts.parallel
    ? await (await import('./orchestrator')).runMultiStepParallel(opts.message, engineOpts)
    : opts.multiStep
      ? await (await import('./orchestrator')).runMultiStep(opts.message, engineOpts)
      : await runAgentEngine(opts.message, engineOpts);

  spinner.stop();

  if (result.error && result.error !== 'no_api_key') {
    console.log(chalk.red(`\n  ✖  Error: ${result.text}\n`));
    if (result.error === 'no_api_key') {
      console.log(chalk.gray('  Run: hyperclaw config set-key'));
    }
    return;
  }

  if (thinkingLines.length > 0 && opts.verbose) {
    console.log(chalk.dim('\n  ── Thinking ──\n'));
    for (const line of thinkingLines) {
      console.log(chalk.dim('  ' + line.split('\n').join('\n  ')));
    }
    console.log();
  }

  console.log(chalk.bold('\n  Response:\n'));
  console.log('  ' + (result.text || '(empty)').split('\n').join('\n  '));

  if (result.usage) {
    console.log(chalk.gray(`\n  Tokens — input: ${result.usage.input}  output: ${result.usage.output}`));
    if (result.usage.cacheRead) {
      console.log(chalk.gray(`  Cache read: ${result.usage.cacheRead} tokens`));
    }
  }
  console.log();
}
