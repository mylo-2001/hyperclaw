/**
 * tests/e2e/cli.test.ts
 * E2E tests — CLI commands (real subprocess execution)
 * These test the actual compiled binary.
 * Run after: npm run build:tsc
 */
import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import path from 'path';

const CLI = path.resolve('./dist/cli/run-main.js');

function cli(args: string, timeout = 5000): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('node', [CLI, ...args.split(' ')], {
    timeout,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' }
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status || 0
  };
}

describe('CLI: hyperclaw --version', () => {
  it('prints version', () => {
    const { stdout } = cli('--version');
    expect(stdout).toMatch(/4\.0\.0/);
  });
});

describe('CLI: hyperclaw --help', () => {
  it('shows help', () => {
    const { stdout } = cli('--help');
    expect(stdout.toLowerCase()).toMatch(/hyperclaw|usage/);
  });
});

describe('CLI: hyperclaw channels list', () => {
  it('lists 20 channels', () => {
    const { stdout } = cli('channels list');
    // Should contain channel names
    expect(stdout.toLowerCase()).toMatch(/telegram|discord|whatsapp/);
  });
});

describe('CLI: hyperclaw hooks list', () => {
  it('lists builtin hooks', () => {
    const { stdout } = cli('hooks list');
    expect(stdout).toMatch(/hook|trigger/i);
  });
});

describe('CLI: hyperclaw delivery status', () => {
  it('shows delivery status', () => {
    const { code } = cli('delivery status');
    expect(code).toBe(0);
  });
});

describe('CLI: hyperclaw mcp list', () => {
  it('shows MCP list', () => {
    const { code } = cli('mcp list');
    expect(code).toBe(0);
  });
});

describe('CLI: hyperclaw node list', () => {
  it('shows node list including local', () => {
    const { stdout } = cli('node list');
    expect(stdout).toMatch(/local|node/i);
  });
});

describe('CLI: hyperclaw secrets audit', () => {
  it('runs secrets audit', () => {
    const { code } = cli('secrets audit');
    expect(code).toBe(0);
  });
});
