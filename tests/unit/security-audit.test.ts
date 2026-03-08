/**
 * tests/unit/security-audit.test.ts
 * Unit tests — security audit check logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs-extra — no real filesystem access during tests
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue({ mode: 0o100600 }),
    readJson: vi.fn().mockRejectedValue(new Error('no file')),
    readFile: vi.fn().mockResolvedValue(''),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
  }
}));

import { runSecurityAudit } from '../../src/security/audit';
import fs from 'fs-extra';

describe('Security Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no files exist, no config
    vi.mocked(fs.pathExists).mockResolvedValue(false as any);
    vi.mocked(fs.readJson).mockRejectedValue(new Error('no file'));
    vi.mocked(fs.readFile).mockResolvedValue('' as any);
    vi.mocked(fs.stat).mockResolvedValue({ mode: 0o100600 } as any);
  });

  it('runs without throwing in standard mode', async () => {
    await expect(runSecurityAudit({})).resolves.not.toThrow();
  });

  it('runs without throwing in deep mode', async () => {
    await expect(runSecurityAudit({ deep: true })).resolves.not.toThrow();
  });

  it('outputs JSON when json=true', async () => {
    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    await runSecurityAudit({ json: true });

    process.stdout.write = origWrite;
    const combined = output.join('');
    const parsed = JSON.parse(combined);
    expect(parsed).toHaveProperty('findings');
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('total');
    expect(Array.isArray(parsed.findings)).toBe(true);
  });

  it('JSON output findings have required fields', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });
    // Make a finding appear: no auth token
    vi.mocked(fs.readJson).mockResolvedValue({
      gateway: { authToken: '' }
    } as any);

    await runSecurityAudit({ json: true });

    const parsed = JSON.parse(output.join(''));
    if (parsed.findings.length > 0) {
      const f = parsed.findings[0];
      expect(f).toHaveProperty('checkId');
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('title');
      expect(f).toHaveProperty('remediation');
    }
  });

  it('detects missing gateway auth token as critical', async () => {
    vi.mocked(fs.readJson).mockResolvedValue({
      gateway: {}
    } as any);

    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    await runSecurityAudit({ json: true });
    const parsed = JSON.parse(output.join(''));
    const authFinding = parsed.findings.find((f: any) => f.checkId === 'gateway-auth-missing');
    expect(authFinding).toBeDefined();
    expect(authFinding.severity).toBe('critical');
  });

  it('detects open DM policy as high', async () => {
    vi.mocked(fs.readJson).mockResolvedValue({
      gateway: { authToken: 'a'.repeat(32) },
      channelConfigs: {
        telegram: { dmPolicy: 'open' }
      }
    } as any);

    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    await runSecurityAudit({ json: true });
    const parsed = JSON.parse(output.join(''));
    const dmFinding = parsed.findings.find((f: any) => f.checkId?.startsWith('dm-policy-open'));
    expect(dmFinding).toBeDefined();
    expect(dmFinding.severity).toBe('high');
  });

  it('detects short auth token as high', async () => {
    vi.mocked(fs.readJson).mockResolvedValue({
      gateway: { authToken: 'short' }
    } as any);

    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    await runSecurityAudit({ json: true });
    const parsed = JSON.parse(output.join(''));
    const tokenFinding = parsed.findings.find((f: any) => f.checkId === 'auth-token-strength');
    expect(tokenFinding).toBeDefined();
    expect(tokenFinding.severity).toBe('high');
  });

  it('no critical findings when config is hardened', async () => {
    vi.mocked(fs.readJson).mockResolvedValue({
      gateway: {
        bind: '127.0.0.1',
        authToken: 'a'.repeat(40),
        trustedProxies: []
      },
      session: { dmScope: 'per-channel-peer' },
      channels: {
        telegram: { dmPolicy: 'pairing' }
      }
    } as any);

    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(String(chunk));
      return true;
    });

    await runSecurityAudit({ json: true });
    const parsed = JSON.parse(output.join(''));
    const criticals = parsed.findings.filter((f: any) => f.severity === 'critical');
    expect(criticals).toHaveLength(0);
  });
});
