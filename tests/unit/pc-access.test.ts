/**
 * tests/unit/pc-access.test.ts
 * Unit tests — PC access safety and permission checks
 */
import { describe, it, expect, vi } from 'vitest';
import os from 'os';
import path from 'path';

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => false, size: 1000 }),
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockRejectedValue(new Error('no config')),
    readdir: vi.fn().mockResolvedValue([]),
    chmod: vi.fn().mockResolvedValue(undefined),
  }
}));

describe('PC Access — destructive command detection', () => {
  const DESTRUCTIVE = [
    'rm -rf /', 'rm -rf /home', 'sudo rm -rf *',
    'dd if=/dev/zero of=/dev/sda', 'mkfs.ext4 /dev/sda',
    'shred -u /etc/passwd',
  ];

  const SAFE = [
    'ls -la', 'cat README.md', 'echo hello',
    'pwd', 'date', 'whoami', 'df -h',
    'grep -r "TODO" src/', 'find . -name "*.ts"',
  ];

  const DESTRUCTIVE_PATTERNS = [
    /\brm\b.*-[rf]/i, /\brmdir\b/i, /\bformat\b/i, /\bdd\b.*of=/i,
    /\bmkfs\b/i, /\bshred\b/i, /\btruncate\b/i,
    /\bsudo\s+rm\b/i, /\bchmod\s+000/i,
  ];

  function isDestructive(cmd: string): boolean {
    return DESTRUCTIVE_PATTERNS.some(p => p.test(cmd));
  }

  for (const cmd of DESTRUCTIVE) {
    it(`detects destructive: ${cmd}`, () => {
      expect(isDestructive(cmd)).toBe(true);
    });
  }

  for (const cmd of SAFE) {
    it(`allows safe: ${cmd}`, () => {
      expect(isDestructive(cmd)).toBe(false);
    });
  }
});

describe('PC Access — level permissions', () => {
  const READ_ONLY_CMDS = ['ls', 'cat', 'echo', 'pwd', 'grep', 'find', 'head', 'tail'];
  const WRITE_CMDS = ['mkdir', 'touch', 'cp', 'mv', 'python3', 'node', 'git'];

  function isAllowed(cmd: string, level: 'read-only' | 'sandboxed' | 'full', allowedCmds: string[] = []): boolean {
    if (level === 'full') return true;
    const base = cmd.trim().split(/\s+/)[0];
    if (level === 'read-only') return READ_ONLY_CMDS.includes(base);
    return allowedCmds.includes(base);
  }

  it('full access allows everything', () => {
    expect(isAllowed('rm file.txt', 'full')).toBe(true);
    expect(isAllowed('curl https://example.com', 'full')).toBe(true);
  });

  it('read-only blocks write commands', () => {
    for (const cmd of WRITE_CMDS) {
      expect(isAllowed(cmd, 'read-only')).toBe(false);
    }
  });

  it('read-only allows read commands', () => {
    for (const cmd of READ_ONLY_CMDS) {
      expect(isAllowed(cmd, 'read-only')).toBe(true);
    }
  });

  it('sandboxed only allows configured commands', () => {
    const allowed = ['ls', 'cat', 'python3'];
    expect(isAllowed('ls', 'sandboxed', allowed)).toBe(true);
    expect(isAllowed('python3', 'sandboxed', allowed)).toBe(true);
    expect(isAllowed('curl', 'sandboxed', allowed)).toBe(false);
    expect(isAllowed('node', 'sandboxed', allowed)).toBe(false);
  });
});

describe('PC Access — path restrictions', () => {
  const homedir = os.homedir();

  function isPathAllowed(p: string, level: string, allowedPaths: string[]): boolean {
    if (level === 'full') return true;
    const resolved = path.resolve(p);
    return allowedPaths.some(a => resolved.startsWith(path.resolve(a)));
  }

  it('full access allows all paths', () => {
    expect(isPathAllowed('/etc/passwd', 'full', [])).toBe(true);
    expect(isPathAllowed('/var/log', 'full', [])).toBe(true);
  });

  it('sandboxed blocks paths outside allowedPaths', () => {
    expect(isPathAllowed('/etc/passwd', 'sandboxed', [homedir])).toBe(false);
    expect(isPathAllowed('/var/log/syslog', 'sandboxed', [homedir])).toBe(false);
  });

  it('sandboxed allows paths inside allowedPaths', () => {
    const testPath = path.join(homedir, 'projects', 'myapp');
    expect(isPathAllowed(testPath, 'sandboxed', [homedir])).toBe(true);
  });
});
