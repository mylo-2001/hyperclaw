/**
 * src/routing/agents-routing.ts
 * Multi-agent routing — channel → agent bindings.
 * Mirrors OpenClaw's openclaw agents bindings / bind / unbind.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';

export interface AgentBinding {
  channelId: string;
  accountId?: string;
  agentWorkspace: string;
  role: 'primary' | 'secondary';
  createdAt: string;
}

export interface AgentDef {
  workspace: string;
  name: string;
  model?: string;
  bindings: AgentBinding[];
}

export class AgentRouter {
  private stateFile: string;
  private agents: AgentDef[] = [];

  constructor() {
    this.stateFile = path.join(os.homedir(), '.hyperclaw', 'agents.json');
    this.load();
  }

  private load(): void {
    try {
      this.agents = fs.readJsonSync(this.stateFile);
    } catch {
      this.agents = [{
        workspace: path.join(os.homedir(), '.hyperclaw', 'workspace'),
        name: 'default',
        model: undefined,
        bindings: []
      }];
    }
  }

  private save(): void {
    fs.ensureDirSync(path.dirname(this.stateFile));
    fs.writeJsonSync(this.stateFile, this.agents, { spaces: 2 });
  }

  listBindings(): void {
    console.log(chalk.bold.cyan('\n  🦅 AGENT BINDINGS\n'));

    if (this.agents.length === 0) {
      console.log(chalk.gray('  No agents configured.'));
      return;
    }

    for (const agent of this.agents) {
      console.log(`  ${chalk.bold(agent.name)}  ${chalk.gray(agent.workspace)}`);

      if (agent.bindings.length === 0) {
        console.log(`    ${chalk.gray('No channel bindings — receives from all channels')}`);
      } else {
        for (const b of agent.bindings) {
          const acct = b.accountId ? chalk.gray(`@${b.accountId}`) : chalk.gray('(all accounts)');
          const role = b.role === 'primary' ? chalk.green('[primary]') : chalk.gray('[secondary]');
          console.log(`    ${chalk.cyan(b.channelId)} ${acct} ${role}`);
        }
      }
      console.log();
    }
  }

  async bind(): Promise<void> {
    console.log(chalk.cyan('\n  Bind a channel to an agent workspace\n'));

    const { channel, workspace, role } = await inquirer.prompt([
      {
        type: 'input',
        name: 'channel',
        message: 'Channel ID (e.g. telegram, discord, slack):',
        validate: (v: string) => v.trim().length > 0 || 'Required'
      },
      {
        type: 'input',
        name: 'workspace',
        message: 'Agent workspace (directory or name):',
        default: 'default'
      },
      {
        type: 'list',
        name: 'role',
        message: 'Binding role:',
        choices: [
          { name: 'primary — routes all traffic from this channel', value: 'primary' },
          { name: 'secondary — fallback if primary is busy', value: 'secondary' }
        ]
      }
    ]);

    let agent = this.agents.find(a => a.name === workspace || a.workspace === workspace);
    if (!agent) {
      agent = { workspace, name: workspace, bindings: [] };
      this.agents.push(agent);
    }

    agent.bindings.push({
      channelId: channel,
      agentWorkspace: agent.workspace,
      role,
      createdAt: new Date().toISOString()
    });

    this.save();
    console.log(chalk.green(`\n  ✔  Bound ${channel} → ${workspace} (${role})\n`));
  }

  async unbind(): Promise<void> {
    const allBindings: Array<{ agent: string; channel: string }> = [];

    for (const agent of this.agents) {
      for (const b of agent.bindings) {
        allBindings.push({ agent: agent.name, channel: b.channelId });
      }
    }

    if (allBindings.length === 0) {
      console.log(chalk.gray('\n  No bindings to remove.\n'));
      return;
    }

    const { toRemove } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'toRemove',
      message: 'Select bindings to remove:',
      choices: allBindings.map(b => ({
        name: `${b.channel} → ${b.agent}`,
        value: b
      }))
    }]);

    for (const { agent: agentName, channel } of toRemove) {
      const agent = this.agents.find(a => a.name === agentName);
      if (agent) {
        agent.bindings = agent.bindings.filter(b => b.channelId !== channel);
      }
    }

    this.save();
    console.log(chalk.green(`\n  ✔  Removed ${toRemove.length} binding(s)\n`));
  }
}
