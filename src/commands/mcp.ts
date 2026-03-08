/**
 * src/commands/mcp.ts
 * `hyperclaw mcp` — MCP (Model Context Protocol) server management.
 * Register, test, and remove MCP servers that your agent can call as tools.
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { getHyperClawDir } from '../infra/paths';

const getMcpFile = () => path.join(getHyperClawDir(), 'mcp-servers.json');

export type MCPTransport = 'stdio' | 'sse' | 'http';

export interface MCPServer {
  id: string;
  name: string;
  transport: MCPTransport;
  command?: string;        // for stdio: e.g. "node /path/to/server.js"
  url?: string;            // for sse/http: e.g. "http://localhost:3001"
  env?: Record<string, string>;
  enabled: boolean;
  addedAt: string;
  tools?: string[];        // cached list of tools from last probe
  lastProbeAt?: string;
}

async function loadServers(): Promise<MCPServer[]> {
  try { return await fs.readJson(getMcpFile()); }
  catch { return []; }
}

async function saveServers(servers: MCPServer[]): Promise<void> {
  const mcpFile = getMcpFile();
  await fs.ensureDir(path.dirname(mcpFile));
  await fs.writeJson(mcpFile, servers, { spaces: 2 });
}

export async function mcpList(): Promise<void> {
  const servers = await loadServers();
  console.log(chalk.bold.cyan('\n  🔌 MCP SERVERS\n'));

  if (servers.length === 0) {
    console.log(chalk.gray('  No MCP servers registered.\n'));
    console.log(chalk.gray('  Add one: hyperclaw mcp add\n'));
    console.log(chalk.gray('  Or install via skill hub: hyperclaw hub --install mcp-filesystem\n'));
    return;
  }

  for (const s of servers) {
    const dot = s.enabled ? chalk.green('●') : chalk.gray('○');
    console.log(`  ${dot} ${chalk.white(s.name)} ${chalk.gray(`[${s.transport}]`)}`);
    if (s.command) console.log(`    ${chalk.gray('cmd:')} ${s.command}`);
    if (s.url) console.log(`    ${chalk.gray('url:')} ${chalk.cyan(s.url)}`);
    if (s.tools?.length) {
      console.log(`    ${chalk.gray('tools:')} ${s.tools.slice(0, 5).join(', ')}${s.tools.length > 5 ? ` +${s.tools.length - 5} more` : ''}`);
    }
    if (s.lastProbeAt) console.log(`    ${chalk.gray(`last probe: ${new Date(s.lastProbeAt).toLocaleString()}`)}`);
    console.log();
  }
}

export async function mcpAdd(): Promise<void> {
  console.log(chalk.bold.cyan('\n  ➕ ADD MCP SERVER\n'));

  const { name } = await inquirer.prompt([{
    type: 'input', name: 'name', message: 'Server name:', validate: v => !!v.trim() || 'Required'
  }]);

  const { transport } = await inquirer.prompt([{
    type: 'list', name: 'transport', message: 'Transport:', choices: ['stdio', 'sse', 'http']
  }]);

  let command: string | undefined;
  let url: string | undefined;

  if (transport === 'stdio') {
    const res = await inquirer.prompt([{
      type: 'input', name: 'command',
      message: 'Start command (e.g. node /path/to/server.js):',
      validate: v => !!v.trim() || 'Required'
    }]);
    command = res.command;
  } else {
    const res = await inquirer.prompt([{
      type: 'input', name: 'url',
      message: `URL (e.g. http://localhost:3001):`,
      validate: v => v.startsWith('http') || 'Must start with http'
    }]);
    url = res.url;
  }

  const server: MCPServer = {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    transport: transport as MCPTransport,
    command,
    url,
    enabled: true,
    addedAt: new Date().toISOString()
  };

  const servers = await loadServers();
  servers.push(server);
  await saveServers(servers);

  console.log(chalk.green(`\n  ✔  MCP server added: ${name}`));
  console.log(chalk.gray('  Run: hyperclaw mcp probe    to test the connection\n'));
}

export async function mcpRemove(id: string): Promise<void> {
  const servers = await loadServers();
  const idx = servers.findIndex(s => s.id === id);
  if (idx === -1) { console.log(chalk.red(`\n  ✖  Server not found: ${id}\n`)); return; }
  servers.splice(idx, 1);
  await saveServers(servers);
  console.log(chalk.green(`\n  ✔  MCP server removed: ${id}\n`));
}

export async function mcpProbe(id?: string): Promise<void> {
  const servers = await loadServers();
  const targets = id ? servers.filter(s => s.id === id) : servers;

  if (targets.length === 0) {
    console.log(chalk.gray('\n  No servers to probe. Add one: hyperclaw mcp add\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n  🔍 PROBING MCP SERVERS\n'));

  for (const server of targets) {
    const spinner = ora(`  Probing ${server.name}...`).start();
    await new Promise(r => setTimeout(r, 800));

    // In production: would actually connect and call tools/list
    if (server.transport === 'http' || server.transport === 'sse') {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(`${server.url}/tools`, { timeout: 3000 });
        server.tools = res.data?.tools?.map((t: any) => t.name) || [];
        server.lastProbeAt = new Date().toISOString();
        await saveServers(servers);
        spinner.succeed(`${server.name} — ${server.tools?.length ?? 0} tools`);
        if ((server.tools?.length ?? 0) > 0) {
          console.log(chalk.gray(`    ${server.tools?.join(', ') ?? ''}`));
        }
      } catch {
        spinner.warn(`${server.name} — unreachable (${server.url})`);
      }
    } else {
      // stdio servers need subprocess — simulate
      server.lastProbeAt = new Date().toISOString();
      await saveServers(servers);
      spinner.succeed(`${server.name} — stdio (probe requires running server)`);
    }
    console.log();
  }
}
