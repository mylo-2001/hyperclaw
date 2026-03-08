/**
 * src/cli/chat.ts
 * Interactive terminal chat — `hyperclaw chat`
 * Multi-turn conversation with the agent directly from the terminal.
 */

import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { getConfigPath, resolveTools, loadWorkspaceContext, loadSkillsContext, InferenceEngine } from '../../packages/core/src/index';
import type { InferenceMessage } from '../../packages/core/src/agent/inference';

const DIVIDER = chalk.gray('  ' + '─'.repeat(56));

function printHeader(model: string, sessionId: string): void {
  console.log();
  console.log(DIVIDER);
  console.log(chalk.bold.cyan('  🦅 HYPERCLAW CHAT'));
  console.log(chalk.gray(`  Model: ${model}  ·  Session: ${sessionId}`));
  console.log(DIVIDER);
  console.log(chalk.gray('  Type your message and press Enter.'));
  console.log(chalk.gray('  Commands: /exit  /clear  /model  /skills  /help'));
  console.log(DIVIDER);
  console.log();
}

function printHelp(): void {
  console.log();
  console.log(chalk.bold('  Commands:'));
  console.log(`  ${chalk.cyan('/exit')}    — quit the chat`);
  console.log(`  ${chalk.cyan('/clear')}   — clear conversation history`);
  console.log(`  ${chalk.cyan('/model')}   — show current model`);
  console.log(`  ${chalk.cyan('/skills')}  — list installed skills + how to add more`);
  console.log(`  ${chalk.cyan('/help')}    — show this help`);
  console.log();
  console.log(chalk.gray('  Tip: you can also tell the agent to install a skill:'));
  console.log(chalk.gray('  "Install the web-search skill" or paste a clawhub.ai link'));
  console.log();
}

async function printSkills(): Promise<void> {
  console.log();
  try {
    const { loadSkills } = await import('../../packages/core/src/agent/skill-loader');
    const skills = await loadSkills();
    if (skills.length === 0) {
      console.log(chalk.gray('  No skills installed yet.'));
    } else {
      console.log(chalk.bold('  Installed skills:'));
      for (const s of skills) {
        console.log(`  ${chalk.cyan('•')} ${chalk.bold(s.title || s.id)} ${chalk.gray(`(${s.id})`)}`);
        if (s.capabilities) console.log(chalk.gray(`    ${s.capabilities}`));
      }
    }
  } catch {
    console.log(chalk.gray('  Could not load skills list.'));
  }
  console.log();
  console.log(chalk.bold('  How to add a skill:'));
  console.log(`  ${chalk.gray('1.')} Tell the agent: ${chalk.cyan('"Install the web-search skill"')}`);
  console.log(`  ${chalk.gray('2.')} Paste a link: ${chalk.cyan('"Install this: https://clawhub.ai/user/skill-name"')}`);
  console.log(`  ${chalk.gray('3.')} CLI (outside chat): ${chalk.cyan('hyperclaw skill install <name>')}`);
  console.log(`  ${chalk.gray('4.')} Re-run wizard:      ${chalk.cyan('hyperclaw onboard')}`);
  console.log();
}

function makeSessionId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export async function runChat(opts: {
  sessionId?: string;
  model?: string;
  thinking?: 'high' | 'medium' | 'low' | 'none';
  workspace?: string;
}): Promise<void> {
  // Load config
  const cfg = await fs.readJson(getConfigPath()).catch(() => null);
  if (!cfg) {
    console.log(chalk.red('\n  No configuration found. Run: hyperclaw onboard\n'));
    return;
  }

  const { getProviderCredentialAsync } = await import('../infra/env-resolve');
  const apiKey = await getProviderCredentialAsync(cfg).catch(() => null);
  const isLocal = ['local', 'ollama', 'lmstudio'].includes(cfg?.provider?.providerId ?? '');
  if (!apiKey && !isLocal) {
    console.log(chalk.red('\n  No API key configured. Run: hyperclaw config set-key\n'));
    return;
  }

  const { getProvider } = await import('./providers');
  const providerMeta = getProvider(cfg?.provider?.providerId ?? '');
  const CUSTOM_IDS = new Set(['groq','mistral','deepseek','perplexity','huggingface','ollama','lmstudio','local','xai','openai','google','minimax','moonshot','qwen','zai','litellm','cloudflare','copilot','vercel-ai','opencode-zen']);
  const isAnthropicVariant = ['anthropic','anthropic-oauth','anthropic-setup-token'].includes(cfg?.provider?.providerId ?? '');
  const provider: 'anthropic' | 'openrouter' | 'custom' = isAnthropicVariant ? 'anthropic'
    : (cfg?.provider?.providerId === 'custom' || isLocal || CUSTOM_IDS.has(cfg?.provider?.providerId ?? '')) ? 'custom' : 'openrouter';

  const rawModel = opts.model || cfg?.provider?.modelId || 'claude-sonnet-4-5';
  const model = rawModel.startsWith('ollama/') ? rawModel.slice(7) : rawModel;
  const resolvedBaseUrl = cfg?.provider?.baseUrl || providerMeta?.baseUrl || (isLocal ? 'http://localhost:11434/v1' : undefined);

  const THINKING_BUDGET: Record<string, number> = { high: 10000, medium: 4000, low: 1000, none: 0 };
  const thinkingBudget = THINKING_BUDGET[opts.thinking ?? 'none'] ?? 0;
  const maxTokens = thinkingBudget > 0 ? thinkingBudget + 4096 : 4096;

  // Build context + tools (once, reused for entire session)
  const context = (await loadWorkspaceContext(opts.workspace)) + (await loadSkillsContext());

  const tools = await resolveTools({
    config: cfg,
    source: 'cli',
    elevated: true,
    daemonMode: false,
  });

  const engineOpts: any = {
    model,
    apiKey,
    provider,
    system: context || undefined,
    tools,
    maxTokens,
    onToken: () => {},
    ...(provider === 'custom' ? { baseUrl: resolvedBaseUrl || '' } : {}),
    ...(thinkingBudget > 0 && model.includes('claude')
      ? { thinking: { budget_tokens: thinkingBudget } } : {}),
  };

  const sessionId = opts.sessionId ?? makeSessionId();
  const messages: InferenceMessage[] = [];

  printHeader(rawModel, sessionId);

  // Set up readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Graceful exit on Ctrl+C
  rl.on('SIGINT', () => {
    console.log(chalk.gray('\n\n  Bye!\n'));
    rl.close();
    process.exit(0);
  });

  await new Promise<void>((resolve) => {
  rl.on('close', resolve);

  const prompt = () => {
    rl.question(chalk.bold.green('  You › '), async (input) => {
      const text = input.trim();

      if (!text) { prompt(); return; }

      // Built-in commands
      if (['/exit', '/quit', '/bye', 'exit', 'quit', 'bye'].includes(text.toLowerCase())) {
        console.log(chalk.gray('\n  Bye!\n'));
        rl.close();
        process.exit(0);
      }
      if (text === '/help') { printHelp(); prompt(); return; }
      if (text === '/skills') { await printSkills(); prompt(); return; }
      if (text === '/model') {
        console.log(chalk.gray(`\n  Model: ${rawModel}\n`));
        prompt(); return;
      }
      if (text === '/clear') {
        messages.length = 0;
        console.log(chalk.gray('\n  Conversation cleared.\n'));
        prompt(); return;
      }

      // Add user message to transcript
      messages.push({ role: 'user', content: text });

      // Spinner while agent thinks
      const spinner = ora({ text: chalk.gray('Thinking...'), color: 'cyan', prefixText: '  ' }).start();
      let responseText = '';

      try {
        const engine = new InferenceEngine({
          ...engineOpts,
          onToken: (token: string) => {
            if (spinner.isSpinning) spinner.stop();
            process.stdout.write(token);
          },
          onToolCall: (name: string) => {
            if (spinner.isSpinning) spinner.stop();
            console.log(chalk.gray(`\n  [tool: ${name}]`));
          },
        });

        // Print agent prefix before streaming
        spinner.stop();
        process.stdout.write(chalk.bold.blue('\n  Agent › '));

        const result = await engine.run(messages);
        responseText = result.text || '';

        // If tokens were streamed, newline already there; if not, print now
        if (!responseText && !result.text) {
          process.stdout.write(chalk.gray('(empty)'));
        }
        console.log('\n');

        if (result.usage) {
          console.log(chalk.gray(`  Tokens — in: ${result.usage.input}  out: ${result.usage.output}\n`));
        }
      } catch (e: any) {
        spinner.stop();
        responseText = `Error: ${e.message}`;
        console.log(chalk.red(`\n  Error: ${e.message}\n`));
      }

      // Add assistant response to transcript for next turn
      if (responseText) {
        messages.push({ role: 'assistant', content: responseText });
      }

      // Auto memory extraction in background
      try {
        const { AutoMemory } = await import('../../packages/core/src/agent/memory-auto');
        const mem = new AutoMemory({ extractEveryNTurns: 3 });
        mem.addTurn('user', text);
        if (responseText) mem.addTurn('assistant', responseText);
        mem.extract().catch(() => {});
      } catch {}

      prompt();
    });
  };

  prompt();
  }); // end new Promise
}
