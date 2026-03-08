/**
 * src/logging/logger.ts
 * HyperClaw structured logger.
 * Writes to ~/.hyperclaw/logs/hyperclaw.log with rotation.
 * `hyperclaw daemon logs` tails this file.
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { getHyperClawDir } from '../infra/paths';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 99
};

const LEVEL_COLOR: Record<LogLevel, (s: string) => string> = {
  debug:  chalk.gray,
  info:   chalk.cyan,
  warn:   chalk.yellow,
  error:  chalk.red,
  silent: chalk.gray,
};

const getLogDir = () => path.join(getHyperClawDir(), 'logs');
const getLogFile = () => path.join(getLogDir(), 'hyperclaw.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB before rotation

let _minLevel: LogLevel = 'info';
let _fileEnabled = true;
let _consoleEnabled = true;

export function configureLogger(opts: { level?: LogLevel; file?: boolean; console?: boolean }) {
  if (opts.level)   _minLevel        = opts.level;
  if (opts.file     !== undefined) _fileEnabled    = opts.file;
  if (opts.console  !== undefined) _consoleEnabled = opts.console;
}

function formatConsole(entry: LogEntry): string {
  const ts    = chalk.gray(entry.ts.slice(11, 23)); // HH:mm:ss.mmm
  const level = LEVEL_COLOR[entry.level](entry.level.toUpperCase().padEnd(5));
  const mod   = chalk.blue(`[${entry.module}]`);
  const data  = entry.data ? chalk.gray(' ' + JSON.stringify(entry.data)) : '';
  return `  ${ts} ${level} ${mod} ${entry.message}${data}`;
}

function formatFile(entry: LogEntry): string {
  return JSON.stringify(entry) + '\n';
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const stat = await fs.stat(getLogFile()).catch(() => null);
    if (stat && stat.size > MAX_LOG_BYTES) {
      const logFile = getLogFile();
      const rotated = logFile.replace('.log', `.${Date.now()}.log`);
      await fs.rename(logFile, rotated);
    }
  } catch {}
}

let rotateChecked = false;

function write(module: string, level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[_minLevel]) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    data
  };

  if (_consoleEnabled && level !== 'debug') {
    console.log(formatConsole(entry));
  }

  if (_fileEnabled) {
    if (!rotateChecked) {
      rotateChecked = true;
      fs.ensureDir(LOG_DIR).then(() => rotateIfNeeded()).catch(() => {});
    }
    fs.appendFile(getLogFile(), formatFile(entry)).catch(() => {});
  }
}

// ─── Logger factory ───────────────────────────────────────────────────────────

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => write(module, 'debug', msg, data),
    info:  (msg: string, data?: Record<string, unknown>) => write(module, 'info',  msg, data),
    warn:  (msg: string, data?: Record<string, unknown>) => write(module, 'warn',  msg, data),
    error: (msg: string, data?: Record<string, unknown>) => write(module, 'error', msg, data),
  };
}

// ─── CLI: tail log ───────────────────────────────────────────────────────────

export async function tailLog(lines = 50): Promise<void> {
  if (!(await fs.pathExists(getLogFile()))) {
    console.log(chalk.gray('\n  No log file yet. Start the daemon first.\n'));
    return;
  }

  const content = await fs.readFile(LOG_FILE, 'utf8');
  const all = content.trim().split('\n').filter(Boolean);
  const tail = all.slice(-lines);

  console.log(chalk.bold.cyan(`\n  📋 LAST ${tail.length} LOG ENTRIES\n`));

  for (const line of tail) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      console.log(formatConsole(entry));
    } catch {
      console.log(chalk.gray('  ' + line));
    }
  }
  console.log();
}

export async function streamLog(): Promise<void> {
  console.log(chalk.bold.cyan('\n  📡 STREAMING LOGS (Ctrl+C to stop)\n'));
  await fs.ensureDir(getLogDir());
  await fs.ensureFile(getLogFile());

  const { createReadStream } = await import('fs');
  const { Tail } = await import('tail').catch(() => ({ Tail: null }));

  if (Tail) {
    const tail = new (Tail as any)(getLogFile());
    tail.on('line', (line: string) => {
      try {
        const entry = JSON.parse(line) as LogEntry;
        console.log(formatConsole(entry));
      } catch {
        console.log(chalk.gray('  ' + line));
      }
    });
    await new Promise(() => {}); // keep alive until Ctrl+C
  } else {
    // Fallback: re-exec `tail -f`
    const { spawn } = await import('child_process');
    const proc = spawn('tail', ['-f', getLogFile()], { stdio: ['ignore', 'pipe', 'ignore'] });
    proc.stdout?.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          console.log(formatConsole(entry));
        } catch {
          console.log(chalk.gray('  ' + line));
        }
      }
    });
    await new Promise(() => {}); // keep alive
  }
}
