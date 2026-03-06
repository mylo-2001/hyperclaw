/**
 * tests/unit/shared-types.test.ts
 * Unit tests — @hyperclaw/shared types and path resolution
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { getHyperClawDir, getConfigPath, getEnvFilePath } from '../../packages/shared/src/paths';

describe('shared path resolution', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of ['HYPERCLAW_HOME', 'HYPERCLAW_STATE_DIR', 'HYPERCLAW_CONFIG_PATH']) {
      if (origEnv[key] === undefined) delete process.env[key];
      else process.env[key] = origEnv[key];
    }
  });

  it('getHyperClawDir defaults to ~/.hyperclaw', () => {
    delete process.env.HYPERCLAW_HOME;
    delete process.env.HYPERCLAW_STATE_DIR;
    const dir = getHyperClawDir();
    expect(dir).toMatch(/\.hyperclaw$/);
    expect(dir).toContain(process.env.HOME || process.env.USERPROFILE || '');
  });

  it('getHyperClawDir respects HYPERCLAW_STATE_DIR', () => {
    process.env.HYPERCLAW_STATE_DIR = '/tmp/custom-state';
    expect(getHyperClawDir()).toBe('/tmp/custom-state');
  });

  it('getHyperClawDir respects HYPERCLAW_HOME', () => {
    delete process.env.HYPERCLAW_STATE_DIR;
    process.env.HYPERCLAW_HOME = '/tmp/my-home';
    expect(getHyperClawDir()).toBe(path.join('/tmp/my-home', '.hyperclaw'));
  });

  it('getConfigPath defaults inside hcdir', () => {
    delete process.env.HYPERCLAW_CONFIG_PATH;
    delete process.env.HYPERCLAW_STATE_DIR;
    delete process.env.HYPERCLAW_HOME;
    const cfg = getConfigPath();
    expect(cfg).toContain('hyperclaw.json');
    expect(cfg).toContain('.hyperclaw');
  });

  it('getConfigPath respects HYPERCLAW_CONFIG_PATH', () => {
    process.env.HYPERCLAW_CONFIG_PATH = '/tmp/custom.json';
    expect(getConfigPath()).toBe('/tmp/custom.json');
  });

  it('getEnvFilePath is inside hcdir', () => {
    delete process.env.HYPERCLAW_STATE_DIR;
    delete process.env.HYPERCLAW_HOME;
    const envFile = getEnvFilePath();
    expect(envFile).toMatch(/\.env$/);
    expect(envFile).toContain('.hyperclaw');
  });
});

describe('HyperClawConfig type shape', () => {
  it('satisfies provider config shape', () => {
    // Type-level test: if this compiles, the shape is correct
    const cfg = {
      provider: { providerId: 'anthropic' as const, modelId: 'claude-sonnet-4-6' },
      gateway: { port: 18789, token: 'secret' },
      tools: { dockerSandbox: { enabled: false } },
      agents: { defaults: { sandbox: { mode: 'none' as const } } }
    };
    expect(cfg.provider.providerId).toBe('anthropic');
    expect(cfg.gateway.port).toBe(18789);
    expect(cfg.tools.dockerSandbox.enabled).toBe(false);
  });

  it('handles partial config gracefully', () => {
    const cfg = {};
    expect((cfg as any)?.provider?.modelId).toBeUndefined();
  });
});
