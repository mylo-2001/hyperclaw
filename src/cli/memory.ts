/**
 * src/cli/memory.ts
 * MemoryManager — AGENTS.md, MEMORY.md, SOUL.md management.
 * Cross-session global rule inheritance + agent persona bootstrap.
 * Update your memory with these rules flow.
 */
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getHyperClawDir } from '../infra/paths';

const getAgentsFile = () => path.join(getHyperClawDir(), 'AGENTS.md');
const getMemoryFile = () => path.join(getHyperClawDir(), 'MEMORY.md');
const getSoulFile = () => path.join(getHyperClawDir(), 'SOUL.md');
const getLogDir = () => path.join(getHyperClawDir(), 'logs');

export interface MemoryData {
  agents: string;
  memory: string;
  soul?: string;
}

export class MemoryManager {

  // ── Bootstrap workspace files ─────────────────────────────────────────────────
  async init(opts: AgentIdentity | { agentName?: string; userName?: string; language?: string; personality?: string; rules?: string[]; wakeWord?: string } = {}): Promise<void> {
    await fs.ensureDir(getHyperClawDir());
    await fs.ensureDir(getLogDir());

    const agentName = opts.agentName || 'HyperClaw';
    const userName = opts.userName || os.userInfo().username;
    const lang = opts.language || 'English';
    const personality = opts.personality || 'Direct and efficient, helpful without being sycophantic, honest about uncertainty';
    const rules = opts.rules && opts.rules.length > 0
      ? opts.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : `1. Always respond in the user's preferred language unless asked otherwise
2. Be concise unless detail is explicitly requested
3. Never share API keys, tokens, or secrets in responses
4. If unsure, ask before acting — especially for destructive operations
5. Log all PC access actions to ~/.hyperclaw/pc-access.log`;

    const today = new Date().toISOString().slice(0, 10);

    // AGENTS.md — global rules for all sessions and subagents
    if (!(await fs.pathExists(getAgentsFile()))) {
      await fs.writeFile(getAgentsFile(), `# AGENTS.md — Global Rules
> All sessions and subagents must follow these rules.

## Identity
- Agent name: ${agentName}
- User name: ${userName}
- Primary language: ${lang}
- Created: ${today}

## Behavior Rules
${rules}

## DM Policy Default
- Require pairing before responding to unknown senders
- Allowlist: (add trusted IDs here)

## Hierarchy
- SOUL.md: persona and values (read-only by subagents)
- AGENTS.md: operational rules (this file)
- MEMORY.md: accumulated facts about the user
`);
    }

    // MEMORY.md — accumulated facts
    if (!(await fs.pathExists(getMemoryFile()))) {
      await fs.writeFile(getMemoryFile(), `# MEMORY.md — User Context
> Automatically updated by HyperClaw after each session.

## User Profile
- Name: ${userName}
- Language: ${lang}
- Initialized: ${today}

## Notes
(auto-populated from conversations)
`);
    }

    // SOUL.md — agent persona (if not exists)
    if (!(await fs.pathExists(getSoulFile()))) {
      await fs.writeFile(getSoulFile(), `# SOUL.md — Agent Persona
> Who I am and how I behave.

## Name
${agentName}

## Personality
- ${personality.replace(/\n/g, '\n- ')}

## Values
- User autonomy first
- Do no harm
- Transparency about capabilities and limits

## Wake phrase
${(opts as any).wakeWord ? (opts as any).wakeWord : `Wake up, ${agentName}! Your user ${userName} needs you.`}
`);
    }

    // Daily log entry
    const logFile = path.join(getLogDir(), `${today}.md`);
    if (!(await fs.pathExists(logFile))) {
      await fs.writeFile(logFile, `# Session Log — ${today}\n\n`);
    }
  }

  // ── Load all memory files ─────────────────────────────────────────────────────
  async load(): Promise<MemoryData | null> {
    if (!(await fs.pathExists(getAgentsFile()))) return null;
    const agents = await fs.readFile(getAgentsFile(), 'utf8').catch(() => '');
    const memory = await fs.readFile(getMemoryFile(), 'utf8').catch(() => '');
    const soul = await fs.readFile(getSoulFile(), 'utf8').catch(() => undefined);
    return { agents, memory, soul };
  }

  // ── Append a global rule to AGENTS.md ────────────────────────────────────────
  async appendRule(rule: string): Promise<void> {
    await fs.ensureDir(getHyperClawDir());
    const today = new Date().toISOString().slice(0, 10);
    const line = `\n- ${today}: ${rule}\n`;
    await fs.appendFile(getAgentsFile(), line);
    console.log(chalk.green(`  ✅ Rule added to AGENTS.md: ${rule}`));
  }

  // ── Add a fact to MEMORY.md ───────────────────────────────────────────────────
  async addMemory(fact: string): Promise<void> {
    await fs.ensureDir(getHyperClawDir());
    const today = new Date().toISOString().slice(0, 10);
    await fs.appendFile(getMemoryFile(), `\n- ${today}: ${fact}\n`);
    console.log(chalk.green(`  ✅ Memory saved: ${fact}`));
  }

  // ── Update SOUL.md ────────────────────────────────────────────────────────────
  async updateSoul(content: string): Promise<void> {
    await fs.ensureDir(getHyperClawDir());
    await fs.writeFile(getSoulFile(), content);
    console.log(chalk.green('  ✅ SOUL.md updated'));
  }

  // ── Display all memory ────────────────────────────────────────────────────────
  async show(): Promise<void> {
    const data = await this.load();
    if (!data) {
      console.log(chalk.yellow('\n  No memory initialized. Run: hyperclaw init\n'));
      return;
    }
    console.log(chalk.bold.cyan('\n  🧠 MEMORY\n'));

    for (const [label, content] of [
      ['SOUL.md', data.soul], ['AGENTS.md', data.agents], ['MEMORY.md', data.memory]
    ]) {
      if (!content) continue;
      console.log(chalk.bold.white(`  ── ${label} ──`));
      const lines = (content as string).split('\n').slice(0, 20);
      for (const line of lines) {
        if (line.startsWith('#')) console.log(chalk.cyan(`  ${line}`));
        else if (line.startsWith('-')) console.log(chalk.gray(`  ${line}`));
        else console.log(`  ${line}`);
      }
      console.log();
    }
  }

  // ── Persona bootstrap wizard ──────────────────────────────────────────────────
  async runPersonaBootstrap(): Promise<{ agentName: string; userName: string }> {
    console.log(chalk.bold.cyan('\n  🌅 Wake up, my friend!\n'));

    const { agentName } = await inquirer.prompt([{
      type: 'input', name: 'agentName',
      message: 'What should I call myself? (agent name)',
      default: 'HyperClaw'
    }]);

    const { userName } = await inquirer.prompt([{
      type: 'input', name: 'userName',
      message: `What shall ${agentName} call you?`,
      default: os.userInfo().username
    }]);

    console.log(chalk.green(`\n  ✨ I am ${agentName}. Hello, ${userName}.\n`));
    return { agentName, userName };
  }

  // ── Get full context string for AI injection ──────────────────────────────────
  async getContextForAI(): Promise<string> {
    let context = '';
    for (const [label, file] of [
      ['SOUL', getSoulFile()], ['AGENTS', getAgentsFile()], ['MEMORY', getMemoryFile()]
    ]) {
      if (await fs.pathExists(file as string)) {
        const content = await fs.readFile(file as string, 'utf8');
        context += `## ${label}.md\n${content}\n\n`;
      }
    }
    return context;
  }

  // ── Search memory ─────────────────────────────────────────────────────────────
  async search(query: string): Promise<void> {
    const data = await this.load();
    if (!data) { console.log(chalk.gray('  No memory\n')); return; }
    const allText = [data.agents, data.memory, data.soul || ''].join('\n');
    const lines = allText.split('\n').filter(l => l.toLowerCase().includes(query.toLowerCase()));
    if (lines.length === 0) { console.log(chalk.gray(`  Nothing found for "${query}"\n`)); return; }
    console.log(chalk.bold.cyan(`\n  🔍 "${query}"\n`));
    lines.forEach(l => console.log(`  ${l}`));
    console.log();
  }

  // ── Clear memory ──────────────────────────────────────────────────────────────
  async clear(file: 'memory' | 'all' = 'memory'): Promise<void> {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm', name: 'confirm',
      message: `Clear ${file === 'all' ? 'ALL memory files' : 'MEMORY.md'}?`,
      default: false
    }]);
    if (!confirm) return;
    if (file === 'all') {
      await fs.remove(getAgentsFile());
      await fs.remove(getMemoryFile());
      await fs.remove(getSoulFile());
      console.log(chalk.green('  ✅ All memory cleared'));
    } else {
      await fs.writeFile(getMemoryFile(), '# MEMORY.md\n\n');
      console.log(chalk.green('  ✅ MEMORY.md cleared'));
    }
  }
}

export type AgentIdentity = {
  agentName: string;
  userName: string;
  language?: string;
  personality?: string;
  rules?: string[];
  wakeWord?: string;
  wakeUpMessage?: string;
  systemPrompt?: string;
};
