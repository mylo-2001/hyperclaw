import inquirer from 'inquirer';
import chalk from 'chalk';
import boxen from 'boxen';

export type DMPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';

export interface DMPolicyConfig {
  policy: DMPolicy;
  allowFrom?: string[];
  pairingCode?: string;
}

const DISCLAIMER_TEXT = `
  A bad prompt can trick your AI agent into doing unsafe things.
  By continuing, you acknowledge the following risks:

  ${chalk.yellow('•')} ${chalk.white('Prompt injection:')} Malicious users may try to override your agent's behavior
  ${chalk.yellow('•')} ${chalk.white('Channel pairing:')} Use allowlists to restrict who can DM your agent
  ${chalk.yellow('•')} ${chalk.white('Sandbox & least privilege:')} Only enable skills your agent actually needs
  ${chalk.yellow('•')} ${chalk.white('Keep secrets out:')} Never put API keys in prompts or messages
  ${chalk.yellow('•')} ${chalk.white('Use strongest model:')} Capable models are harder to jailbreak
  ${chalk.yellow('•')} ${chalk.white('Gateway auth token:')} Always set a strong token — never leave it blank

  This software is ${chalk.bold('inherently powerful and inherently risky')}.
  You are responsible for how your agent behaves.
`;

export async function showSecurityDisclaimer(): Promise<boolean> {
  console.clear();
  console.log(chalk.red.bold('\n  ⚠️  SECURITY DISCLAIMER\n'));
  console.log(boxen(DISCLAIMER_TEXT, {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'red',
    backgroundColor: '#0a0a0a'
  }));

  const { understood } = await inquirer.prompt([{
    type: 'confirm',
    name: 'understood',
    message: chalk.yellow('I understand this is powerful and inherently risky. Continue?'),
    default: false
  }]);

  if (!understood) {
    console.log(chalk.gray('\nSetup cancelled. Come back when you\'re ready.\n'));
    return false;
  }

  return true;
}

export async function configureDMPolicy(channelName: string): Promise<DMPolicyConfig> {
  console.log(chalk.cyan(`\n  📨 DM Policy for ${channelName}\n`));
  console.log(chalk.gray('  Who is allowed to send direct messages to your agent?\n'));

  const { policy } = await inquirer.prompt([{
    type: 'list',
    name: 'policy',
    message: 'DM access policy:',
    choices: [
      {
        name: `${chalk.yellow('Pairing')}         — Users must send a pairing code first ${chalk.gray('(Recommended)')}`,
        value: 'pairing'
      },
      {
        name: `${chalk.cyan('Allowlist')}       — Only specific users/IDs can DM`,
        value: 'allowlist'
      },
      {
        name: `${chalk.green('Open')}            — Anyone can DM ${chalk.red('(Not recommended for public bots)')}`,
        value: 'open'
      },
      {
        name: `${chalk.gray('Disabled')}        — No DMs allowed`,
        value: 'disabled'
      }
    ]
  }]);

  const config: DMPolicyConfig = { policy };

  if (policy === 'pairing') {
    const crypto = await import('crypto');
    config.pairingCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    console.log(chalk.green(`\n  ✅ Pairing code generated: ${chalk.bold(config.pairingCode)}`));
    console.log(chalk.gray(`  Users must DM /pair ${config.pairingCode} to unlock access\n`));
  }

  if (policy === 'allowlist') {
    const { allowFrom } = await inquirer.prompt([{
      type: 'input',
      name: 'allowFrom',
      message: 'Enter allowed user IDs (comma-separated):',
      hint: 'e.g. @username, 123456789'
    }]);
    config.allowFrom = allowFrom.split(',').map((s: string) => s.trim()).filter(Boolean);
    console.log(chalk.gray(`\n  Docs: https://docs.hyperclaw.ai/channels/${channelName}/allowlist\n`));
  }

  return config;
}

export function dmPolicyBadge(policy: DMPolicy): string {
  return {
    'pairing': chalk.yellow('🔑 Pairing'),
    'allowlist': chalk.cyan('📋 Allowlist'),
    'open': chalk.green('🔓 Open'),
    'disabled': chalk.gray('🚫 Disabled')
  }[policy];
}
