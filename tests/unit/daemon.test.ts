/**
 * tests/unit/daemon.test.ts
 * Unit tests - DaemonManager (status, logs, handle)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFs = {
  pathExists: vi.fn().mockResolvedValue(false),
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
  readJson: vi.fn().mockRejectedValue(new Error('no config')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined)
};

vi.mock('fs-extra', () => ({ default: mockFs }));

vi.mock('../../src/gateway/server', () => ({
  startGateway: vi.fn().mockRejectedValue(new Error('mock')),
  getActiveServer: vi.fn().mockReturnValue(null)
}));

const consoleLogs: string[] = [];
vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
  consoleLogs.push(args.map(String).join(' '));
});

describe('DaemonManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogs.length = 0;
    mockFs.pathExists.mockResolvedValue(false);
    mockFs.readJson.mockRejectedValue(new Error('no config'));
  });

  it('status() when not running shows daemon status', async () => {
    const { DaemonManager } = await import('../../src/infra/daemon');
    const dm = new DaemonManager();
    await dm.status();
    const out = consoleLogs.join('\n');
    expect(out).toContain('HyperClaw Daemon Status');
    expect(out).toContain('Stopped');
  });

  it('status() when running shows Running', async () => {
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readFile.mockResolvedValue(String(process.pid));
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { DaemonManager } = await import('../../src/infra/daemon');
    const dm = new DaemonManager();
    await dm.status();
    const out = consoleLogs.join('\n');
    expect(out).toContain('Running');
    killSpy.mockRestore();
  });

  it('logs() outputs daemon logs', async () => {
    const { DaemonManager } = await import('../../src/infra/daemon');
    const dm = new DaemonManager();
    await dm.logs();
    const out = consoleLogs.join('\n');
    expect(out).toContain('daemon started');
    expect(out).toContain('Daemon ready');
  });

  it('handle(unknown) shows hint', async () => {
    const { DaemonManager } = await import('../../src/infra/daemon');
    const dm = new DaemonManager();
    await dm.handle('foo');
    const out = consoleLogs.join('\n');
    expect(out).toContain('Unknown action');
  });

  it('stop() when no PID calls pathExists', async () => {
    const { DaemonManager } = await import('../../src/infra/daemon');
    const dm = new DaemonManager();
    await dm.stop();
    expect(mockFs.pathExists).toHaveBeenCalled();
  });
});
