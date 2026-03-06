import chalk from 'chalk';
import gradient from 'gradient-string';
import figlet from 'figlet';
import boxen from 'boxen';
import { getTheme } from '../infra/theme';

export class Banner {
  async showNeonBanner(daemonMode = false): Promise<void> {
    console.clear();
    const t = getTheme(daemonMode);

    const icon = daemonMode ? '🩸' : '🦅';
    try {
      const title = figlet.textSync('HYPERCLAW', { font: 'ANSI Shadow' });
      const g = (gradient as any)(t.gradient);
      const lines = title.split('\n');
      const first = lines[0] ?? '';
      console.log(`\n  ${icon} ` + g(first));
      for (let i = 1; i < lines.length; i++) console.log(g('     ' + (lines[i] ?? '')));
    } catch {
      console.log(chalk.bold.red(`\n  ${icon} HYPERCLAW\n`));
    }

    const subtitle = daemonMode
      ? chalk.hex(t.daemonPrimary)('    🩸 DAEMON MODE — ALWAYS WATCHING ⚡\n')
      : t.muted('    🦅 HyperClaw Bot — AI Gateway v4.0.2 ⚡\n');

    console.log(subtitle);

    const boxOpts: any = {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: 'round',
      borderColor: daemonMode ? t.daemonBorderColor : t.borderColor,
    };
    if (t.boxBg) boxOpts.backgroundColor = t.boxBg;

    const box = boxen(
      `${t.a('●')} GATEWAY READY    ` +
      `${t.a('◆')} PROVIDERS: 8    ` +
      `${t.a('⚡')} CHANNELS: 27    ` +
      (daemonMode ? `${t.d('🩸')} DAEMON` : `${t.a('🦅')} HYPERCLAW`),
      boxOpts
    );
    console.log(box);
    console.log(t.muted('  One assistant. All your channels. 🦅\n'));
    const { maybeShowUpdateNotice } = await import('../infra/update-check');
    maybeShowUpdateNotice(daemonMode);
  }

  async showMiniBanner(): Promise<void> {
    await this.showNeonBanner(false);
  }

  async showWizardBanner(): Promise<void> {
    console.clear();
    const t = getTheme(false);
    const g = (gradient as any)(t.gradient);
    try {
      const title = figlet.textSync('HYPERCLAW', { font: 'ANSI Shadow' });
      const lines = title.split('\n');
      const first = lines[0] ?? '';
      console.log('\n  🦅 ' + g(first));
      for (let i = 1; i < lines.length; i++) console.log(g('     ' + (lines[i] ?? '')));
    } catch {
      console.log(t.bold('\n  🦅 HYPERCLAW\n'));
    }
    console.log(t.muted('    🦅 HyperClaw Bot — AI Gateway • SETUP WIZARD v4.0.2 ⚡\n'));

    const boxOpts: any = {
      padding: 1,
      margin: { bottom: 1 },
      borderStyle: 'round',
      borderColor: t.borderColor,
    };
    if (t.boxBg) boxOpts.backgroundColor = t.boxBg;

    const box = boxen(
      t.a('◆') + ' Provider • Channels • Gateway • Identity',
      boxOpts
    );
    console.log(box);
  }

  async showStatus(): Promise<void> {
    const t = getTheme(false);
    const { ConfigManager } = await import('../config/manager');
    const { GatewayManager } = await import('../gateway/manager');
    const cfg = await (new ConfigManager()).load();
    const gm = new GatewayManager();
    const port = cfg?.gateway?.port ?? 18789;
    const running = await gm.isRunning(port);
    console.log(t.bold('\n  🦅 HYPERCLAW STATUS\n'));
    console.log(`  Gateway: ${running ? t.success('● running') : t.error('○ stopped')}  port ${port}`);
    console.log(`  Provider: ${t.c(cfg?.provider?.providerId ?? 'none')}`);
    console.log(`  Channels: ${t.c(String((cfg?.channels ?? []).length))}`);
    console.log();
  }
}
