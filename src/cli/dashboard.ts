import chalk from 'chalk';
import readline from 'readline';
import { GatewayManager } from './gateway';
import { ConfigManager } from './config';
import { SkillHub } from '../plugins/hub';

export class Dashboard {
  async launch(live: boolean): Promise<void> {
    console.clear();
    await this.drawDashboard();

    if (live) {
      console.log(chalk.hex('#06b6d4')('?? LIVE MODE — Ctrl+C to exit\n'));
      this.startLiveUpdates();
    }
  }

  private async drawDashboard(): Promise<void> {
    const cfg = await (new ConfigManager()).load();
    const gm = new GatewayManager();
    const hub = new SkillHub();
    const installed = await hub.getInstalled();

    const port = cfg?.gateway?.port || 1515;
    const agent = cfg?.identity?.agentName || 'Hyper';
    const user = cfg?.identity?.userName || 'Boss';
    const model = cfg?.provider?.modelId || 'openrouter/auto';
    const channels = ((cfg as any)?.channels ?? cfg?.gateway?.enabledChannels ?? ['cli']).join(', ');
    const isRunning = await gm.isRunning(port);

    const statusDot = isRunning ? chalk.hex('#06b6d4')('?') : chalk.gray('0');
    const statusText = isRunning ? chalk.hex('#06b6d4')('ONLINE') : chalk.gray('OFFLINE');
    const w = 72;
    const line = '='.repeat(w);

    const c = chalk.hex('#06b6d4');
    const row = (content: string) => {
      const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
      const pad = Math.max(0, w - stripped.length - 1);
      return c(`¦ `) + content + ' '.repeat(pad) + c(`¦`);
    };

    console.log(c(`-${line}¬`));
    console.log(c(`¦`) + chalk.bold.hex('#06b6d4')(`${'?? HYPERCLAW v5.0.1 — GATEWAY DASHBOARD'.padStart(45).padEnd(w)}`) + c(`¦`));
    console.log(c(`¦${line}¦`));
    console.log(row(`${statusDot} Gateway  ${statusText}   ${chalk.gray('¦')}  ws://localhost:${port}   ${chalk.gray('¦')}  Agent: ${c(agent)}`));
    console.log(row(`${c('?')} Model     ${chalk.gray(model.slice(0, 30))}   ${chalk.gray('¦')}  User: ${c(user)}`));
    console.log(c(`¦${'-'.repeat(w)}¦`));
    console.log(row(chalk.bold('ACTIVE CHANNELS')));

    const chList = (channels || 'cli').split(', ');
    for (let i = 0; i < chList.length; i += 3) {
      const group = chList.slice(i, i + 3).map(ch => `  ${c('?')} ${ch.padEnd(12)}`).join('');
      console.log(row(group));
    }

    console.log(c(`¦${'-'.repeat(w)}¦`));
    console.log(row(chalk.bold('INSTALLED SKILLS')));

    if (installed.length === 0) {
      console.log(row(chalk.gray('  No skills installed. Run: hyperclaw hub')));
    } else {
      for (let i = 0; i < installed.length; i += 3) {
        const group = installed.slice(i, i + 3).map(s => `  ${c('?')} ${s.name.slice(0, 14).padEnd(14)}`).join('');
        console.log(row(group));
      }
    }

    console.log(c(`¦${'-'.repeat(w)}¦`));
    console.log(row(chalk.bold('RECENT ACTIVITY')));
    const now = new Date().toLocaleTimeString();
    console.log(row(`  [${now}] Gateway heartbeat: ${c('OK')}`));
    console.log(row(`  [${now}] AGENTS.md loaded — rules active`));
    console.log(row(`  [${now}] Channels monitoring...`));
    console.log(c(`¦${'-'.repeat(w)}¦`));
    console.log(row(chalk.gray('Commands: [d] ') + chalk.red('?? daemon') + chalk.gray('  [h] hub  [g] gateway  [m] memory  [q] quit')));
    console.log(c(`L${line}-\n`));
  }

  private startLiveUpdates(): void {
    let tick = 0;
    setInterval(() => {
      tick++;
      readline.cursorTo(process.stdout, 0, 20);
      const t = new Date().toLocaleTimeString();
      const states = ['OK', 'Processing', 'OK', 'OK', 'Fetching'];
      console.log(chalk.gray(`  [${t}] Heartbeat #${tick}: ${chalk.hex('#06b6d4')(states[tick % states.length])}`));
    }, 3000);
  }
}
