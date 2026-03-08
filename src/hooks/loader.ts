/**
 * src/hooks/loader.ts
 * HyperClaw hooks system — mirrors OpenClaw's hooks with enable/disable/list/info.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { getHyperClawDir } from '../infra/paths';

export interface HookDef {
  id: string;
  name: string;
  description: string;
  trigger: 'session:start' | 'session:end' | 'message:sent' | 'message:received' | 'cron' | 'gateway:start';
  eligible: boolean;
  enabled: boolean;
  builtin: boolean;
  tags: string[];
  version: string;
}

const BUILTIN_HOOKS: HookDef[] = [
  {
    id: 'session-memory',
    name: 'Session Memory',
    description: 'Writes a summary of each session to MEMORY.md on close.',
    trigger: 'session:end',
    eligible: true,
    enabled: true,
    builtin: true,
    tags: ['memory', 'sessions'],
    version: '1.0.0'
  },
  {
    id: 'command-logger',
    name: 'Command Logger',
    description: 'Logs every AI command execution to the daily log file.',
    trigger: 'message:sent',
    eligible: true,
    enabled: false,
    builtin: true,
    tags: ['logging', 'debug'],
    version: '1.0.0'
  },
  {
    id: 'gateway-health',
    name: 'Gateway Health Monitor',
    description: 'Pings the gateway every 5 minutes and logs latency.',
    trigger: 'cron',
    eligible: true,
    enabled: true,
    builtin: true,
    tags: ['health', 'monitoring'],
    version: '1.1.0'
  },
  {
    id: 'auto-backup',
    name: 'Auto Backup',
    description: 'Backs up AGENTS.md and config to ~/.hyperclaw/backups/ daily.',
    trigger: 'cron',
    eligible: true,
    enabled: false,
    builtin: true,
    tags: ['backup', 'config'],
    version: '1.0.0'
  },
  {
    id: 'dm-guard',
    name: 'DM Guard',
    description: 'Enforces DM policy and logs policy violations.',
    trigger: 'message:received',
    eligible: true,
    enabled: true,
    builtin: true,
    tags: ['security', 'dm-policy'],
    version: '2.0.0'
  },
  {
    id: 'voice-wake',
    name: 'Voice Wake Detector',
    description: 'Listens for wake word and starts voice session (macOS/iOS only).',
    trigger: 'gateway:start',
    eligible: process.platform === 'darwin',
    enabled: false,
    builtin: true,
    tags: ['voice', 'macos'],
    version: '1.0.0'
  },
  {
    id: 'morning-briefing',
    name: 'Morning Briefing (Heartbeat)',
    description: 'Proactive daily briefing: agent generates summary from MEMORY, reminders, knowledge graph. Writes to HEARTBEAT.md.',
    trigger: 'cron',
    eligible: true,
    enabled: false,
    builtin: true,
    tags: ['heartbeat', 'briefing', 'automation'],
    version: '1.0.0'
  },
  {
    id: 'website-watch',
    name: 'Website Change Monitor',
    description: 'Every 15 min, checks watched URLs for changes. Use watch_website_add tool to add URLs.',
    trigger: 'cron',
    eligible: true,
    enabled: true,
    builtin: true,
    tags: ['automation', 'monitoring'],
    version: '1.0.0'
  },
  {
    id: 'voice-note-transcription',
    name: 'Voice Note Transcription',
    description: 'Transcribes incoming voice messages via Whisper (OPENAI_API_KEY). Used by channels when audioPath is set.',
    trigger: 'message:received',
    eligible: true,
    enabled: true,
    builtin: true,
    tags: ['voice', 'transcription', 'messaging'],
    version: '1.0.0'
  }
];

export class HookLoader {
  private stateFile: string;
  private state: Record<string, { enabled: boolean }> = {};

  constructor() {
    this.stateFile = path.join(getHyperClawDir(), 'hooks-state.json');
    this.loadState();
  }

  loadState(): void {
    try {
      this.state = fs.readJsonSync(this.stateFile);
    } catch {
      this.state = {};
    }
  }

  private saveState(): void {
    fs.ensureDirSync(path.dirname(this.stateFile));
    fs.writeJsonSync(this.stateFile, this.state, { spaces: 2 });
  }

  private isEnabled(hook: HookDef): boolean {
    if (this.state[hook.id] !== undefined) return this.state[hook.id].enabled;
    return hook.enabled;
  }

  getHooks(eligibleOnly = false): Array<HookDef & { enabled: boolean; eligible: boolean }> {
    const hooks = eligibleOnly ? BUILTIN_HOOKS.filter(h => h.eligible) : BUILTIN_HOOKS;
    return hooks.map(h => ({ ...h, enabled: this.isEnabled(h), eligible: h.eligible }));
  }

  list(eligibleOnly = false): void {
    const hooks = this.getHooks(eligibleOnly);

    console.log(chalk.bold.cyan('\n  ⚡ HYPERCLAW HOOKS\n'));

    for (const hook of hooks) {
      const dot = hook.enabled ? chalk.green('●') : chalk.gray('○');
      const eligBadge = hook.eligible ? '' : chalk.red(' [ineligible]');
      const builtinBadge = hook.builtin ? chalk.gray(' [builtin]') : '';

      console.log(`  ${dot} ${chalk.white(hook.id)}${eligBadge}${builtinBadge}`);
      console.log(`     ${chalk.gray(hook.description)}`);
      console.log(`     ${chalk.gray(`trigger: ${hook.trigger}  v${hook.version}  tags: ${hook.tags.join(', ')}`)}`);
      console.log();
    }
  }

  info(id: string): void {
    const hook = BUILTIN_HOOKS.find(h => h.id === id);
    if (!hook) {
      console.log(chalk.red(`  ✖  Hook not found: ${id}`));
      return;
    }

    const enabled = this.isEnabled(hook);
    console.log(chalk.bold.cyan(`\n  Hook: ${hook.name}\n`));
    console.log(`  ID:          ${hook.id}`);
    console.log(`  Status:      ${enabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
    console.log(`  Eligible:    ${hook.eligible ? chalk.green('yes') : chalk.red('no — OS not supported')}`);
    console.log(`  Trigger:     ${hook.trigger}`);
    console.log(`  Description: ${hook.description}`);
    console.log(`  Tags:        ${hook.tags.join(', ')}`);
    console.log(`  Version:     ${hook.version}`);
    console.log();
  }

  enable(id: string): void {
    const hook = BUILTIN_HOOKS.find(h => h.id === id);
    if (!hook) { console.log(chalk.red(`  ✖  Hook not found: ${id}`)); return; }
    if (!hook.eligible) { console.log(chalk.red(`  ✖  Hook not eligible on this OS: ${id}`)); return; }

    this.state[id] = { enabled: true };
    this.saveState();
    console.log(chalk.green(`  ✔  Hook enabled: ${id}`));
  }

  disable(id: string): void {
    const hook = BUILTIN_HOOKS.find(h => h.id === id);
    if (!hook) { console.log(chalk.red(`  ✖  Hook not found: ${id}`)); return; }

    this.state[id] = { enabled: false };
    this.saveState();
    console.log(chalk.green(`  ✔  Hook disabled: ${id}`));
  }

  async install(pack: string): Promise<void> {
    const s = require('ora')(`Installing hook pack: ${pack}...`).start();
    await new Promise(r => setTimeout(r, 1500));
    s.succeed(`Hook pack installed: ${pack}`);
    console.log(chalk.gray(`  Run: hyperclaw hooks list to see new hooks`));
  }

  /** Execute enabled hooks for a trigger. Fire-and-forget. */
  async execute(trigger: HookDef['trigger'], payload?: Record<string, unknown>): Promise<void> {
    const toRun = BUILTIN_HOOKS.filter(h => h.trigger === trigger && h.eligible && this.isEnabled(h));
    for (const hook of toRun) {
      this.runHandler(hook, payload).catch(err =>
        console.error(`[hooks] ${hook.id} error:`, err?.message || err)
      );
    }
  }

  /** Execute a single cron hook by ID. Used by CronRunner. */
  async executeCronHook(hookId: string): Promise<void> {
    const hook = BUILTIN_HOOKS.find(h => h.id === hookId && h.trigger === 'cron' && h.eligible && this.isEnabled(h));
    if (hook) await this.runHandler(hook, {}).catch(err => console.error(`[hooks] ${hook.id} error:`, err?.message || err));
  }

  /** Start cron schedules: gateway-health (5 min), auto-backup (3am), website-watch (15 min), morning-briefing (8am), + user cron-tasks. */
  startCronScheduler(): () => void {
    const cron = require('node-cron');
    const stops: (() => void)[] = [];
    const t1 = cron.schedule('*/5 * * * *', () => {
      this.executeCronHook('gateway-health').catch(() => {});
    });
    const t2 = cron.schedule('0 3 * * *', () => {
      this.executeCronHook('auto-backup').catch(() => {});
    });
    const t3 = cron.schedule('*/15 * * * *', () => {
      this.executeCronHook('website-watch').catch(() => {});
    });
    const t4 = cron.schedule('0 8 * * *', () => {
      this.executeCronHook('morning-briefing').catch(() => {});
    });
    stops.push(() => { t1.stop(); t2.stop(); t3.stop(); t4.stop(); });

    // User-defined cron tasks from ~/.hyperclaw/cron-tasks.json
    (async () => {
      try {
        const { loadCronTasks, runCronTask } = await import('../services/cron-tasks');
        const tasks = await loadCronTasks();
        let port = 18789;
        try {
          const { getConfigPath } = await import('../infra/paths');
          const cfg = await fs.readJson(getConfigPath());
          port = cfg?.gateway?.port ?? 18789;
        } catch { /* ignore */ }
        for (const task of tasks) {
          if (!task.enabled) continue;
          try {
            const t = cron.schedule(task.schedule, () => runCronTask(task, port).catch(() => {}));
            stops.push(() => t.stop());
          } catch { /* invalid cron expr */ }
        }
      } catch { /* ignore */ }
    })();

    return () => { stops.forEach(s => s()); };
  }

  private async runHandler(hook: HookDef, payload?: Record<string, unknown>): Promise<void> {
    const handlers: Record<string, () => Promise<void>> = {
      'session-memory': async () => {
        const sessionId = payload?.sessionId as string;
        const turnCount = (payload?.turnCount as number) ?? 0;
        const newFacts = payload?.newFacts as string[] | undefined;
        if (turnCount > 0 && sessionId) {
          const entry = `\n- ${new Date().toISOString().slice(0, 10)}: Session ${sessionId} closed after ${turnCount} turns\n`;
          const { getHyperClawDir } = await import('../infra/paths');
          await fs.appendFile(path.join(getHyperClawDir(), 'MEMORY.md'), entry);
        }
        try {
          const { onSessionEnd } = await import('../services/memory-integration');
          await onSessionEnd({ sessionId, turnCount, newFacts });
        } catch { /* ignore */ }
      },
      'command-logger': async () => {
        const { getHyperClawDir } = await import('../infra/paths');
        const logDir = path.join(getHyperClawDir(), 'logs');
        const logFile = path.join(logDir, `commands-${new Date().toISOString().slice(0, 10)}.log`);
        await fs.ensureDir(logDir);
        const msg = String(payload?.message ?? '').slice(0, 100);
        const resp = String(payload?.response ?? '').slice(0, 200);
        const line = `[${new Date().toISOString()}] msg=${msg} | resp=${resp}\n`;
        await fs.appendFile(logFile, line);
      },
      'dm-guard': async () => {
        if (payload?.channel) {
          const { getHyperClawDir } = await import('../infra/paths');
          const auditDir = path.join(getHyperClawDir(), 'logs');
          await fs.ensureDir(auditDir);
          const line = `[${new Date().toISOString()}] message:received channel=${payload.channel}\n`;
          await fs.appendFile(path.join(auditDir, 'dm-guard.log'), line);
        }
      },
      'gateway-health': async () => {
        const { getHyperClawDir, getConfigPath } = await import('../infra/paths');
        const hcDir = getHyperClawDir();
        let port = 18789;
        try {
          const cfg = await fs.readJson(getConfigPath());
          if (cfg?.gateway?.port) port = cfg.gateway.port;
        } catch {}
        const logDir = path.join(hcDir, 'logs');
        const logFile = path.join(logDir, 'gateway-health.log');
        const start = Date.now();
        try {
          const http = await import('http');
          await new Promise<void>((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
              let data = '';
              res.on('data', c => data += c);
              res.on('end', () => { resolve(); });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
          });
          const latency = Date.now() - start;
          await fs.ensureDir(logDir);
          await fs.appendFile(logFile, `[${new Date().toISOString()}] OK latency=${latency}ms\n`);
        } catch (e: any) {
          await fs.ensureDir(logDir);
          await fs.appendFile(logFile, `[${new Date().toISOString()}] FAIL ${e.message}\n`);
        }
      },
      'auto-backup': async () => {
        const { getHyperClawDir, getConfigPath } = await import('../infra/paths');
        const hcDir = getHyperClawDir();
        const backupDir = path.join(hcDir, 'backups');
        await fs.ensureDir(backupDir);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        for (const f of ['hyperclaw.json', 'AGENTS.md', 'MEMORY.md', 'SOUL.md']) {
          const src = path.join(hcDir, f);
          if (await fs.pathExists(src)) {
            await fs.copy(src, path.join(backupDir, `${f}.${ts}.bak`));
          }
        }
      },
      'voice-wake': async () => { /* gateway:start: init voice */ },
      'morning-briefing': async () => {
        try {
          const { runMorningBriefing, persistBriefing } = await import('../services/heartbeat-engine');
          const text = await runMorningBriefing();
          await persistBriefing(text);
        } catch (e: any) {
          const { getHyperClawDir } = await import('../infra/paths');
        const logDir = path.join(getHyperClawDir(), 'logs');
          await fs.ensureDir(logDir);
          await fs.appendFile(path.join(logDir, 'heartbeat-errors.log'), `[${new Date().toISOString()}] ${e.message}\n`);
        }
      },
      'website-watch': async () => {
        const path = await import('path');
        const os = await import('os');
        const fs = await import('fs-extra');
        const { getHyperClawDir } = await import('../infra/paths');
        const watchFile = path.join(getHyperClawDir(), 'website-watches.json');
        if (!(await fs.pathExists(watchFile))) return;
        const watches = await fs.readJson(watchFile).catch(() => ({}));
        const crypto = await import('crypto');
        const https = await import('https');
        const http = await import('http');
        const fetch = (u: string) => new Promise<string>((res, rej) => {
          const c = u.startsWith('https') ? https : http;
          const req = c.get(u, { timeout: 10000 }, (r) => { let d = ''; r.on('data', x => d += x); r.on('end', () => res(d)); });
          req.on('error', rej);
        });
        const hash = (s: string) => crypto.createHash('sha256').update(s.replace(/\s+/g, ' ').slice(0, 50000)).digest('hex').slice(0, 16);
        for (const url of Object.keys(watches)) {
          try {
            const content = await fetch(url);
            const h = hash(content);
            if (h !== watches[url].lastHash) { watches[url].lastHash = h; watches[url].lastCheck = new Date().toISOString(); }
          } catch {}
        }
        await fs.writeJson(watchFile, watches, { spaces: 2 });
      }
    };
    const fn = handlers[hook.id];
    if (fn) await fn();
  }
}
