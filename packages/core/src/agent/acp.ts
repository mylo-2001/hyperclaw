/**
 * src/agent/acp.ts
 * ACP (Agent Communication Protocol) — thread-bound agent sessions.
 * Matches OpenClaw's ACP pattern: each thread gets its own agent context.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export type ThreadStatus = 'active' | 'idle' | 'paused' | 'terminated';
export type AgentRole = 'orchestrator' | 'subagent' | 'specialist';

export interface ACPMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface ACPThread {
  id: string;
  name: string;
  channelId?: string;
  agentRole: AgentRole;
  workspace: string;
  status: ThreadStatus;
  model: string;
  messages: ACPMessage[];
  createdAt: string;
  lastActiveAt: string;
  metadata: Record<string, unknown>;
}

export class ACPThreadManager extends EventEmitter {
  private threadsDir: string;

  constructor() {
    super();
    this.threadsDir = path.join(os.homedir(), '.hyperclaw', 'threads');
    fs.ensureDirSync(this.threadsDir);
  }

  private threadPath(id: string): string {
    return path.join(this.threadsDir, `${id}.json`);
  }

  async create(options: {
    name?: string;
    channelId?: string;
    agentRole?: AgentRole;
    model?: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ACPThread> {
    const id = crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();

    const thread: ACPThread = {
      id,
      name: options.name || `Thread ${id.slice(0, 6)}`,
      channelId: options.channelId,
      agentRole: options.agentRole || 'subagent',
      workspace: path.join(os.homedir(), '.hyperclaw'),
      status: 'active',
      model: options.model || 'openrouter/auto',
      messages: options.systemPrompt
        ? [{ id: 'sys-0', threadId: id, role: 'system', content: options.systemPrompt, timestamp: now }]
        : [],
      createdAt: now,
      lastActiveAt: now,
      metadata: options.metadata || {}
    };

    await this.save(thread);
    this.emit('thread:created', thread);
    return thread;
  }

  async get(id: string): Promise<ACPThread | null> {
    try {
      return await fs.readJson(this.threadPath(id));
    } catch {
      return null;
    }
  }

  async save(thread: ACPThread): Promise<void> {
    await fs.writeJson(this.threadPath(thread.id), thread, { spaces: 2 });
  }

  async append(threadId: string, message: Omit<ACPMessage, 'id' | 'threadId' | 'timestamp'>): Promise<ACPMessage> {
    const thread = await this.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const msg: ACPMessage = {
      ...message,
      id: crypto.randomBytes(4).toString('hex'),
      threadId,
      timestamp: new Date().toISOString()
    };

    thread.messages.push(msg);
    thread.lastActiveAt = msg.timestamp;
    await this.save(thread);
    this.emit('message:appended', { thread, message: msg });
    return msg;
  }

  async list(filter?: { channelId?: string; status?: ThreadStatus }): Promise<ACPThread[]> {
    const files = await fs.readdir(this.threadsDir);
    const threads: ACPThread[] = [];

    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const t = await fs.readJson(path.join(this.threadsDir, f));
        if (filter?.channelId && t.channelId !== filter.channelId) continue;
        if (filter?.status && t.status !== filter.status) continue;
        threads.push(t);
      } catch {}
    }

    return threads.sort((a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
  }

  async terminate(threadId: string): Promise<void> {
    const thread = await this.get(threadId);
    if (!thread) return;
    thread.status = 'terminated';
    await this.save(thread);
    this.emit('thread:terminated', thread);
  }

  async pause(threadId: string): Promise<void> {
    const thread = await this.get(threadId);
    if (!thread) return;
    thread.status = 'paused';
    await this.save(thread);
  }

  async resume(threadId: string): Promise<void> {
    const thread = await this.get(threadId);
    if (!thread) return;
    thread.status = 'active';
    await this.save(thread);
  }

  showList(threads: ACPThread[]): void {
    console.log(chalk.bold.cyan('\n  🧵 ACP THREADS\n'));

    if (threads.length === 0) {
      console.log(chalk.gray('  No threads. Create with: hyperclaw agent --message "..." --new-thread\n'));
      return;
    }

    for (const t of threads) {
      const statusColor = {
        active: chalk.green,
        idle: chalk.cyan,
        paused: chalk.yellow,
        terminated: chalk.gray
      }[t.status];

      const roleLabel = {
        orchestrator: chalk.magenta('[orchestrator]'),
        subagent: chalk.cyan('[subagent]'),
        specialist: chalk.blue('[specialist]')
      }[t.agentRole];

      const age = Math.round((Date.now() - new Date(t.lastActiveAt).getTime()) / 1000 / 60);
      const ageLabel = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;

      console.log(`  ${statusColor('●')} ${chalk.white(t.name)} ${chalk.gray(t.id)}`);
      console.log(`    ${roleLabel}  ${chalk.gray(`model: ${t.model}`)}  ${chalk.gray(`${t.messages.length} messages`)}  ${chalk.gray(ageLabel)}`);
      if (t.channelId) console.log(`    ${chalk.gray(`channel: ${t.channelId}`)}`);
      console.log();
    }
  }
}
