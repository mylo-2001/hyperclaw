/**
 * packages/core/src/agent/exec-process.ts
 * exec tool (with background/yieldMs/timeout) and process tool (list/poll/log/write/kill/clear/remove).
 *
 * exec tool:
 *   - Foreground: returns output directly (blocks until done or yieldMs expires)
 *   - Backgrounded: returns { status: "running", sessionId, tail }
 *     Triggered by: explicit background:true, or process runs longer than yieldMs
 *
 * process tool actions:
 *   - list:   running + finished sessions with derived name
 *   - poll:   drain new output for a session (also reports exit status)
 *   - log:    read aggregated output (line-based, supports offset + limit)
 *   - write:  send stdin (data, optional eof)
 *   - kill:   terminate a background session
 *   - clear:  remove a finished session from memory
 *   - remove: kill if running, otherwise clear if finished
 *
 * Sessions are scoped per agent and lost on process restart (no disk persistence).
 * Spawned exec commands receive HYPERCLAW_SHELL=exec in their environment.
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import type { Tool } from './inference';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ExecProcessConfig {
  /** Auto-background after this delay (ms). Default: 10000 */
  backgroundMs?: number;
  /** Kill the process after this timeout (sec). Default: 1800 */
  timeoutSec?: number;
  /** TTL for finished sessions in memory (ms). Default: 1800000 (30 min) */
  cleanupMs?: number;
  /** Enqueue a system event when a backgrounded exec exits. Default: true */
  notifyOnExit?: boolean;
  /** Also enqueue for successful no-output exits. Default: false */
  notifyOnExitEmptySuccess?: boolean;
  /** In-memory output cap per stream (chars). Default: 2_000_000 */
  maxOutputChars?: number;
}

const DEFAULTS: Required<ExecProcessConfig> = {
  backgroundMs: 10_000,
  timeoutSec: 1_800,
  cleanupMs: 30 * 60 * 1_000,
  notifyOnExit: true,
  notifyOnExitEmptySuccess: false,
  maxOutputChars: 2_000_000
};

// ─── Session store ────────────────────────────────────────────────────────────

export type SessionStatus = 'running' | 'finished' | 'killed' | 'error';

export interface ExecSession {
  sessionId: string;
  command: string;
  /** Derived label — command verb + first target argument */
  name: string;
  status: SessionStatus;
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
  /** Full output accumulated so far */
  output: string;
  /** Offset of last poll (for incremental drain) */
  pollOffset: number;
  /** Active child process (null when finished) */
  proc: ReturnType<typeof spawn> | null;
}

// Per-agent session stores (agentId → Map<sessionId, ExecSession>)
const agentStores = new Map<string, Map<string, ExecSession>>();

function getStore(agentId = 'default'): Map<string, ExecSession> {
  let store = agentStores.get(agentId);
  if (!store) { store = new Map(); agentStores.set(agentId, store); }
  return store;
}

function deriveName(command: string): string {
  const parts = command.trim().split(/\s+/);
  const verb = parts[0]?.split('/').pop() || 'exec';
  const target = parts[1] || '';
  return target ? `${verb} ${target}` : verb;
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function getExecProcessTools(
  cfg: ExecProcessConfig = {},
  agentId = 'default',
  /** Optional callback when a background session exits (for system event notifications) */
  onSessionExit?: (session: ExecSession) => void
): Tool[] {
  const conf: Required<ExecProcessConfig> = { ...DEFAULTS, ...cfg };
  const store = getStore(agentId);

  // ── Cleanup helper ─────────────────────────────────────────────────────────

  function scheduleCleanup(sessionId: string): void {
    setTimeout(() => { store.delete(sessionId); }, conf.cleanupMs).unref();
  }

  // ── Run a command (foreground or background) ───────────────────────────────

  function launchSession(
    sessionId: string,
    command: string,
    opts: { cwd?: string; env?: Record<string, string>; pty?: boolean }
  ): ExecSession {
    const session: ExecSession = {
      sessionId,
      command,
      name: deriveName(command),
      status: 'running',
      startedAt: new Date().toISOString(),
      output: '',
      pollOffset: 0,
      proc: null
    };
    store.set(sessionId, session);

    const child = spawn('sh', ['-lc', command], {
      cwd: opts.cwd || os.homedir(),
      env: {
        ...process.env,
        ...opts.env,
        HYPERCLAW_SHELL: 'exec',
        TERM: 'xterm-256color'
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    session.proc = child;

    const cap = (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (session.output.length + text.length > conf.maxOutputChars) {
        session.output = session.output.slice(-(conf.maxOutputChars - text.length)) + text;
      } else {
        session.output += text;
      }
    };

    child.stdout?.on('data', cap);
    child.stderr?.on('data', cap);

    // Hard timeout
    const killTimer = setTimeout(() => {
      if (session.status === 'running') {
        try { child.kill('SIGKILL'); } catch {}
        session.status = 'error';
        session.finishedAt = new Date().toISOString();
        session.output += `\n[hyperclaw: process killed after ${conf.timeoutSec}s timeout]`;
        session.proc = null;
        scheduleCleanup(sessionId);
      }
    }, conf.timeoutSec * 1000);
    killTimer.unref();

    child.on('error', (err) => {
      session.status = 'error';
      session.finishedAt = new Date().toISOString();
      session.output += `\n[hyperclaw: process error: ${err.message}]`;
      session.proc = null;
      clearTimeout(killTimer);
      scheduleCleanup(sessionId);
      if (conf.notifyOnExit) onSessionExit?.(session);
    });

    child.on('close', (code) => {
      session.exitCode = code ?? undefined;
      session.status = code === 0 ? 'finished' : 'error';
      session.finishedAt = new Date().toISOString();
      session.proc = null;
      clearTimeout(killTimer);
      scheduleCleanup(sessionId);
      const hasOutput = session.output.trim().length > 0;
      if (conf.notifyOnExit && (hasOutput || conf.notifyOnExitEmptySuccess)) {
        onSessionExit?.(session);
      }
    });

    return session;
  }

  // ── exec tool ─────────────────────────────────────────────────────────────

  const execTool: Tool = {
    name: 'exec',
    description:
      'Run a shell command. Returns output directly (foreground) or immediately returns a sessionId when backgrounded. ' +
      'Background is triggered by: `background: true`, or when the command runs longer than `yieldMs` ms. ' +
      'Use the process tool to poll, read output, or send input to background sessions.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        yieldMs: {
          type: 'number',
          description: `Auto-background after this delay (ms). Default: ${conf.backgroundMs}`
        },
        background: {
          type: 'boolean',
          description: 'Background immediately without waiting for yieldMs'
        },
        timeout: {
          type: 'number',
          description: `Kill process after this many seconds. Default: ${conf.timeoutSec}`
        },
        elevated: {
          type: 'boolean',
          description: 'Run on host even when sandboxed (requires elevated mode enabled)'
        },
        pty: { type: 'boolean', description: 'Allocate a pseudo-TTY' },
        workdir: { type: 'string', description: 'Working directory' },
        env: { type: 'object', description: 'Extra environment variables' }
      },
      required: ['command']
    },
    handler: async (input) => {
      const command = input.command as string;
      const yieldMs = (input.yieldMs as number | undefined) ?? conf.backgroundMs;
      const immediate = !!(input.background as boolean | undefined);
      const workdir = (input.workdir as string | undefined) || os.homedir();
      const extraEnv = (input.env as Record<string, string> | undefined) || {};
      const pty = !!(input.pty as boolean | undefined);

      const sessionId = crypto.randomBytes(6).toString('hex');

      if (immediate) {
        // Background immediately
        launchSession(sessionId, command, { cwd: workdir, env: extraEnv, pty });
        return JSON.stringify({ status: 'running', sessionId, message: 'Process started in background' });
      }

      // Run foreground up to yieldMs, then background if still running
      const session = launchSession(sessionId, command, { cwd: workdir, env: extraEnv, pty });

      const settled = await Promise.race([
        new Promise<'done'>((res) => {
          session.proc?.on('close', () => res('done'));
          session.proc?.on('error', () => res('done'));
        }),
        new Promise<'yield'>((res) => setTimeout(() => res('yield'), yieldMs))
      ]);

      if (settled === 'done') {
        // Completed within yieldMs — return output directly
        store.delete(sessionId);
        return session.output.trim() || '(no output)';
      }

      // Still running — return sessionId for later polling
      const tail = session.output.slice(-2000);
      return JSON.stringify({
        status: 'running',
        sessionId,
        tail: tail || '(no output yet)',
        message: `Process backgrounded after ${yieldMs}ms. Use process poll to get output.`
      });
    }
  };

  // ── process tool ──────────────────────────────────────────────────────────

  const processTool: Tool = {
    name: 'process',
    description:
      'Manage background exec sessions. Actions: list, poll, log, write, kill, clear, remove.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'poll', 'log', 'write', 'kill', 'clear', 'remove'],
          description: 'Action to perform'
        },
        sessionId: { type: 'string', description: 'Session ID (required for most actions)' },
        data: { type: 'string', description: 'Data to write to stdin (write action)' },
        eof: { type: 'boolean', description: 'Close stdin after write (write action)' },
        offset: { type: 'number', description: 'Line offset for log action' },
        limit: { type: 'number', description: 'Line count limit for log action' }
      },
      required: ['action']
    },
    handler: async (input) => {
      const action = input.action as string;
      const sessionId = input.sessionId as string | undefined;

      switch (action) {
        case 'list': {
          const sessions = Array.from(store.values()).map((s) => ({
            sessionId: s.sessionId,
            name: s.name,
            status: s.status,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
            exitCode: s.exitCode,
            outputLength: s.output.length
          }));
          return JSON.stringify({ sessions });
        }

        case 'poll': {
          if (!sessionId) return JSON.stringify({ error: 'sessionId required' });
          const s = store.get(sessionId);
          if (!s) return JSON.stringify({ error: `session ${sessionId} not found` });
          const newOutput = s.output.slice(s.pollOffset);
          s.pollOffset = s.output.length;
          return JSON.stringify({
            sessionId,
            status: s.status,
            exitCode: s.exitCode,
            output: newOutput,
            done: s.status !== 'running'
          });
        }

        case 'log': {
          if (!sessionId) return JSON.stringify({ error: 'sessionId required' });
          const s = store.get(sessionId);
          if (!s) return JSON.stringify({ error: `session ${sessionId} not found` });
          const lines = s.output.split('\n');
          const offset = (input.offset as number | undefined) ?? undefined;
          const limit = (input.limit as number | undefined) ?? undefined;

          let slice: string[];
          if (offset === undefined && limit === undefined) {
            // Default: last 200 lines
            slice = lines.slice(-200);
            const hint = lines.length > 200
              ? `(showing last 200 of ${lines.length} lines; use offset+limit to page)`
              : undefined;
            return JSON.stringify({
              sessionId, status: s.status, exitCode: s.exitCode,
              totalLines: lines.length, log: slice.join('\n'),
              ...(hint ? { pagingHint: hint } : {})
            });
          } else if (offset !== undefined && limit === undefined) {
            slice = lines.slice(offset);
          } else {
            slice = lines.slice(offset ?? 0, (offset ?? 0) + (limit ?? 200));
          }
          return JSON.stringify({
            sessionId, status: s.status, exitCode: s.exitCode,
            totalLines: lines.length, log: slice.join('\n')
          });
        }

        case 'write': {
          if (!sessionId) return JSON.stringify({ error: 'sessionId required' });
          const s = store.get(sessionId);
          if (!s) return JSON.stringify({ error: `session ${sessionId} not found` });
          if (s.status !== 'running') return JSON.stringify({ error: 'session is not running' });
          const data = (input.data as string | undefined) || '';
          s.proc?.stdin?.write(data);
          if (input.eof) s.proc?.stdin?.end();
          return JSON.stringify({ ok: true, sessionId });
        }

        case 'kill': {
          if (!sessionId) return JSON.stringify({ error: 'sessionId required' });
          const s = store.get(sessionId);
          if (!s) return JSON.stringify({ error: `session ${sessionId} not found` });
          if (s.status === 'running') {
            try { s.proc?.kill('SIGTERM'); } catch {}
            setTimeout(() => {
              if (s.status === 'running') {
                try { s.proc?.kill('SIGKILL'); } catch {}
              }
            }, 3000).unref();
            s.status = 'killed';
          }
          return JSON.stringify({ ok: true, sessionId, status: s.status });
        }

        case 'clear': {
          if (!sessionId) return JSON.stringify({ error: 'sessionId required' });
          const s = store.get(sessionId);
          if (!s) return JSON.stringify({ error: `session ${sessionId} not found` });
          if (s.status === 'running') return JSON.stringify({ error: 'session is still running; use kill first or remove' });
          store.delete(sessionId);
          return JSON.stringify({ ok: true, sessionId });
        }

        case 'remove': {
          if (!sessionId) return JSON.stringify({ error: 'sessionId required' });
          const s = store.get(sessionId);
          if (!s) return JSON.stringify({ error: `session ${sessionId} not found` });
          if (s.status === 'running') {
            try { s.proc?.kill('SIGTERM'); } catch {}
            s.status = 'killed';
          }
          store.delete(sessionId);
          return JSON.stringify({ ok: true, sessionId });
        }

        default:
          return JSON.stringify({ error: `unknown action: ${action}` });
      }
    }
  };

  return [execTool, processTool];
}

/** Clear all sessions for an agent (e.g., on gateway shutdown). */
export function clearAgentSessions(agentId = 'default'): void {
  const store = agentStores.get(agentId);
  if (!store) return;
  for (const s of store.values()) {
    if (s.status === 'running') {
      try { s.proc?.kill('SIGTERM'); } catch {}
    }
  }
  store.clear();
}
