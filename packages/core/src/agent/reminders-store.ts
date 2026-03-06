/**
 * src/agent/reminders-store.ts
 * Simple JSON file store for reminders.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const STORE = path.join(os.homedir(), '.hyperclaw', 'reminders.json');

export interface Reminder {
  id: string;
  message: string;
  dueAt?: string;
  createdAt: string;
  completed: boolean;
}

let cache: Reminder[] | null = null;

async function load(): Promise<Reminder[]> {
  if (cache) return cache;
  try {
    cache = await fs.readJson(STORE);
    return cache!;
  } catch {
    cache = [];
    return cache;
  }
}

async function save(data: Reminder[]): Promise<void> {
  await fs.ensureDir(path.dirname(STORE));
  await fs.writeJson(STORE, data, { spaces: 2 });
  cache = data;
}

export async function addReminder(message: string, dueAt?: string): Promise<Reminder> {
  const items = await load();
  const id = `r${Date.now()}`;
  const r: Reminder = {
    id,
    message,
    dueAt,
    createdAt: new Date().toISOString(),
    completed: false
  };
  items.push(r);
  await save(items);
  return r;
}

export async function listReminders(includeCompleted = false): Promise<Reminder[]> {
  const items = await load();
  return includeCompleted ? items : items.filter(r => !r.completed);
}

export async function completeReminder(id: string): Promise<boolean> {
  const items = await load();
  const r = items.find(x => x.id === id);
  if (!r) return false;
  r.completed = true;
  await save(items);
  return true;
}
