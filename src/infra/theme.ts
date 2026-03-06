/**
 * src/infra/theme.ts
 * HyperClaw CLI color theme system.
 *
 * Three themes (all with cyan #06b6d4 as primary):
 *   dark   — black background, neon cyan, high contrast (default)
 *   grey   — neutral grey tones, muted cyan, professional
 *   white  — bright/light style, deep cyan, readable on light terminals
 *
 * Daemon mode: replaces cyan accent with red (#dc2626) in any theme.
 *
 * Storage: ~/.hyperclaw/theme.json  → { name: 'dark' | 'grey' | 'white' }
 */

import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

export type ThemeName = 'dark' | 'grey' | 'white';

export interface ThemePalette {
  /** Human label shown in CLI */
  label: string;
  /** Primary brand accent hex */
  primary: string;
  /** Lighter variant for gradients */
  primaryLight: string;
  /** Softest variant for triple-stop gradients */
  primaryXLight: string;
  /** Daemon accent hex (replaces primary in daemon mode) */
  daemonPrimary: string;
  /** Box border color name for boxen */
  borderColor: string;
  /** Daemon box border color for boxen */
  daemonBorderColor: string;
  /** Box background for boxen ('' = no bg) */
  boxBg: string;
  /** Gradient stops for ASCII banner */
  gradient: string[];
  /** Daemon gradient stops */
  daemonGradient: string[];
  /** Secondary text style fn */
  secondary: (s: string) => string;
  /** Muted text style fn */
  muted: (s: string) => string;
  /** Success text style fn */
  success: (s: string) => string;
  /** Warning text style fn */
  warning: (s: string) => string;
  /** Error text style fn */
  error: (s: string) => string;
}

// ── Theme definitions ─────────────────────────────────────────────────────────

const THEMES: Record<ThemeName, ThemePalette> = {
  dark: {
    label: 'Dark Professional (default)',
    primary: '#06b6d4',
    primaryLight: '#22d3ee',
    primaryXLight: '#67e8f9',
    daemonPrimary: '#dc2626',
    borderColor: 'cyan',
    daemonBorderColor: 'red',
    boxBg: '#0a0a0a',
    gradient: ['#06b6d4', '#22d3ee', '#67e8f9'],
    daemonGradient: ['#dc2626', '#ef4444', '#fca5a5'],
    secondary: (s) => chalk.white(s),
    muted: (s) => chalk.gray(s),
    success: (s) => chalk.green(s),
    warning: (s) => chalk.yellow(s),
    error: (s) => chalk.red(s),
  },

  grey: {
    label: 'Grey Professional',
    primary: '#06b6d4',
    primaryLight: '#22d3ee',
    primaryXLight: '#a5f3fc',
    daemonPrimary: '#dc2626',
    borderColor: 'gray',
    daemonBorderColor: 'red',
    boxBg: '',
    gradient: ['#64748b', '#06b6d4', '#22d3ee'],
    daemonGradient: ['#6b7280', '#dc2626', '#ef4444'],
    secondary: (s) => chalk.hex('#d1d5db')(s),
    muted: (s) => chalk.hex('#6b7280')(s),
    success: (s) => chalk.hex('#10b981')(s),
    warning: (s) => chalk.hex('#f59e0b')(s),
    error: (s) => chalk.hex('#ef4444')(s),
  },

  white: {
    label: 'White / Light Professional',
    primary: '#0284c7',        // darker cyan — visible on light bg
    primaryLight: '#0ea5e9',
    primaryXLight: '#38bdf8',
    daemonPrimary: '#b91c1c',
    borderColor: 'blue',
    daemonBorderColor: 'red',
    boxBg: '',
    gradient: ['#0369a1', '#0284c7', '#0ea5e9'],
    daemonGradient: ['#991b1b', '#b91c1c', '#dc2626'],
    secondary: (s) => chalk.black(s),
    muted: (s) => chalk.hex('#374151')(s),
    success: (s) => chalk.hex('#065f46')(s),
    warning: (s) => chalk.hex('#92400e')(s),
    error: (s) => chalk.hex('#991b1b')(s),
  },
};

// ── Persistence ───────────────────────────────────────────────────────────────

const THEME_FILE = path.join(os.homedir(), '.hyperclaw', 'theme.json');

let _cached: ThemeName | null = null;

export function getThemeName(): ThemeName {
  if (_cached) return _cached;
  try {
    const raw = fs.readJsonSync(THEME_FILE) as { name?: string };
    if (raw?.name && raw.name in THEMES) {
      _cached = raw.name as ThemeName;
      return _cached;
    }
  } catch { /* default */ }
  return 'dark';
}

export async function setThemeName(name: ThemeName): Promise<void> {
  await fs.ensureDir(path.dirname(THEME_FILE));
  await fs.writeJson(THEME_FILE, { name }, { spaces: 2 });
  _cached = name;
}

// ── Active palette ────────────────────────────────────────────────────────────

export function getTheme(daemon = false): ThemePalette & {
  /** chalk fn for primary accent */
  c: (s: string) => string;
  /** chalk fn for daemon accent (red) */
  d: (s: string) => string;
  /** chalk fn for active accent (primary or daemon) */
  a: (s: string) => string;
  /** chalk.bold + active accent */
  bold: (s: string) => string;
} {
  const t = THEMES[getThemeName()];
  const c = (s: string) => chalk.hex(t.primary)(s);
  const d = (s: string) => chalk.hex(t.daemonPrimary)(s);
  const a = daemon ? d : c;
  return {
    ...t,
    c,
    d,
    a,
    bold: (s: string) => chalk.bold.hex(daemon ? t.daemonPrimary : t.primary)(s),
  };
}

// ── Convenience re-exports ────────────────────────────────────────────────────

/** Returns chalk fn for primary color (non-daemon). */
export function primary(): (s: string) => string {
  return (s) => chalk.hex(THEMES[getThemeName()].primary)(s);
}

export function allThemes(): Array<{ name: ThemeName; label: string }> {
  return (Object.entries(THEMES) as [ThemeName, ThemePalette][]).map(([name, t]) => ({
    name,
    label: t.label,
  }));
}
