/**
 * src/agent/session-store.ts
 * Persistent session state + working memory + richer agent-state model.
 * OpenClaw-level session intelligence.
 */

/** Working-memory slot: short-lived context the agent uses within a session. */
export interface WorkingMemorySlot {
  key: string;
  value: string;
  createdAt: string;
  expiresAt?: string;
}

/** Richer agent state beyond transcript. */
export interface AgentState {
  /** Current focus/goal if any */
  focus?: string;
  /** Pending tool approvals */
  pendingApprovals?: Array<{ tool: string; input: unknown }>;
  /** Last tool chain (for debugging) */
  lastTools?: string[];
  /** Intent hints from user */
  intentHints?: string[];
}

export interface SessionState {
  id: string;
  source: string;
  externalId?: string;
  transcript: Array<{ role: string; content: string }>;
  lastActiveAt: string;
  /** Working memory: restored and used for continuity */
  workingMemory?: WorkingMemorySlot[];
  /** Richer agent state */
  agentState?: AgentState;
}

export interface SessionStore {
  get(key: string): Promise<SessionState | null>;
  set(key: string, state: SessionState): Promise<void>;
  /** Append a turn. source used when creating new state. */
  append(key: string, role: string, content: string, source?: string): Promise<void>;
  /** Get working memory (filtered by expiry). */
  getWorkingMemory?(key: string): Promise<WorkingMemorySlot[]>;
  /** Set working memory slot. */
  setWorkingMemory?(key: string, slots: WorkingMemorySlot[]): Promise<void>;
  /** Update agent state. */
  updateAgentState?(key: string, patch: Partial<AgentState>): Promise<void>;
}

function sessionKey(source: string, externalId?: string): string {
  return externalId ? `${source}:${externalId}` : source;
}

const MAX_WORKING_MEMORY = 20;
const WORKING_MEMORY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function sanitizeKey(key: string): string {
  return key.replace(/[^a-z0-9_-]/gi, '_');
}

/** File-based session store. Sessions persist across gateway restarts. */
export async function createFileSessionStore(baseDir: string): Promise<SessionStore> {
  const fs = await import('fs-extra');
  const path = await import('path');
  const dir = path.join(baseDir, 'sessions');
  await fs.ensureDir(dir);

  const readState = async (key: string): Promise<SessionState | null> => {
    const fp = path.join(dir, `${sanitizeKey(key)}.json`);
    if (!(await fs.pathExists(fp))) return null;
    try {
      return await fs.readJson(fp);
    } catch {
      return null;
    }
  };

  const writeState = async (key: string, state: SessionState) => {
    const fp = path.join(dir, `${sanitizeKey(key)}.json`);
    await fs.writeJson(fp, { ...state, lastActiveAt: new Date().toISOString() });
  };

  return {
    async get(key: string) {
      return readState(key);
    },
    async set(key: string, state: SessionState) {
      await writeState(key, { ...state, lastActiveAt: new Date().toISOString() });
    },
    async append(key: string, role: string, content: string, source?: string) {
      const existing = await readState(key);
      const transcript = existing?.transcript ?? [];
      transcript.push({ role, content });
      if (transcript.length > 100) transcript.splice(0, transcript.length - 80);
      await writeState(key, {
        id: existing?.id ?? key,
        source: existing?.source ?? source ?? 'unknown',
        externalId: existing?.externalId,
        transcript,
        lastActiveAt: new Date().toISOString(),
        workingMemory: existing?.workingMemory,
        agentState: existing?.agentState
      });
    },
    async getWorkingMemory(key: string) {
      const s = await readState(key);
      const slots = (s?.workingMemory ?? []).filter(w => {
        if (w.expiresAt && new Date(w.expiresAt) < new Date()) return false;
        return true;
      });
      return slots.slice(-MAX_WORKING_MEMORY);
    },
    async setWorkingMemory(key: string, slots: WorkingMemorySlot[]) {
      const existing = await readState(key);
      const state: SessionState = {
        id: existing?.id ?? key,
        source: existing?.source ?? 'unknown',
        transcript: existing?.transcript ?? [],
        lastActiveAt: new Date().toISOString(),
        workingMemory: slots.slice(-MAX_WORKING_MEMORY),
        agentState: existing?.agentState
      };
      await writeState(key, state);
    },
    async updateAgentState(key: string, patch: Partial<AgentState>) {
      const existing = await readState(key);
      const agentState = { ...(existing?.agentState ?? {}), ...patch };
      await writeState(key, {
        id: existing?.id ?? key,
        source: existing?.source ?? 'unknown',
        externalId: existing?.externalId,
        transcript: existing?.transcript ?? [],
        lastActiveAt: new Date().toISOString(),
        workingMemory: existing?.workingMemory,
        agentState
      });
    }
  };
}
