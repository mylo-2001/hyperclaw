/**
 * tests/unit/table.test.ts
 * Unit tests for src/terminal/table.ts — pure rendering logic.
 */
import { describe, it, expect } from 'vitest';
import { renderTable } from '../../src/terminal/table';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderTable', () => {
  const rows = [
    { id: 'telegram', name: 'Telegram', status: 'active' },
    { id: 'discord',  name: 'Discord',  status: 'inactive' }
  ];
  const columns = [
    { header: 'Channel', key: 'name' },
    { header: 'Status',  key: 'status' }
  ];

  it('includes header labels (case-insensitive)', () => {
    const out = stripAnsi(renderTable(rows, columns));
    expect(out.toUpperCase()).toContain('CHANNEL');
    expect(out.toUpperCase()).toContain('STATUS');
  });

  it('includes all row values', () => {
    const out = stripAnsi(renderTable(rows, columns));
    expect(out).toContain('Telegram');
    expect(out).toContain('Discord');
    expect(out).toContain('active');
    expect(out).toContain('inactive');
  });

  it('respects custom render function', () => {
    const cols = [
      { header: 'Name', key: 'name', render: (_: unknown, row: Record<string, unknown>) => `[${row.name}]` }
    ];
    const out = stripAnsi(renderTable(rows, cols));
    expect(out).toContain('[Telegram]');
    expect(out).toContain('[Discord]');
  });

  it('renders empty rows without crashing', () => {
    const out = renderTable([], columns);
    expect(typeof out).toBe('string');
  });

  it('right-aligns column content correctly', () => {
    const r = [{ n: 'x' }];
    const c = [{ header: 'N', key: 'n', width: 10, align: 'right' as const }];
    const out = stripAnsi(renderTable(r, c));
    // 'x' should be padded with leading spaces
    expect(out).toMatch(/\s{8}x/);
  });

  it('centers column content correctly', () => {
    const r = [{ n: 'x' }];
    const c = [{ header: 'N', key: 'n', width: 11, align: 'center' as const }];
    const out = stripAnsi(renderTable(r, c));
    // 'x' in center of 11 chars — at least 4 leading spaces
    expect(out).toMatch(/\s{4}x/);
  });

  it('compact mode skips separator line', () => {
    const out = stripAnsi(renderTable(rows, columns, { compact: true }));
    expect(out).not.toContain('─');
  });

  it('non-compact mode includes separator', () => {
    const out = stripAnsi(renderTable(rows, columns, { compact: false }));
    expect(out).toContain('─');
  });

  it('handles missing row values gracefully', () => {
    const partial = [{ id: 'x' }];
    const cols = [{ header: 'Name', key: 'name' }, { header: 'Status', key: 'status' }];
    expect(() => renderTable(partial, cols)).not.toThrow();
  });
});
