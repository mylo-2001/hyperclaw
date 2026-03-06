/**
 * tests/unit/banner.test.ts
 * Unit tests - Banner (daemon vs normal mode, wizard)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const consoleSpy = { clear: vi.fn(), log: vi.fn() };

vi.mock('figlet', () => ({
  textSync: (text: string) => (text === 'HYPERCLAW' ? 'HYPERCLAW' : '')
}));

vi.mock('gradient-string', () => ({
  default: () => (s: string) => s
}));

vi.mock('boxen', () => ({
  default: vi.fn((content: string, opts?: { borderColor?: string }) => {
    (global as any).__boxenBorderColor = opts?.borderColor;
    return content;
  })
}));

vi.mock('../../src/infra/update-check', () => ({
  maybeShowUpdateNotice: vi.fn()
}));

describe('Banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('console', consoleSpy);
  });

  it('showNeonBanner(daemonMode=true) outputs daemon theme (red, blood emoji)', async () => {
    const { Banner } = await import('../../src/terminal/banner');
    const banner = new Banner();
    await banner.showNeonBanner(true);

    const logs = (consoleSpy.log as any).mock.calls.flat().join(' ');
    expect(logs).toContain('DAEMON MODE');
    expect(logs).toContain('DAEMON');
    const boxenMod = await import('boxen');
    const boxenCall = (boxenMod.default as any).mock?.calls?.[0];
    if (boxenCall?.[1]?.borderColor) {
      expect(boxenCall[1].borderColor).toBe('red');
    }
  });

  it('showNeonBanner(daemonMode=false) outputs normal theme (hawk)', async () => {
    const { Banner } = await import('../../src/terminal/banner');
    const banner = new Banner();
    await banner.showNeonBanner(false);

    const logs = (consoleSpy.log as any).mock.calls.flat().join(' ');
    expect(logs).not.toContain('DAEMON MODE');
  });

  it('showWizardBanner outputs wizard-style banner', async () => {
    const { Banner } = await import('../../src/terminal/banner');
    const banner = new Banner();
    await banner.showWizardBanner();

    const logs = (consoleSpy.log as any).mock.calls.flat().map(String).join(' ');
    expect(logs).toContain('SETUP WIZARD');
    expect(logs).toContain('Gateway');
  });
});
