/**
 * src/services/cron-tasks.ts
 * User-defined scheduled tasks (cron expressions → agent prompts).
 * Stored in ~/.hyperclaw/cron-tasks.json, executed by HookLoader.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const CRON_TASKS_FILE = path.join(os.homedir(), '.hyperclaw', 'cron-tasks.json');

export interface CronTask {
  id: string;
  schedule: string;   // cron expression, e.g. "0 9 * * 1-5"
  prompt: string;
  name?: string;
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
}

let tasks: CronTask[] = [];

export async function loadCronTasks(): Promise<CronTask[]> {
  try {
    tasks = await fs.readJson(CRON_TASKS_FILE);
  } catch {
    tasks = [];
  }
  return tasks;
}

export async function saveCronTasks(): Promise<void> {
  await fs.ensureDir(path.dirname(CRON_TASKS_FILE));
  await fs.writeJson(CRON_TASKS_FILE, tasks, { spaces: 2 });
}

export function getCronTasks(): CronTask[] {
  return [...tasks];
}

export function addCronTask(schedule: string, prompt: string, name?: string): CronTask {
  const id = `task-${Date.now().toString(36)}`;
  const task: CronTask = {
    id,
    schedule,
    prompt,
    name,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  tasks.push(task);
  return task;
}

export function removeCronTask(id: string): boolean {
  const i = tasks.findIndex(t => t.id === id);
  if (i >= 0) { tasks.splice(i, 1); return true; }
  return false;
}

export async function runCronTask(task: CronTask, port = 18789): Promise<void> {
  const http = await import('http');
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ message: task.prompt });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/webhook/inbound',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        task.lastRunAt = new Date().toISOString();
        await saveCronTasks().catch(() => {});
        resolve();
      });
    });
    req.on('error', (e) => {
      console.error(`[cron] task ${task.id} failed:`, e.message);
      resolve();
    });
    req.setTimeout(60000, () => { req.destroy(); resolve(); });
    req.write(payload);
    req.end();
  });
}
