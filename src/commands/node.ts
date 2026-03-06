/**
 * src/commands/node.ts
 * `hyperclaw node` — manage HyperClaw Node capabilities.
 * A "node" is a remote or local compute endpoint that can run
 * agent tasks, execute code, or host channel connections.
 *
 * Types: local | remote | android | raspberrypi | docker
 * Matches OpenClaw's `openclaw node` pattern.
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';

const NODES_FILE = path.join(os.homedir(), '.hyperclaw', 'nodes.json');

export type NodeType = 'local' | 'remote' | 'android' | 'raspberrypi' | 'docker' | 'vm';
export type NodeStatus = 'online' | 'offline' | 'unknown' | 'degraded';

export interface HyperClawNode {
  id: string;
  name: string;
  type: NodeType;
  host?: string;           // hostname or IP for remote nodes
  port?: number;           // gateway port on remote node
  sshUser?: string;        // for remote nodes
  androidDeviceId?: string; // adb device id for android nodes
  capabilities: NodeCapability[];
  authToken?: string;
  status: NodeStatus;
  addedAt: string;
  lastSeenAt?: string;
  version?: string;
}

export type NodeCapability =
  | 'agent:run'       // can run AI agent inference
  | 'channel:host'    // can host channel connections
  | 'code:execute'    // can execute code in sandbox
  | 'file:access'     // has file system access
  | 'gpu'             // has GPU acceleration
  | 'always-on';      // runs 24/7

async function loadNodes(): Promise<HyperClawNode[]> {
  try { return await fs.readJson(NODES_FILE); }
  catch { return []; }
}

async function saveNodes(nodes: HyperClawNode[]): Promise<void> {
  await fs.ensureDir(path.dirname(NODES_FILE));
  await fs.writeJson(NODES_FILE, nodes, { spaces: 2 });
}

const TYPE_EMOJI: Record<NodeType, string> = {
  local: '💻', remote: '🖥️', android: '📱', raspberrypi: '🍓', docker: '🐳', vm: '☁️'
};

const STATUS_COLOR: Record<NodeStatus, (s: string) => string> = {
  online:   chalk.green,
  offline:  chalk.red,
  unknown:  chalk.gray,
  degraded: chalk.yellow,
};

export async function nodeList(): Promise<void> {
  const nodes = await loadNodes();
  console.log(chalk.bold.cyan('\n  🖧  HYPERCLAW NODES\n'));

  // Always show local node
  console.log(`  ${chalk.green('●')} ${chalk.white('Local (this machine)'.padEnd(22))} ${chalk.cyan('[local]')}  ${chalk.green('online')}`);
  console.log(`    ${chalk.gray(`Node.js ${process.version}  ${os.platform()} ${os.arch()}  port 18789`)}`);
  console.log();

  if (nodes.length === 0) {
    console.log(chalk.gray('  No additional nodes registered.'));
    console.log(chalk.gray('  Add a remote node: hyperclaw node add\n'));
    return;
  }

  for (const node of nodes) {
    const dot = STATUS_COLOR[node.status]('●');
    const emoji = TYPE_EMOJI[node.type];
    const status = STATUS_COLOR[node.status](node.status);
    console.log(`  ${dot} ${chalk.white(node.name.padEnd(22))} ${chalk.cyan(`[${node.type}]`)}  ${status}`);
    if (node.host) console.log(`    ${chalk.gray(`${node.host}:${node.port || 18789}`)}`);
    if (node.androidDeviceId) console.log(`    ${chalk.gray(`adb: ${node.androidDeviceId}`)}`);
    if (node.capabilities.length > 0) {
      console.log(`    ${chalk.gray('caps:')} ${node.capabilities.join(', ')}`);
    }
    if (node.lastSeenAt) {
      const ago = Math.round((Date.now() - new Date(node.lastSeenAt).getTime()) / 1000 / 60);
      console.log(`    ${chalk.gray(`last seen: ${ago}m ago`)}`);
    }
    console.log();
  }
}

export async function nodeAdd(): Promise<void> {
  console.log(chalk.bold.cyan('\n  ➕ ADD NODE\n'));

  const { type } = await inquirer.prompt([{
    type: 'list', name: 'type', message: 'Node type:',
    choices: [
      { name: '🖥️  Remote server (SSH)', value: 'remote' },
      { name: '📱  Android device (ADB)', value: 'android' },
      { name: '🍓  Raspberry Pi', value: 'raspberrypi' },
      { name: '🐳  Docker container', value: 'docker' },
      { name: '☁️  VM / cloud instance', value: 'vm' },
    ]
  }]);

  const { name } = await inquirer.prompt([{
    type: 'input', name: 'name', message: 'Node name:', validate: v => !!v.trim() || 'Required'
  }]);

  let extras: Partial<HyperClawNode> = {};

  if (type === 'android') {
    const { deviceId } = await inquirer.prompt([{
      type: 'input', name: 'deviceId',
      message: 'ADB device ID (run: adb devices):',
      validate: v => !!v.trim() || 'Required'
    }]);
    extras.androidDeviceId = deviceId;
    extras.capabilities = ['channel:host', 'always-on'];
  } else {
    const { host, port } = await inquirer.prompt([
      { type: 'input', name: 'host', message: 'Hostname or IP:', validate: v => !!v.trim() || 'Required' },
      { type: 'number', name: 'port', message: 'Gateway port:', default: 18789 }
    ]);
    const { caps } = await inquirer.prompt([{
      type: 'checkbox', name: 'caps', message: 'Capabilities:',
      choices: [
        { name: 'Run agent inference', value: 'agent:run', checked: true },
        { name: 'Host channel connections', value: 'channel:host' },
        { name: 'Execute code', value: 'code:execute' },
        { name: 'GPU acceleration', value: 'gpu' },
        { name: 'Always-on (24/7)', value: 'always-on' },
      ]
    }]);
    extras = { host, port, capabilities: caps };
  }

  const node: HyperClawNode = {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    type: type as NodeType,
    status: 'unknown',
    addedAt: new Date().toISOString(),
    capabilities: extras.capabilities || [],
    ...extras
  };

  const nodes = await loadNodes();
  nodes.push(node);
  await saveNodes(nodes);

  console.log(chalk.green(`\n  ✔  Node added: ${name}`));
  console.log(chalk.gray('  Run: hyperclaw node probe   to test the connection\n'));
}

export async function nodeProbe(id?: string): Promise<void> {
  const nodes = await loadNodes();
  const targets = id ? nodes.filter(n => n.id === id) : nodes;

  console.log(chalk.bold.cyan('\n  🔍 PROBING NODES\n'));

  // Always probe local
  console.log(`  ${chalk.cyan('○')} Local...`);
  await new Promise(r => setTimeout(r, 300));
  console.log(`  ${chalk.green('✔')} Local — online (${os.platform()} ${os.arch()})\n`);

  for (const node of targets) {
    const spinner = ora(`  Probing ${node.name} (${node.host || node.androidDeviceId || node.type})...`).start();
    await new Promise(r => setTimeout(r, 1000));

    try {
      if (node.host) {
        const axios = (await import('axios')).default;
        const res = await axios.get(`http://${node.host}:${node.port || 18789}/api/status`, { timeout: 3000 });
        node.status = 'online';
        node.version = res.data?.version;
        node.lastSeenAt = new Date().toISOString();
        spinner.succeed(`${node.name} — online${node.version ? ` (v${node.version})` : ''}`);
      } else if (node.type === 'android') {
        // Check via ADB
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(`adb -s ${node.androidDeviceId} shell echo ok`);
        node.status = 'online';
        node.lastSeenAt = new Date().toISOString();
        spinner.succeed(`${node.name} — online (ADB connected)`);
      } else {
        node.status = 'unknown';
        spinner.warn(`${node.name} — probe not supported for ${node.type}`);
      }
    } catch {
      node.status = 'offline';
      spinner.fail(`${node.name} — offline / unreachable`);
    }

    console.log();
  }

  await saveNodes(nodes);
}

export async function nodeRemove(id: string): Promise<void> {
  const nodes = await loadNodes();
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) { console.log(chalk.red(`\n  ✖  Node not found: ${id}\n`)); return; }
  nodes.splice(idx, 1);
  await saveNodes(nodes);
  console.log(chalk.green(`\n  ✔  Node removed: ${id}\n`));
}
