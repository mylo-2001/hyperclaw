/**
 * src/cli/progress.ts
 * HyperClaw CLI progress utilities.
 * Mirrors OpenClaw's osc-progress + @clack/prompts approach.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

export type SpinnerResult = Ora;

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

export function log(msg: string): void {
  console.log(chalk.gray(`  ${msg}`));
}

export function info(msg: string): void {
  console.log(chalk.cyan(`  ℹ  ${msg}`));
}

export function success(msg: string): void {
  console.log(chalk.green(`  ✔  ${msg}`));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(`  ⚠  ${msg}`));
}

export function error(msg: string): void {
  console.log(chalk.red(`  ✖  ${msg}`));
}

export function step(n: number, total: number, label: string): void {
  const pct = Math.round((n / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  console.log(chalk.cyan(`  [${bar}] ${pct}% — ${label}`));
}

export function section(title: string): void {
  console.log('\n' + chalk.bold.cyan(`  ── ${title} ──`) + '\n');
}

export function table(rows: [string, string][]): void {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  rows.forEach(([k, v]) => {
    console.log(`  ${chalk.gray(k.padEnd(maxKey + 2))} ${v}`);
  });
}

export function divider(): void {
  console.log(chalk.gray(`  ${'─'.repeat(50)}`));
}
