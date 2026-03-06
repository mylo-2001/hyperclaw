/**
 * src/logging/session-log.ts
 * Session and event logging.
 * `hyperclaw logs [--tail N] [--channel <id>] [--since <date>] [--live]`
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'gateway' | 'channel' | 'agent' | 'hook' | 'delivery' | 'security' | 'system';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  category: LogCategory;
  msg: string;
  channelId?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

const HC_DIR = path.join(os.homedir(), '.hyperclaw');
const LOG_DIR = path.join(HC_DIR, 'logs');

function todayFile(): string {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${dateStr}.jsonl`);
}

export class SessionLogger {
  private logFile: string;

  constructor(logFile?: string) {
    this.logFile = logFile || todayFile();
    fs.ensureDirSync(LOG_DIR);
  }

  write(level: LogLevel, category: LogCategory, msg: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      category,
      msg,
      ...(meta || {})
    };
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch {}
  }

  info(category: LogCategory, msg: string, meta?: Record<string, unknown>): void { this.write('info', category, msg, meta); }
  warn(category: LogCategory, msg: string, meta?: Record<string, unknown>): void { this.write('warn', category, msg, meta); }
  error(category: LogCategory, msg: string, meta?: Record<string, unknown>): void { this.write('error', category, msg, meta); }
  debug(category: LogCategory, msg: string, meta?: Record<string, unknown>): void { this.write('debug', category, msg, meta); }

  static async tail(options: {
    n?: number;
    channel?: string;
    level?: LogLevel;
    since?: string;
    live?: boolean;
  } = {}): Promise<void> {
    const n = options.n || 50;
    await fs.ensureDir(LOG_DIR);

    // Get all log files, sorted newest first
    const files = (await fs.readdir(LOG_DIR))
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.log(chalk.gray('\n  No logs yet.\n'));
      return;
    }

    const entries: LogEntry[] = [];
    for (const f of files) {
      const content = await fs.readFile(path.join(LOG_DIR, f), 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (options.channel && entry.channelId !== options.channel) continue;
          if (options.level && entry.level !== options.level) continue;
          if (options.since) {
            const since = new Date(options.since);
            if (new Date(entry.ts) < since) continue;
          }
          entries.push(entry);
          if (entries.length >= n) break;
        } catch {}
      }
      if (entries.length >= n) break;
    }

    // Print oldest first
    entries.reverse();
    console.log(chalk.bold.cyan(`\n  📋 LOGS (last ${entries.length})\n`));
    SessionLogger.printEntries(entries);

    if (options.live) {
      console.log(chalk.gray('\n  Live mode — watching for new entries... (Ctrl+C to stop)\n'));
      const watcher = fs.watch(LOG_DIR, async (event, filename) => {
        if (!filename?.endsWith('.jsonl')) return;
        // Read last line of the file
        try {
          const content = await fs.readFile(path.join(LOG_DIR, filename), 'utf8');
          const lines = content.trim().split('\n').filter(Boolean);
          if (lines.length > 0) {
            const entry = JSON.parse(lines[lines.length - 1]) as LogEntry;
            SessionLogger.printEntries([entry]);
          }
        } catch {}
      });
      // Keep alive
      await new Promise(resolve => process.on('SIGINT', resolve));
      watcher.close();
    }
  }

  static printEntries(entries: LogEntry[]): void {
    const levelColor: Record<LogLevel, (s: string) => string> = {
      debug: chalk.gray,
      info: chalk.cyan,
      warn: chalk.yellow,
      error: chalk.red
    };

    const catColor: Record<LogCategory, (s: string) => string> = {
      gateway: chalk.blue,
      channel: chalk.magenta,
      agent: chalk.cyan,
      hook: chalk.yellow,
      delivery: chalk.green,
      security: chalk.red,
      system: chalk.gray
    };

    for (const e of entries) {
      const time = new Date(e.ts).toLocaleTimeString();
      const level = levelColor[e.level](e.level.padEnd(5));
      const cat = catColor[e.category](e.category.padEnd(9));
      const ch = e.channelId ? chalk.gray(` [${e.channelId}]`) : '';
      console.log(`  ${chalk.gray(time)} ${level} ${cat}${ch} ${e.msg}`);
    }
    console.log();
  }

  static async stats(): Promise<void> {
    await fs.ensureDir(LOG_DIR);
    const files = (await fs.readdir(LOG_DIR)).filter(f => f.endsWith('.jsonl')).sort();

    console.log(chalk.bold.cyan('\n  📊 LOG STATS\n'));

    let total = 0;
    const byLevel: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const f of files) {
      const content = await fs.readFile(path.join(LOG_DIR, f), 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as LogEntry;
          total++;
          byLevel[e.level] = (byLevel[e.level] || 0) + 1;
          byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        } catch {}
      }
    }

    console.log(`  Total entries:  ${chalk.white(total)}`);
    console.log(`  Log files:      ${chalk.white(files.length)} (${files[0] || 'none'} → ${files[files.length - 1] || 'none'})`);
    console.log(`\n  By level:`);
    for (const [k, v] of Object.entries(byLevel)) {
      console.log(`    ${k.padEnd(8)} ${v}`);
    }
    console.log(`\n  By category:`);
    for (const [k, v] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(12)} ${v}`);
    }
    console.log();
  }
}
