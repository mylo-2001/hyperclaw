import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import ora from 'ora';

export interface AgentIdentity {
  agentName: string;
  userName: string;
  personality: string;
  language: string;
  rules: string[];
}

export class MemoryManager {
  private baseDir: string;
  private agentsFile: string;
  private memoryFile: string;
  private logFile: string;

  constructor(workspaceDir?: string) {
    this.baseDir = workspaceDir || path.join(os.homedir(), '.hyperclaw');
    this.agentsFile = path.join(this.baseDir, 'AGENTS.md');
    this.memoryFile = path.join(this.baseDir, 'MEMORY.md');
    this.logFile = path.join(this.baseDir, 'logs', `${new Date().toISOString().split('T')[0]}.md`);
  }

  async init(identity: AgentIdentity): Promise<void> {
    await fs.ensureDir(this.baseDir);
    await fs.ensureDir(path.join(this.baseDir, 'logs'));

    const spinner = ora('Initializing memory and agent identity...').start();

    await this.writeAgentsMd(identity);
    await this.writeMemoryMd(identity);
    await this.initDailyLog();

    spinner.succeed('AGENTS.md, MEMORY.md and daily log created');

    console.log(chalk.gray(`   📁 Workspace: ${this.baseDir}`));
    console.log(chalk.gray(`   📄 AGENTS.md: ${this.agentsFile}`));
    console.log(chalk.gray(`   🧠 MEMORY.md: ${this.memoryFile}`));
    console.log();
  }

  private async writeAgentsMd(id: AgentIdentity): Promise<void> {
    const content = `# AGENTS.md — HyperClaw Global Agent Rules
> Generated: ${new Date().toISOString()}
> This file is read by ALL sessions and subagents.

## Identity
- **Agent Name:** ${id.agentName}
- **User Name:** ${id.userName}
- **Personality:** ${id.personality}
- **Language:** ${id.language}

## Global Rules
${id.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Subagent Hierarchy
- Parent: HyperClaw Core
- Children: Channel Agents (Telegram, Discord, etc.)
- All subagents MUST inherit these rules
- No subagent may override global safety rules

## Memory Protocol
- Write significant events to MEMORY.md
- Log daily interactions to logs/YYYY-MM-DD.md
- Always read AGENTS.md at session start

## Safety Boundaries
- Never reveal the auth token
- Never execute code outside the sandbox skill
- Always ask for confirmation before irreversible actions
- Refuse requests that violate user privacy

## Cross-Session Persistence
- Session state is stored in ~/.hyperclaw/sessions/
- Use memory tools to recall past interactions
`;

    await fs.writeFile(this.agentsFile, content, 'utf8');
  }

  private async writeMemoryMd(id: AgentIdentity): Promise<void> {
    const content = `# MEMORY.md — HyperClaw Persistent Memory
> Initialized: ${new Date().toISOString()}

## User Profile
- Name: ${id.userName}
- Preferred language: ${id.language}
- Agent alias: ${id.agentName}

## Session History
*(Populated automatically during sessions)*

## Key Facts
*(Write important information here for future sessions)*

## Reminders
*(Active reminders are listed here)*
`;

    await fs.writeFile(this.memoryFile, content, 'utf8');
  }

  private async initDailyLog(): Promise<void> {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const content = `# Daily Log — ${today}

## Sessions
- ${new Date().toLocaleTimeString()} — Session initialized

## Notes
`;

    await fs.ensureDir(path.dirname(this.logFile));
    await fs.writeFile(this.logFile, content, 'utf8');
  }

  async appendRule(rule: string): Promise<void> {
    const spinner = ora('Writing rule to AGENTS.md...').start();
    const content = await fs.readFile(this.agentsFile, 'utf8');
    const updated = content.replace('*(Populated automatically during sessions)*',
      `*(Populated automatically during sessions)*\n\n### Added Rule\n- ${rule}`);
    await fs.writeFile(this.agentsFile, updated, 'utf8');
    spinner.succeed(`Rule added to AGENTS.md`);
  }

  async addMemory(fact: string): Promise<void> {
    const spinner = ora('Writing to MEMORY.md...').start();
    const content = await fs.readFile(this.memoryFile, 'utf8');
    const entry = `\n- [${new Date().toISOString()}] ${fact}`;
    const updated = content.replace('*(Write important information here for future sessions)*',
      `*(Write important information here for future sessions)*${entry}`);
    await fs.writeFile(this.memoryFile, updated, 'utf8');
    spinner.succeed(`Memory updated`);
  }

  async load(): Promise<{ agents: string; memory: string } | null> {
    try {
      const agents = await fs.readFile(this.agentsFile, 'utf8');
      const memory = await fs.readFile(this.memoryFile, 'utf8');
      return { agents, memory };
    } catch {
      return null;
    }
  }

  getBaseDir(): string { return this.baseDir; }
}


// ─── Workspace file generation (SOUL, USER, TOOLS, HEARTBEAT) ──────────────

export async function initWorkspaceFiles(identity: AgentIdentity, workspaceDir: string): Promise<void> {
  const files: Record<string, string> = {
    'SOUL.md': generateSoul(identity),
    'USER.md': generateUser(identity),
    'TOOLS.md': generateTools(),
    'HEARTBEAT.md': generateHeartbeat(),
    'BOOTSTRAP.md': generateBootstrap(identity)
  };

  await fs.ensureDir(workspaceDir);

  for (const [fname, content] of Object.entries(files)) {
    const fpath = path.join(workspaceDir, fname);
    if (!(await fs.pathExists(fpath))) {
      await fs.writeFile(fpath, content, 'utf8');
    }
  }
}

function generateSoul(id: AgentIdentity): string {
  return `# SOUL.md — Agent Personality & Values
> Generated: ${new Date().toISOString()}

## Core Identity
- **Name:** ${id.agentName}
- **Personality:** ${id.personality}
- **Primary language:** ${id.language}

## Values
- Honesty over flattery
- Brevity — get to the point
- Respect autonomy — suggest, never demand
- Always confirm before irreversible actions

## Boundaries
- Never reveal gateway tokens or API keys
- Always ask confirmation before destructive actions
- Never claim to be human when sincerely asked
`;
}

function generateUser(id: AgentIdentity): string {
  return `# USER.md — About the Person I Work For
> Generated: ${new Date().toISOString()}

## Identity
- **Name:** ${id.userName}
- **Preferred language:** ${id.language}

## Communication Preferences
- Tone: casual
- Response length: auto

## What I'm Working On
*(Update this regularly — agent uses it for context)*

## My Stack
*(Add your tools here)*

## Do NOT do these things
- Pad responses with unnecessary filler

## Always do these things
- Respond in ${id.language} unless I write in another language
`;
}

function generateTools(): string {
  return `# TOOLS.md — Available Skills & Tools
> Generated: ${new Date().toISOString()}

## Active Skills
| ID | Name | Status |
|----|------|--------|
| reminders | Smart Reminders | ✅ enabled |
| translator | Real-time Translator | ✅ enabled |

## Add More Skills
\`\`\`
hyperclaw hub         # Browse available skills
hyperclaw hub --install web-search
\`\`\`

## MCP Servers
No MCP servers configured. Add with: \`hyperclaw mcp add\`
`;
}

function generateHeartbeat(): string {
  return `# HEARTBEAT.md — System Health Log
> Initialized: ${new Date().toISOString()}

Auto-written by the gateway-health hook every 5 minutes.
Enable with: \`hyperclaw hooks enable gateway-health\`

## Last Status
Pending first heartbeat...
`;
}

function generateBootstrap(id: AgentIdentity): string {
  return `# BOOTSTRAP.md β€” Fast Start Context
> Generated: ${new Date().toISOString()}

## Mission
Help ${id.userName} move the current task forward with minimal setup friction.

## First Tasks
1. Read AGENTS.md, USER.md, TOOLS.md, and MEMORY.md if present.
2. Confirm the current repo / project shape before editing anything.
3. Prefer the smallest change that unblocks progress.

## Environment
- Agent: ${id.agentName}
- User: ${id.userName}
- Language: ${id.language}

## Current Constraints
- Ask before irreversible actions.
- Keep secrets out of workspace markdown files.
- Update docs when behavior changes.

## Definition Of Done
- Requested change is implemented.
- Relevant checks or verifications are run when available.
- Important follow-up risks are documented briefly.
`;
}
