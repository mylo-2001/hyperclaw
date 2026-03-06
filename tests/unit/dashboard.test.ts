/**
 * tests/unit/dashboard.test.ts
 * Unit tests - Dashboard (daemon command shown)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/cli/gateway', () => ({
  GatewayManager: vi.fn().mockImplementation(() => ({
    isRunning: vi.fn().mockResolvedValue(true)
  }))
}));

vi.mock('../../src/cli/config', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      gateway: { port: 1515, enabledChannels: ['telegram', 'discord'] },
      identity: { agentName: 'TestAgent', userName: 'User' },
      provider: { modelId: 'openrouter/auto' }
    })
  }))
}));

vi.mock('../../src/plugins/hub', () => ({
  SkillHub: vi.fn().mockImplementation(() => ({
    getInstalled: vi.fn().mockReturnValue([{ name: 'translator' }])
  }))
}));

const consoleLogs: string[] = [];
vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
  consoleLogs.push(args.map(String).join(' '));
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogs.length = 0;
  });

  it('launch includes daemon command', async () => {
    const { Dashboard } = await import('../../src/cli/dashboard');
    const dashboard = new Dashboard();
    await dashboard.launch(false);

    const out = consoleLogs.join('\n');
    expect(out).toContain('daemon');
    expect(out).toContain('hub');
    expect(out).toContain('gateway');
  });

  it('launch shows HYPERCLAW and port', async () => {
    const { Dashboard } = await import('../../src/cli/dashboard');
    const dashboard = new Dashboard();
    await dashboard.launch(false);

    const out = consoleLogs.join('\n');
    expect(out).toContain('HYPERCLAW');
    expect(out).toContain('DASHBOARD');
    expect(out).toContain('1515');
  });
});
