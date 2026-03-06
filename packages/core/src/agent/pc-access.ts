/**
 * src/agent/pc-access.ts
 * Full PC access tools for HyperClaw agent.
 * Gives the AI real access to the user's machine:
 * - Run ANY shell command (bash, python, node...)
 * - Read/write/create/delete files anywhere
 * - List directories
 * - Manage processes (list, kill)
 * - Open apps / URLs
 * - Screenshot (macOS/Linux)
 * - Clipboard read/write
 * - System info
 *
 * SECURITY: Only active when pcAccess=true in config.
 * User explicitly opts in. All actions logged.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import type { Tool } from './inference';
import { getHyperClawDir, getConfigPath } from '../../../shared/src/index';

const execAsync = promisify(exec);

function getLogFile(): string {
  return path.join(getHyperClawDir(), 'logs', 'pc-access.log');
}

async function logAction(tool: string, input: unknown, result: string): Promise<void> {
  try {
    const LOG_FILE = getLogFile();
    await fs.ensureDir(path.dirname(LOG_FILE));
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      input,
      result: result.slice(0, 500)
    }) + '\n';
    await fs.appendFile(LOG_FILE, entry);
  } catch {}
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export interface PCAccessToolsOptions {
  /** When true, run_shell executes inside Docker container (tools.dockerSandbox.enabled) */
  dockerSandbox?: boolean;
}

export function getPCAccessTools(opts?: PCAccessToolsOptions): Tool[] {
  const dockerSandbox = opts?.dockerSandbox ?? false;

  return [

    // ── Run any shell command ────────────────────────────────────────────────
    {
      name: 'run_shell',
      description: 'Run ANY shell command on the user\'s computer. Can run bash scripts, python, node, git, brew, apt, etc. Returns stdout+stderr. Use this for tasks like: install software, run scripts, check system status, manipulate files via CLI.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run. Examples: "ls -la ~/Desktop", "python3 script.py", "git status", "brew install jq"' },
          cwd: { type: 'string', description: 'Working directory (optional, default: home dir)' },
          timeout: { type: 'string', description: 'Timeout in seconds (optional, default: 30)' }
        },
        required: ['command']
      },
      handler: async (input) => {
        const cmd = input.command as string;
        const cwd = (input.cwd as string) || os.homedir();
        const timeout = parseInt(input.timeout as string || '30') * 1000;

        let result = '';
        if (dockerSandbox) {
          const scriptPath = path.join(os.tmpdir(), `hyperclaw-run-${Date.now()}.sh`);
          try {
            const absCwd = path.resolve(cwd.replace(/^~/, os.homedir()));
            await fs.writeFile(scriptPath, `#!/bin/sh\n${cmd}\n`, { mode: 0o700 });
            const dockerCmd = `docker run --rm -v "${absCwd}:/workspace" -v "${scriptPath}:/script.sh" -w /workspace alpine sh /script.sh`;
            const { stdout, stderr } = await execAsync(dockerCmd, {
              timeout: Math.min(timeout, 60000),
              maxBuffer: 10 * 1024 * 1024
            });
            result = (stdout + stderr).trim().slice(0, 8000) || '(no output)';
          } catch (e: any) {
            if (e.message?.includes('Cannot connect to the Docker daemon')) {
              result = 'Error: Docker not running. Start Docker or disable tools.dockerSandbox.';
            } else {
              result = `Exit code ${e.code || 1}:\n${(e.stdout || '') + (e.stderr || e.message || '')}`.trim().slice(0, 8000);
            }
          } finally {
            await fs.remove(scriptPath).catch(() => {});
          }
        } else {
          try {
            const { stdout, stderr } = await execAsync(cmd, {
              cwd,
              timeout,
              env: { ...process.env, TERM: 'xterm-256color' },
              maxBuffer: 10 * 1024 * 1024 // 10MB
            });
            result = (stdout + stderr).trim().slice(0, 8000) || '(no output)';
          } catch (e: any) {
            result = `Exit code ${e.code || 1}:\n${(e.stdout || '') + (e.stderr || e.message || '')}`.trim().slice(0, 8000);
          }
        }

        await logAction('run_shell', { command: cmd, cwd, dockerSandbox }, result);
        return result;
      }
    },

    // ── Read file ────────────────────────────────────────────────────────────
    {
      name: 'read_file',
      description: 'Read the contents of any file on the computer. Supports text files, code, config files, etc.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or ~ path to file. E.g. ~/Documents/notes.txt or /etc/hosts' },
          lines: { type: 'string', description: 'Max lines to return (optional, default: 500)' }
        },
        required: ['path']
      },
      handler: async (input) => {
        const filePath = (input.path as string).replace(/^~/, os.homedir());
        const maxLines = parseInt(input.lines as string || '500');

        try {
          const stat = await fs.stat(filePath);
          if (stat.isDirectory()) {
            const entries = await fs.readdir(filePath);
            return `Directory listing:\n${entries.join('\n')}`;
          }

          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n');
          const truncated = lines.slice(0, maxLines).join('\n');
          const suffix = lines.length > maxLines ? `\n\n... (${lines.length - maxLines} more lines)` : '';
          const result = truncated + suffix;
          await logAction('read_file', { path: filePath }, `${lines.length} lines`);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Write file ───────────────────────────────────────────────────────────
    {
      name: 'write_file',
      description: 'Write content to a file. Creates the file and any missing parent directories. Can overwrite existing files.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file. E.g. ~/Desktop/script.py or /tmp/test.txt' },
          content: { type: 'string', description: 'Content to write to the file' },
          append: { type: 'string', description: '"true" to append instead of overwrite (optional)' }
        },
        required: ['path', 'content']
      },
      handler: async (input) => {
        const filePath = (input.path as string).replace(/^~/, os.homedir());
        const content = input.content as string;
        const append = input.append === 'true';

        try {
          await fs.ensureDir(path.dirname(filePath));
          if (append) {
            await fs.appendFile(filePath, content);
          } else {
            await fs.writeFile(filePath, content, 'utf8');
          }
          const result = `${append ? 'Appended' : 'Written'} ${content.length} chars to ${filePath}`;
          await logAction('write_file', { path: filePath, append }, result);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Edit file (search/replace) ───────────────────────────────────────────
    {
      name: 'edit_file',
      description: 'Search and replace text in a file. Useful for editing code or config.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file. E.g. ~/project/config.json' },
          oldString: { type: 'string', description: 'Exact string to find' },
          newString: { type: 'string', description: 'Replacement string' },
          replaceAll: { type: 'string', description: '"true" to replace all occurrences' }
        },
        required: ['path', 'oldString', 'newString']
      },
      handler: async (input) => {
        const filePath = (input.path as string).replace(/^~/, os.homedir());
        const oldStr = input.oldString as string;
        const newStr = input.newString as string;
        const replaceAll = input.replaceAll === 'true';
        try {
          let content = await fs.readFile(filePath, 'utf8');
          let count = 0;
          if (replaceAll) {
            const parts = content.split(oldStr);
            count = parts.length - 1;
            if (count === 0) return `Pattern not found in ${filePath}`;
            content = parts.join(newStr);
          } else {
            const idx = content.indexOf(oldStr);
            if (idx === -1) return `Pattern not found in ${filePath}`;
            content = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
            count = 1;
          }
          await fs.writeFile(filePath, content, 'utf8');
          const result = `Edited ${filePath}: ${count} replacement(s)`;
          await logAction('edit_file', { path: filePath, count }, result);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── List directory ───────────────────────────────────────────────────────
    {
      name: 'list_directory',
      description: 'List files and folders in a directory with details (size, date, permissions).',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path. E.g. ~/Desktop or /var/log' },
          hidden: { type: 'string', description: '"true" to show hidden files (optional)' }
        },
        required: ['path']
      },
      handler: async (input) => {
        const dirPath = (input.path as string).replace(/^~/, os.homedir());
        const showHidden = input.hidden === 'true';

        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const filtered = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));

          const lines = await Promise.all(filtered.map(async (e) => {
            try {
              const stat = await fs.stat(path.join(dirPath, e.name));
              const size = e.isDirectory() ? '<dir>' : formatBytes(stat.size);
              const date = stat.mtime.toISOString().slice(0, 10);
              const type = e.isDirectory() ? '📁' : '📄';
              return `${type} ${e.name.padEnd(40)} ${size.padStart(10)}  ${date}`;
            } catch {
              return `  ${e.name}`;
            }
          }));

          return `${dirPath} (${filtered.length} items):\n\n${lines.join('\n')}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Delete file ──────────────────────────────────────────────────────────
    {
      name: 'delete_file',
      description: 'Delete a file or empty directory.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file or directory to delete' },
          recursive: { type: 'string', description: '"true" to delete non-empty directories recursively (careful!)' }
        },
        required: ['path']
      },
      handler: async (input) => {
        const filePath = (input.path as string).replace(/^~/, os.homedir());
        const recursive = input.recursive === 'true';

        try {
          if (recursive) {
            await fs.remove(filePath);
          } else {
            await fs.unlink(filePath);
          }
          const result = `Deleted: ${filePath}`;
          await logAction('delete_file', { path: filePath, recursive }, result);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Kill process ───────────────────────────────────────────────────────────
    {
      name: 'kill_process',
      description: 'Kill a process by PID. Use system_info with "processes" to find PIDs.',
      input_schema: {
        type: 'object',
        properties: {
          pid: { type: 'string', description: 'Process ID to kill' },
          signal: { type: 'string', description: 'Signal: SIGTERM (default) or SIGKILL' }
        },
        required: ['pid']
      },
      handler: async (input) => {
        const pid = parseInt(input.pid as string, 10);
        const sig = (input.signal as string) || 'SIGTERM';
        if (isNaN(pid) || pid < 1) return 'Invalid PID.';
        try {
          process.kill(pid, sig as NodeJS.Signals);
          const result = `Sent ${sig} to PID ${pid}`;
          await logAction('kill_process', { pid, sig }, result);
          return result;
        } catch (e: any) {
          if (e.code === 'ESRCH') return `Process ${pid} not found.`;
          return `Error: ${e.message}`;
        }
      }
    },

    // ── System info ──────────────────────────────────────────────────────────
    {
      name: 'system_info',
      description: 'Get system information: OS, CPU, memory, disk usage, running processes, network.',
      input_schema: {
        type: 'object',
        properties: {
          what: {
            type: 'string',
            description: 'What to check: "overview", "processes", "disk", "network", "memory"',
            enum: ['overview', 'processes', 'disk', 'network', 'memory']
          }
        },
        required: ['what']
      },
      handler: async (input) => {
        const what = input.what as string;

        const cmds: Record<string, string> = {
          overview: `uname -a && echo "---" && uptime && echo "---" && whoami && echo "---" && df -h / | tail -1`,
          processes: process.platform === 'darwin'
            ? 'ps aux | head -20'
            : 'ps aux --sort=-%cpu | head -20',
          disk: 'df -h',
          network: process.platform === 'darwin'
            ? 'ifconfig | grep -E "inet |flags"'
            : 'ip addr show | grep -E "inet |state"',
          memory: process.platform === 'darwin'
            ? 'vm_stat && echo "---" && sysctl hw.memsize'
            : 'free -h && echo "---" && cat /proc/meminfo | head -10'
        };

        const cmd = cmds[what] || cmds.overview;
        try {
          const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
          return (stdout + stderr).trim().slice(0, 4000);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Open app / URL ───────────────────────────────────────────────────────
    {
      name: 'open',
      description: 'Open a file, folder, URL, or application on the user\'s computer.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'What to open: URL (https://...), file path, app name (macOS: "Safari", Linux: "firefox"), or folder path' }
        },
        required: ['target']
      },
      handler: async (input) => {
        const target = input.target as string;
        const openCmd = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'start'
          : 'xdg-open';

        try {
          await execAsync(`${openCmd} "${target.replace(/"/g, '\\"')}"`, { timeout: 5000 });
          const result = `Opened: ${target}`;
          await logAction('open', { target }, result);
          return result;
        } catch (e: any) {
          return `Error opening ${target}: ${e.message}`;
        }
      }
    },

    // ── Clipboard ────────────────────────────────────────────────────────────
    {
      name: 'clipboard',
      description: 'Read from or write to the system clipboard.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '"read" to get clipboard content, "write" to set it', enum: ['read', 'write'] },
          content: { type: 'string', description: 'Content to write (only for action=write)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const action = input.action as string;

        if (action === 'read') {
          const cmd = process.platform === 'darwin' ? 'pbpaste'
            : process.platform === 'linux' ? 'xclip -selection clipboard -o'
            : 'powershell Get-Clipboard';
          try {
            const { stdout } = await execAsync(cmd, { timeout: 5000 });
            return stdout.trim().slice(0, 4000) || '(empty clipboard)';
          } catch {
            return 'Error: clipboard not available (try installing xclip on Linux)';
          }
        }

        if (action === 'write' && input.content) {
          const content = input.content as string;
          const cmd = process.platform === 'darwin'
            ? `echo "${content.replace(/"/g, '\\"')}" | pbcopy`
            : process.platform === 'linux'
            ? `echo "${content.replace(/"/g, '\\"')}" | xclip -selection clipboard`
            : `powershell Set-Clipboard "${content.replace(/"/g, '\\"')}"`;
          try {
            await execAsync(cmd, { timeout: 5000 });
            return `Copied to clipboard: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`;
          } catch {
            return 'Error: clipboard write failed';
          }
        }

        return 'Error: invalid action';
      }
    },

    // ── Search files ─────────────────────────────────────────────────────────
    {
      name: 'search_files',
      description: 'Search for files by name or content on the computer.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (filename or text content)' },
          dir: { type: 'string', description: 'Directory to search in (optional, default: home dir)' },
          type: {
            type: 'string',
            description: '"name" to search by filename, "content" to search inside files',
            enum: ['name', 'content']
          }
        },
        required: ['query', 'type']
      },
      handler: async (input) => {
        const query = input.query as string;
        const dir = ((input.dir as string) || os.homedir()).replace(/^~/, os.homedir());
        const type = input.type as string;

        try {
          let cmd: string;
          if (type === 'name') {
            cmd = `find "${dir}" -name "*${query}*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -50`;
          } else {
            cmd = `grep -rl "${query}" "${dir}" --include="*.ts" --include="*.js" --include="*.py" --include="*.txt" --include="*.md" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -30`;
          }
          const { stdout } = await execAsync(cmd, { timeout: 15000 });
          return stdout.trim() || `No results for "${query}" in ${dir}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Screenshot ───────────────────────────────────────────────────────────
    {
      name: 'screenshot',
      description: 'Take a screenshot of the screen and save it to a file.',
      input_schema: {
        type: 'object',
        properties: {
          output: { type: 'string', description: 'Output file path (optional, default: ~/Desktop/screenshot.png)' }
        }
      },
      handler: async (input) => {
        const output = ((input.output as string) || '~/Desktop/screenshot.png').replace(/^~/, os.homedir());
        await fs.ensureDir(path.dirname(output));

        try {
          let cmd: string;
          if (process.platform === 'darwin') {
            cmd = `screencapture -x "${output}"`;
          } else if (process.platform === 'linux') {
            cmd = `import -window root "${output}" 2>/dev/null || scrot "${output}"`;
          } else {
            return 'Screenshot not supported on this platform via CLI';
          }
          await execAsync(cmd, { timeout: 10000 });
          const result = `Screenshot saved to ${output}`;
          await logAction('screenshot', { output }, result);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Camera (webcam) ──────────────────────────────────────────────────────
    {
      name: 'camera_capture',
      description: 'Take a photo with the device webcam. macOS: imagesnap or ffmpeg; Linux: ffmpeg. Requires imagesnap (brew install imagesnap) on macOS.',
      input_schema: {
        type: 'object',
        properties: {
          output: { type: 'string', description: 'Output file path (optional, default: ~/Desktop/webcam.jpg)' }
        }
      },
      handler: async (input) => {
        const output = ((input.output as string) || '~/Desktop/webcam.jpg').replace(/^~/, os.homedir());
        await fs.ensureDir(path.dirname(output));

        try {
          let cmd: string;
          if (process.platform === 'darwin') {
            cmd = `imagesnap -q "${output}" 2>/dev/null || ffmpeg -f avfoundation -framerate 1 -i "0" -vframes 1 -y "${output}" 2>/dev/null`;
          } else if (process.platform === 'linux') {
            cmd = `ffmpeg -f v4l2 -i /dev/video0 -vframes 1 -y "${output}" 2>/dev/null`;
          } else {
            return 'Camera capture not supported on this platform';
          }
          await execAsync(cmd, { timeout: 15000 });
          const result = `Webcam photo saved to ${output}`;
          await logAction('camera_capture', { output }, result);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}. Install imagesnap (brew install imagesnap) or ffmpeg for macOS.`;
        }
      }
    },

    // ── Screen recording ─────────────────────────────────────────────────────
    {
      name: 'screen_record',
      description: 'Record the screen for a given duration. macOS only. Uses screencapture -V.',
      input_schema: {
        type: 'object',
        properties: {
          duration: { type: 'string', description: 'Recording duration in seconds (default 10)' },
          output: { type: 'string', description: 'Output path (optional, default ~/Desktop/screen-record.mov)' }
        }
      },
      handler: async (input) => {
        const duration = parseInt((input.duration as string) || '10', 10);
        const output = ((input.output as string) || '~/Desktop/screen-record.mov').replace(/^~/, os.homedir());

        if (process.platform !== 'darwin') {
          return 'Screen recording supported on macOS only (screencapture -V)';
        }

        try {
          await execAsync(`screencapture -V ${Math.min(60, Math.max(1, duration))} -v "${output}"`, {
            timeout: (duration + 5) * 1000
          });
          const result = `Screen recording saved to ${output}`;
          await logAction('screen_record', { duration, output }, result);
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Contacts (macOS) ─────────────────────────────────────────────────────
    {
      name: 'contacts_list',
      description: 'List contacts from the system address book. macOS only. Returns name and primary phone/email.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max contacts to return (default 50)' },
          search: { type: 'string', description: 'Filter by name (optional)' }
        }
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Contacts available on macOS only';
        const limit = parseInt((input.limit as string) || '50', 10);
        const search = ((input.search as string) || '').replace(/"/g, '\\"');
        const tmp = path.join(os.tmpdir(), `hc-contacts-${Date.now()}.scpt`);
        const script = `tell application "Contacts" to get name of every person`;
        try {
          await fs.writeFile(tmp, script, 'utf8');
          const { stdout } = await execAsync(`osascript "${tmp}"`, { timeout: 10000 });
          await fs.remove(tmp).catch(() => {});
          let names = (stdout || '').trim().split(', ').filter(Boolean);
          if (search) names = names.filter((n: string) => n.toLowerCase().includes(search.toLowerCase()));
          const result = names.slice(0, limit).join('\n') || 'No contacts found';
          await logAction('contacts_list', { limit, search }, `${names.length} contacts`);
          return result;
        } catch (e: any) {
          await fs.remove(tmp).catch(() => {});
          return `Error: ${e.message}. Grant Contacts access to Terminal if prompted.`;
        }
      }
    },

    // ── Calendar (macOS) ─────────────────────────────────────────────────────
    {
      name: 'calendar_events',
      description: 'List upcoming calendar events. macOS only. Uses icalBuddy if installed, else basic iCal.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'string', description: 'Number of days ahead (default 7)' },
          limit: { type: 'string', description: 'Max events (default 20)' }
        }
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Calendar available on macOS only';
        const days = parseInt((input.days as string) || '7', 10);
        const limit = parseInt((input.limit as string) || '20', 10);
        try {
          const { stdout } = await execAsync(
            `icalBuddy -n -ec -nc -nrd -df "%a %H:%M" -sd -ecc eventsToday+${days} 2>/dev/null | head -${limit * 2}`,
            { timeout: 10000 }
          ).catch(() => execAsync(
            `osascript -e 'tell application "Calendar" to return summary of (every event whose start date > (current date))'`,
            { timeout: 10000 }
          ));
          const result = (stdout || '').trim() || 'No upcoming events (install icalBuddy for richer output: brew install ical-buddy)';
          await logAction('calendar_events', { days, limit }, result.slice(0, 200));
          return result;
        } catch (e: any) {
          return `Error: ${e.message}. Grant Calendar access if prompted.`;
        }
      }
    },

    // ── Recent photos (macOS) ────────────────────────────────────────────────
    {
      name: 'photos_recent',
      description: 'List recent photos from Photos library. macOS only. Uses mdfind on Photos library.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max photos (default 20)' }
        }
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Photos available on macOS only';
        const limit = parseInt((input.limit as string) || '20', 10);
        try {
          const lib = path.join(os.homedir(), 'Pictures', 'Photos Library.photoslibrary');
          const { stdout } = await execAsync(
            `mdfind -onlyin "${lib}" "kMDItemContentType == 'public.jpeg' || kMDItemContentType == 'public.png'" 2>/dev/null | head -${limit}`,
            { timeout: 15000 }
          ).catch(() => ({ stdout: '' }));
          const lines = (stdout || '').trim().split('\n').filter(Boolean);
          const result = lines.length ? lines.map((f: string) => path.basename(f)).join('\n') : 'No photos found';
          await logAction('photos_recent', { limit }, result.slice(0, 200));
          return result;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── App updates ──────────────────────────────────────────────────────────
    {
      name: 'app_updates',
      description: 'Check for available app updates. Uses Homebrew (macOS/Linux) and optionally Mac App Store (mas) on macOS.',
      input_schema: {
        type: 'object',
        properties: {
          apply: { type: 'string', description: '"true" to actually run the updates (default: false, dry-run)' }
        }
      },
      handler: async (input) => {
        const apply = input.apply === 'true';
        try {
          let out = '';
          const { stdout: brewOut } = await execAsync('brew update 2>/dev/null; brew outdated 2>/dev/null || true', { timeout: 60000 });
          out += 'Homebrew outdated:\n' + (brewOut.trim() || '(none)') + '\n\n';

          if (process.platform === 'darwin') {
            try {
              const { stdout: masOut } = await execAsync('mas outdated 2>/dev/null || true', { timeout: 10000 });
              out += 'Mac App Store outdated:\n' + (masOut.trim() || '(none)');
            } catch {
              out += 'Mac App Store: mas not installed (brew install mas)';
            }
          }

          if (apply && brewOut.trim()) {
            await execAsync('brew upgrade', { timeout: 300000 });
            out += '\n\nHomebrew upgrade completed.';
          }
          await logAction('app_updates', { apply }, out.slice(0, 300));
          return out;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },

    // ── Notify ───────────────────────────────────────────────────────────────
    {
      name: 'notify',
      description: 'Send a desktop notification to the user.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Notification title' },
          message: { type: 'string', description: 'Notification message body' }
        },
        required: ['title', 'message']
      },
      handler: async (input) => {
        const title = input.title as string;
        const message = input.message as string;

        try {
          let cmd: string;
          if (process.platform === 'darwin') {
            cmd = `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`;
          } else if (process.platform === 'linux') {
            cmd = `notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`;
          } else {
            return 'Notifications not supported';
          }
          await execAsync(cmd, { timeout: 5000 });
          return `Notification sent: ${title} — ${message}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    }

  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface PCAccessConfig {
  enabled: boolean;
  level: 'read-only' | 'sandboxed' | 'full';
  allowedPaths?: string[];
  allowedCommands?: string[];
  confirmDestructive?: boolean;
  maxOutputBytes?: number;
}

/**
 * HyperClaw (OpenClaw-style) behaviour: daemon starts with FULL pc access by default.
 * The user opted in by running `hyperclaw init` and accepting the risk screen.
 * Config in hyperclaw.json can override to read-only or sandboxed.
 * When daemonMode is true, PC access is forced enabled/full so daemon has full access like OpenClaw.
 */
export async function loadPCAccessConfig(opts?: { daemonMode?: boolean }): Promise<PCAccessConfig> {
  const daemonDefault: PCAccessConfig = {
    enabled: true,
    level: 'full',
    confirmDestructive: false,
    maxOutputBytes: 50_000
  };
  if (opts?.daemonMode) return daemonDefault;

  try {
    const cfgFile = getConfigPath();
    const cfg = await fs.readJson(cfgFile);
    if (cfg.pcAccess) return cfg.pcAccess as PCAccessConfig;
  } catch {}

  return daemonDefault;
}

export async function showPCAccessStatus(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const cfg = await loadPCAccessConfig();
  console.log(chalk.bold.cyan('\n  PC ACCESS STATUS\n'));
  console.log(`  Enabled:  ${cfg.enabled ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  Level:    ${cfg.level}`);
  if (cfg.allowedPaths?.length) console.log(`  Paths:    ${cfg.allowedPaths.join(', ')}`);
  if (cfg.allowedCommands?.length) console.log(`  Commands: ${cfg.allowedCommands.join(', ')}`);
  console.log();
}

export async function savePCAccessConfig(updates: Partial<PCAccessConfig>): Promise<void> {
  const cfgFile = getConfigPath();
  let cfg: Record<string, unknown> = {};
  try { cfg = await fs.readJson(cfgFile); } catch {}
  cfg.pcAccess = { ...(cfg.pcAccess as object || {}), ...updates };
  await fs.ensureDir(path.dirname(cfgFile));
  await fs.writeJson(cfgFile, cfg, { spaces: 2 });
}
