#!/usr/bin/env node
/**
 * HyperClaw MCP Server — Terminal / Shell
 * Transport: stdio (newline-delimited JSON-RPC 2.0)
 *
 * ⚠️  Security: Only enable this server if you trust the AI and have daemon mode active.
 *      The ALLOWED_COMMANDS env var restricts which commands can run (comma-separated prefixes).
 *      If ALLOWED_COMMANDS is not set, all commands are allowed.
 *
 * Tools:
 *   run_command      — run a shell command and return stdout/stderr
 *   run_script       — run a multi-line shell script
 *   get_environment  — inspect environment variables (filtered)
 *   list_processes   — list running processes
 *   get_system_info  — OS, CPU, memory, uptime
 */

import readline from 'readline';
import { exec } from 'child_process';
import os from 'os';

const ALLOWED_PREFIXES = process.env.ALLOWED_COMMANDS
  ? process.env.ALLOWED_COMMANDS.split(',').map(s => s.trim())
  : null; // null = all allowed

const BLOCKED = ['rm -rf /', 'format ', 'mkfs', 'dd if=', ':(){ :|:& };:'];
const TIMEOUT_MS = 30_000;

const TOOLS = [
  {
    name: 'run_command',
    description: 'Run a shell command and return its output. Timeout: 30s.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Working directory (default: home dir)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (max 30000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'run_script',
    description: 'Run a multi-line shell script. Each line is executed in sequence.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Multi-line shell script to execute' },
        cwd: { type: 'string', description: 'Working directory (default: home dir)' }
      },
      required: ['script']
    }
  },
  {
    name: 'get_environment',
    description: 'Get environment variables (secrets like API keys are masked).',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional prefix filter (e.g. "PATH" to show only PATH vars)' }
      }
    }
  },
  {
    name: 'list_processes',
    description: 'List currently running processes.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional process name filter' }
      }
    }
  },
  {
    name: 'get_system_info',
    description: 'Get OS, CPU, memory, and uptime information.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function textContent(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function isAllowed(command) {
  for (const blocked of BLOCKED) {
    if (command.includes(blocked)) return false;
  }
  if (!ALLOWED_PREFIXES) return true;
  return ALLOWED_PREFIXES.some(prefix => command.trim().startsWith(prefix));
}

function runCommand(command, cwd, timeout) {
  return new Promise((resolve) => {
    exec(command, {
      cwd: cwd || os.homedir(),
      timeout: Math.min(timeout || TIMEOUT_MS, TIMEOUT_MS),
      maxBuffer: 1024 * 1024 * 2
    }, (err, stdout, stderr) => {
      const out = stdout.trim();
      const errOut = stderr.trim();
      if (err && !out && !errOut) {
        resolve(`Error (${err.code}): ${err.message}`);
      } else {
        resolve([
          out && `STDOUT:\n${out}`,
          errOut && `STDERR:\n${errOut}`,
          err && `Exit code: ${err.code}`
        ].filter(Boolean).join('\n\n') || '(no output)');
      }
    });
  });
}

function maskSecrets(key, value) {
  const sensitive = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'PASS', 'CREDENTIAL', 'AUTH'];
  if (sensitive.some(s => key.toUpperCase().includes(s))) {
    return value.slice(0, 4) + '***masked***';
  }
  return value;
}

async function callTool(name, args) {
  switch (name) {
    case 'run_command': {
      if (!isAllowed(args.command)) {
        return `⛔ Command not allowed: "${args.command}"\nSet ALLOWED_COMMANDS env var to whitelist commands.`;
      }
      return await runCommand(args.command, args.cwd, args.timeout);
    }
    case 'run_script': {
      const lines = args.script.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      const results = [];
      for (const line of lines) {
        if (!isAllowed(line)) {
          results.push(`⛔ BLOCKED: ${line}`);
          break;
        }
        const out = await runCommand(line, args.cwd);
        results.push(`$ ${line}\n${out}`);
      }
      return results.join('\n\n---\n\n');
    }
    case 'get_environment': {
      const env = process.env;
      const lines = [];
      for (const [key, val] of Object.entries(env)) {
        if (args.filter && !key.toLowerCase().includes(args.filter.toLowerCase())) continue;
        lines.push(`${key}=${maskSecrets(key, val || '')}`);
      }
      return lines.sort().join('\n') || '(no matching variables)';
    }
    case 'list_processes': {
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? `tasklist /FO CSV /NH`
        : `ps aux --no-header | awk '{print $1, $11}' | sort | uniq`;
      let output = await runCommand(cmd, os.homedir());
      if (args.filter) {
        output = output.split('\n').filter(l => l.toLowerCase().includes(args.filter.toLowerCase())).join('\n');
      }
      return output || '(no matching processes)';
    }
    case 'get_system_info': {
      const cpus = os.cpus();
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      return [
        `OS:       ${os.type()} ${os.release()} (${os.platform()})`,
        `Arch:     ${os.arch()}`,
        `Hostname: ${os.hostname()}`,
        `CPUs:     ${cpus.length}x ${cpus[0]?.model || 'unknown'}`,
        `Memory:   ${Math.round(freeMem / 1024 / 1024)}MB free / ${Math.round(totalMem / 1024 / 1024)}MB total`,
        `Uptime:   ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        `Node:     ${process.version}`,
        `Home:     ${os.homedir()}`,
        `Shell:    ${process.env.SHELL || process.env.COMSPEC || 'unknown'}`
      ].join('\n');
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }

  const { id, method, params } = req;

  try {
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'hyperclaw-mcp-terminal', version: '1.0.0' },
          capabilities: { tools: {} }
        });
        break;
      case 'notifications/initialized':
        break;
      case 'tools/list':
        respond(id, { tools: TOOLS });
        break;
      case 'tools/call': {
        const result = await callTool(params.name, params.arguments || {});
        respond(id, textContent(result));
        break;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    respond(id, textContent(`Error: ${e.message}`));
  }
});
