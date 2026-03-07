#!/usr/bin/env node
/**
 * HyperClaw MCP Server — Filesystem
 * Transport: stdio (newline-delimited JSON-RPC 2.0)
 *
 * Tools:
 *   read_file        — read a file's contents
 *   write_file       — write / overwrite a file
 *   list_directory   — list entries in a directory
 *   search_files     — find files matching a pattern
 *   file_info        — stat a path (size, mtime, type)
 *   delete_file      — delete a file
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file. Returns text.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
        encoding: { type: 'string', description: 'Encoding (default: utf8)', default: 'utf8' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write (create or overwrite) a file. Creates parent directories automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Destination file path' },
        content: { type: 'string', description: 'Text content to write' },
        append: { type: 'boolean', description: 'Append instead of overwrite', default: false }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List all entries (files + subdirs) in a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean', description: 'Recurse into subdirectories', default: false }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    description: 'Search for files whose name matches a pattern (case-insensitive glob). Returns up to 100 paths.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Filename glob pattern, e.g. "*.ts" or "config*"' },
        directory: { type: 'string', description: 'Root directory to search (default: home dir)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'file_info',
    description: 'Get metadata about a file or directory (size, type, modified time).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path' }
      },
      required: ['path']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file (not directories). Use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' }
      },
      required: ['path']
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

function walkDir(dir, recursive, depth = 0) {
  const entries = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const type = entry.isDirectory() ? 'dir' : 'file';
      entries.push(`${'  '.repeat(depth)}${type === 'dir' ? '📁' : '📄'} ${entry.name}`);
      if (recursive && entry.isDirectory() && depth < 3) {
        entries.push(...walkDir(full, true, depth + 1));
      }
    }
  } catch {}
  return entries;
}

function searchFiles(pattern, dir) {
  const results = [];
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i'
  );
  function walk(d) {
    if (results.length >= 100) return;
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(path.join(d, entry.name));
          }
        } else if (regex.test(entry.name)) {
          results.push(path.join(d, entry.name));
        }
      }
    } catch {}
  }
  walk(dir);
  return results;
}

async function callTool(name, args) {
  switch (name) {
    case 'read_file': {
      const content = fs.readFileSync(args.path, args.encoding || 'utf8');
      return `[${args.path}]\n\n${content}`;
    }
    case 'write_file': {
      const dir = path.dirname(args.path);
      fs.mkdirSync(dir, { recursive: true });
      if (args.append) {
        fs.appendFileSync(args.path, args.content, 'utf8');
        return `Appended ${args.content.length} chars to ${args.path}`;
      }
      fs.writeFileSync(args.path, args.content, 'utf8');
      return `Written ${args.content.length} chars to ${args.path}`;
    }
    case 'list_directory': {
      const lines = walkDir(args.path, args.recursive === true);
      return lines.length > 0 ? lines.join('\n') : '(empty directory)';
    }
    case 'search_files': {
      const root = args.directory || os.homedir();
      const files = searchFiles(args.pattern, root);
      return files.length > 0
        ? `Found ${files.length} file(s):\n${files.join('\n')}`
        : `No files matching "${args.pattern}" in ${root}`;
    }
    case 'file_info': {
      const stat = fs.statSync(args.path);
      return [
        `Path:     ${args.path}`,
        `Type:     ${stat.isDirectory() ? 'directory' : 'file'}`,
        `Size:     ${stat.size} bytes`,
        `Modified: ${stat.mtime.toISOString()}`,
        `Created:  ${stat.birthtime.toISOString()}`
      ].join('\n');
    }
    case 'delete_file': {
      fs.unlinkSync(args.path);
      return `Deleted: ${args.path}`;
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
          serverInfo: { name: 'hyperclaw-mcp-filesystem', version: '1.0.0' },
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
