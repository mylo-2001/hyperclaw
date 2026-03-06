/**
 * src/terminal/table.ts
 * ANSI-safe table renderer for status and data display.
 * Used by `status --all` (read-only/pasteable) and `status --deep` (live probes).
 * Mirrors OpenClaw's src/terminal/table.ts
 */

import { palette } from './palette';

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  render?: (value: unknown, row: Record<string, unknown>) => string;
  align?: 'left' | 'right' | 'center';
}

export interface TableOptions {
  title?: string;
  indent?: number;
  borders?: boolean;
  compact?: boolean;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padStr(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const visLen = stripAnsi(str).length;
  const pad = Math.max(0, width - visLen);
  if (align === 'right') return ' '.repeat(pad) + str;
  if (align === 'center') {
    const half = Math.floor(pad / 2);
    return ' '.repeat(half) + str + ' '.repeat(pad - half);
  }
  return str + ' '.repeat(pad);
}

export function renderTable(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
  opts: TableOptions = {}
): string {
  const indent = ' '.repeat((opts.indent ?? 2));

  // Auto-compute column widths
  const widths = columns.map(col => {
    const headerLen = stripAnsi(col.header).length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = col.render
        ? col.render(row[col.key], row)
        : String(row[col.key] ?? '');
      return Math.max(max, stripAnsi(val).length);
    }, 0);
    return col.width ?? Math.max(headerLen, maxDataLen);
  });

  const lines: string[] = [];

  if (opts.title) {
    lines.push(palette.section(opts.title).trimEnd());
  }

  // Header
  if (!opts.compact) {
    const headerLine = columns
      .map((col, i) => padStr(palette.muted(col.header.toUpperCase()), widths[i], col.align))
      .join('  ');
    lines.push(indent + headerLine);
    lines.push(indent + palette.muted('─'.repeat(widths.reduce((s, w) => s + w + 2, -2))));
  }

  // Data rows
  for (const row of rows) {
    const rowLine = columns
      .map((col, i) => {
        const val = col.render
          ? col.render(row[col.key], row)
          : palette.value(String(row[col.key] ?? ''));
        return padStr(val, widths[i], col.align);
      })
      .join('  ');
    lines.push(indent + rowLine);
  }

  return lines.join('\n');
}

// ─── Pre-built table types ────────────────────────────────────────────────────

export function printKeyValue(pairs: [string, string][], title?: string): void {
  if (title) console.log(palette.section(title));
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  for (const [k, v] of pairs) {
    console.log(`  ${palette.muted(k.padEnd(maxKey + 2))} ${v}`);
  }
  console.log();
}

export function printChannelsTable(channels: Array<{
  id: string; name: string; emoji: string; status: string;
  dmPolicy?: string; configured: boolean;
}>): void {
  console.log(palette.section('CHANNELS'));
  console.log(renderTable(channels, [
    {
      header: 'Channel',
      key: 'name',
      width: 18,
      render: (_, row) => `${row.emoji}  ${row.name}`
    },
    {
      header: 'Status',
      key: 'configured',
      width: 12,
      render: (_, row) => row.configured
        ? `${palette.dot.on} ${palette.ok('active')}`
        : `${palette.dot.off} ${palette.muted('inactive')}`
    },
    {
      header: 'DM Policy',
      key: 'dmPolicy',
      width: 12,
      render: (v) => v ? palette.info(String(v)) : palette.muted('—')
    }
  ]));
  console.log();
}

export function printHooksTable(hooks: Array<{
  id: string; name: string; trigger: string; enabled: boolean; eligible: boolean;
}>): void {
  console.log(palette.section('HOOKS'));
  console.log(renderTable(hooks, [
    {
      header: 'Hook',
      key: 'id',
      width: 22,
      render: (_, row) => `${row.enabled && row.eligible ? palette.dot.on : palette.dot.off} ${row.id}`
    },
    { header: 'Trigger', key: 'trigger', width: 20, render: v => palette.muted(String(v)) },
    {
      header: 'Status',
      key: 'enabled',
      width: 10,
      render: (_, row) => row.eligible
        ? (row.enabled ? palette.ok('enabled') : palette.muted('disabled'))
        : palette.warn('ineligible')
    }
  ]));
  console.log();
}
