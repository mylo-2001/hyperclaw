/**
 * src/terminal/palette.ts
 * HyperClaw shared CLI color palette.
 * ALL terminal output uses this — no hardcoded colors elsewhere.
 * Mirrors OpenClaw's src/terminal/palette.ts
 */

import chalk from 'chalk';

export const palette = {
  // Brand
  brand:    chalk.cyan,
  brandBg:  chalk.bgCyan.black,
  lobster:  chalk.bold.red,

  // Status
  ok:       chalk.green,
  warn:     chalk.yellow,
  error:    chalk.red,
  info:     chalk.cyan,
  muted:    chalk.gray,

  // Severity badges
  critical: chalk.bgRed.white.bold,
  high:     chalk.red.bold,
  medium:   chalk.yellow,
  low:      chalk.cyan,

  // Badges
  badge: (text: string, color: (s: string) => string = chalk.cyan) =>
    color(` ${text} `),

  ok_badge: (text: string) => chalk.bgGreen.black(` ${text} `),
  warn_badge: (text: string) => chalk.bgYellow.black(` ${text} `),
  err_badge: (text: string) => chalk.bgRed.white(` ${text} `),

  // Semantic
  key:   chalk.white.bold,
  value: chalk.gray,
  cmd:   chalk.cyan.bold,
  path:  chalk.blue,
  url:   chalk.underline.cyan,

  // Channel/provider
  channel:  (name: string) => chalk.cyan(`[${name}]`),
  provider: (name: string) => chalk.magenta(`[${name}]`),
  model:    (name: string) => chalk.blue(name),
  version:  (v: string) => chalk.gray(`v${v}`),

  // Dots
  dot: {
    on:      chalk.green('●'),
    off:     chalk.gray('○'),
    warn:    chalk.yellow('◆'),
    err:     chalk.red('✖'),
    ok:      chalk.green('✔'),
    info:    chalk.cyan('ℹ'),
    arrow:   chalk.cyan('→'),
  },

  // Separators
  divider: () => chalk.gray('─'.repeat(52)),
  section: (title: string) => chalk.bold.cyan(`\n  ── ${title} ──\n`),

  // For tables: ANSI-safe padding
  cell: (text: string, width: number) => {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - clean.length);
    return text + ' '.repeat(pad);
  }
};

export default palette;
