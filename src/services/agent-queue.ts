/**
 * src/services/agent-queue.ts
 * Job queue for agent runs. In-memory MVP; Bull/Redis adapter later for scaling.
 */

export interface AgentJob {
  id: string;
  tenantId: string;
  message: string;
  sessionId?: string;
  source?: string;
  createdAt: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  error?: string;
}

type JobHandler = (job: AgentJob) => Promise<string>;

const queue: AgentJob[] = [];
const handlers = new Map<string, JobHandler>();

/** Enqueue an agent run. Returns job id. */
export function enqueueAgentJob(
  tenantId: string,
  message: string,
  opts?: { sessionId?: string; source?: string }
): string {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const job: AgentJob = {
    id,
    tenantId,
    message,
    sessionId: opts?.sessionId,
    source: opts?.source,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  queue.push(job);
  process.nextTick(() => processQueue());
  return id;
}

/** Get job status. */
export function getJob(id: string): AgentJob | undefined {
  return queue.find((j) => j.id === id);
}

/** Register handler for processing jobs. Uses runAgentEngine when set. */
export function setAgentJobHandler(handler: JobHandler): void {
  handlers.set('default', handler);
}

async function processQueue(): Promise<void> {
  const pending = queue.find((j) => j.status === 'pending');
  if (!pending) return;
  const handler = handlers.get('default');
  if (!handler) return;
  pending.status = 'running';
  try {
    const result = await handler(pending);
    pending.status = 'done';
    pending.result = result;
  } catch (e: unknown) {
    pending.status = 'failed';
    pending.error = e instanceof Error ? e.message : String(e);
  }
  const next = queue.find((j) => j.status === 'pending');
  if (next) process.nextTick(() => processQueue());
}

/** List jobs for tenant. */
export function listJobs(tenantId: string, limit = 50): AgentJob[] {
  return queue
    .filter((j) => j.tenantId === tenantId)
    .slice(-limit)
    .reverse();
}
