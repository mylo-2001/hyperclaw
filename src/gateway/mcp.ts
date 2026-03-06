/**
 * src/gateway/mcp.ts
 * MCP (Model Context Protocol) server registry and proxy.
 * `hyperclaw mcp list / add / remove / test`
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MCPServerDef {
  id: string;
  name: string;
  command: string;        // e.g. "npx @modelcontextprotocol/server-github"
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  transport: 'stdio' | 'http';
  url?: string;           // for http transport
  addedAt: string;
  tools?: string[];       // cached tool names
}

const MCP_REGISTRY_FILE = path.join(os.homedir(), '.hyperclaw', 'mcp-servers.json');

// Popular MCP servers pre-defined
export const POPULAR_MCP_SERVERS: Omit<MCPServerDef, 'id' | 'addedAt' | 'enabled'>[] = [
  {
    name: 'GitHub',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    transport: 'stdio',
    tools: ['search_repositories', 'get_file_contents', 'create_issue', 'create_pull_request']
  },
  {
    name: 'Filesystem',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', '--allowed-dirs', os.homedir()],
    transport: 'stdio',
    tools: ['read_file', 'write_file', 'list_directory', 'search_files']
  },
  {
    name: 'Brave Search',
    command: 'npx',
    args: ['@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    transport: 'stdio',
    tools: ['brave_web_search']
  },
  {
    name: 'PostgreSQL',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: '' },
    transport: 'stdio',
    tools: ['query', 'list_tables', 'describe_table']
  },
  {
    name: 'Puppeteer (Browser)',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
    transport: 'stdio',
    tools: ['navigate', 'screenshot', 'click', 'fill', 'evaluate']
  },
  {
    name: 'Slack',
    command: 'npx',
    args: ['@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    transport: 'stdio',
    tools: ['post_message', 'get_channels', 'get_messages']
  },
  {
    name: 'Google Drive',
    command: 'npx',
    args: ['@modelcontextprotocol/server-gdrive'],
    env: { GDRIVE_CREDENTIALS: '' },
    transport: 'stdio',
    tools: ['search_files', 'read_file', 'create_file']
  },
  {
    name: 'Custom HTTP',
    command: '',
    args: [],
    transport: 'http',
    url: 'http://localhost:8080/mcp',
    tools: []
  }
];

export class MCPRegistry {
  private servers: MCPServerDef[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      this.servers = fs.readJsonSync(MCP_REGISTRY_FILE);
    } catch {
      this.servers = [];
    }
  }

  private save(): void {
    fs.ensureDirSync(path.dirname(MCP_REGISTRY_FILE));
    fs.writeJsonSync(MCP_REGISTRY_FILE, this.servers, { spaces: 2 });
  }

  list(): void {
    console.log(chalk.bold.cyan('\n  🔌 MCP SERVERS\n'));

    if (this.servers.length === 0) {
      console.log(chalk.gray('  No MCP servers configured.\n'));
      console.log(chalk.gray('  Add one: hyperclaw mcp add\n'));
      return;
    }

    for (const s of this.servers) {
      const dot = s.enabled ? chalk.green('●') : chalk.gray('○');
      const transport = chalk.gray(`[${s.transport}]`);
      console.log(`  ${dot} ${chalk.white(s.name.padEnd(20))} ${transport}  ${chalk.gray(s.id)}`);
      if (s.transport === 'http' && s.url) {
        console.log(`     ${chalk.gray(s.url)}`);
      } else {
        console.log(`     ${chalk.gray(`${s.command} ${s.args.join(' ')}`.slice(0, 60))}`);
      }
      if (s.tools && s.tools.length > 0) {
        console.log(`     tools: ${chalk.cyan(s.tools.slice(0, 4).join(', '))}${s.tools.length > 4 ? chalk.gray(` +${s.tools.length - 4} more`) : ''}`);
      }
      console.log();
    }

    console.log(chalk.gray(`  ${this.servers.filter(s => s.enabled).length}/${this.servers.length} enabled`));
    console.log(chalk.gray('  Test: hyperclaw mcp test <id>\n'));
  }

  async add(): Promise<void> {
    console.log(chalk.bold.cyan('\n  🔌 Add MCP Server\n'));

    const { mode } = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: 'Choose server type:',
      choices: [
        ...POPULAR_MCP_SERVERS.map(s => ({ name: s.name, value: s })),
        { name: '+ Custom...', value: 'custom' }
      ]
    }]);

    let serverDef: Partial<MCPServerDef>;

    if (mode === 'custom') {
      const { transport } = await inquirer.prompt([{
        type: 'list', name: 'transport', message: 'Transport:', choices: ['stdio', 'http']
      }]);

      if (transport === 'http') {
        const { name, url } = await inquirer.prompt([
          { type: 'input', name: 'name', message: 'Server name:' },
          { type: 'input', name: 'url', message: 'URL:', default: 'http://localhost:8080/mcp' }
        ]);
        serverDef = { name, transport: 'http', url, command: '', args: [] };
      } else {
        const { name, command } = await inquirer.prompt([
          { type: 'input', name: 'name', message: 'Server name:' },
          { type: 'input', name: 'command', message: 'Command:', default: 'npx @modelcontextprotocol/server-custom' }
        ]);
        const parts = command.split(' ');
        serverDef = { name, transport: 'stdio', command: parts[0], args: parts.slice(1) };
      }
    } else {
      serverDef = mode;

      // Fill in missing env vars
      if (serverDef.env) {
        const missing = Object.keys(serverDef.env).filter(k => !process.env[k]);
        for (const key of missing) {
          const { val } = await inquirer.prompt([{
            type: 'input',
            name: 'val',
            message: `${key} (leave blank to skip):`,
          }]);
          if (val) serverDef.env![key] = val;
        }
      }
    }

    const newServer: MCPServerDef = {
      id: `mcp-${Date.now().toString(36)}`,
      name: serverDef.name || 'MCP Server',
      command: serverDef.command || '',
      args: serverDef.args || [],
      env: serverDef.env,
      transport: serverDef.transport || 'stdio',
      url: serverDef.url,
      enabled: true,
      addedAt: new Date().toISOString(),
      tools: serverDef.tools || []
    };

    this.servers.push(newServer);
    this.save();

    console.log(chalk.green(`\n  ✔  MCP server added: ${newServer.name} (${newServer.id})`));
    console.log(chalk.gray('  Test with: hyperclaw mcp test ' + newServer.id + '\n'));
  }

  remove(id: string): void {
    const before = this.servers.length;
    this.servers = this.servers.filter(s => s.id !== id);
    if (this.servers.length < before) {
      this.save();
      console.log(chalk.green(`\n  ✔  MCP server removed: ${id}\n`));
    } else {
      console.log(chalk.red(`\n  ✖  MCP server not found: ${id}\n`));
    }
  }

  enable(id: string): void {
    const s = this.servers.find(s => s.id === id);
    if (!s) { console.log(chalk.red(`  ✖  Not found: ${id}`)); return; }
    s.enabled = true;
    this.save();
    console.log(chalk.green(`  ✔  Enabled: ${s.name}`));
  }

  disable(id: string): void {
    const s = this.servers.find(s => s.id === id);
    if (!s) { console.log(chalk.red(`  ✖  Not found: ${id}`)); return; }
    s.enabled = false;
    this.save();
    console.log(chalk.green(`  ✔  Disabled: ${s.name}`));
  }

  async test(id: string): Promise<void> {
    const s = this.servers.find(s => s.id === id || s.name.toLowerCase() === id.toLowerCase());
    if (!s) {
      console.log(chalk.red(`\n  ✖  MCP server not found: ${id}\n`));
      return;
    }

    const spinner = ora(`Testing MCP server: ${s.name}...`).start();

    if (s.transport === 'http') {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(s.url! + '/ping', { timeout: 3000 });
        spinner.succeed(`${s.name} responded: ${res.status}`);
      } catch (err: any) {
        spinner.fail(`${s.name} unreachable: ${err.message}`);
      }
      return;
    }

    // stdio: try to spawn and get tool list
    try {
      const envFull = { ...process.env, ...(s.env || {}) };
      const proc = spawn(s.command, s.args, {
        env: envFull,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Send MCP initialize request
      const initReq = JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', clientInfo: { name: 'hyperclaw', version: '4.0.0' }, capabilities: {} }
      }) + '\n';

      let responded = false;
      proc.stdout.on('data', (data: Buffer) => {
        if (!responded) {
          responded = true;
          spinner.succeed(`${s.name} is responding`);
          const output = data.toString().trim();
          try {
            const msg = JSON.parse(output);
            if (msg.result?.serverInfo) {
              console.log(chalk.gray(`  Server: ${msg.result.serverInfo.name} v${msg.result.serverInfo.version}`));
            }
          } catch {}
          proc.kill();
        }
      });

      setTimeout(() => {
        if (!responded) {
          spinner.fail(`${s.name} timed out — no response within 3s`);
          proc.kill();
        }
      }, 3000);

      proc.stdin.write(initReq);
    } catch (err: any) {
      spinner.fail(`Failed to spawn ${s.command}: ${err.message}`);
    }
  }

  getEnabled(): MCPServerDef[] {
    return this.servers.filter(s => s.enabled);
  }

  // Generate tools block for AI context
  async generateToolsContext(): Promise<string> {
    const enabled = this.getEnabled();
    if (enabled.length === 0) return '';

    const lines = ['## MCP Tools Available\n'];
    for (const s of enabled) {
      lines.push(`### ${s.name}`);
      if (s.tools && s.tools.length > 0) {
        for (const tool of s.tools) {
          lines.push(`- \`${tool}\``);
        }
      } else {
        lines.push('- (tools not yet discovered — run: hyperclaw mcp test ' + s.id + ')');
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}
