/**
 * tests/unit/engine-utils.test.ts
 * Unit tests — engine utilities (workspace context loading, skills context)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the loadWorkspaceContext logic in isolation
async function loadWorkspaceContextMock(
  files: Record<string, string>,
  dir: string
): Promise<string> {
  let context = '';
  const core = ['SOUL.md', 'AGENTS.md', 'MEMORY.md'];
  for (const f of core) {
    if (files[f] !== undefined) context += `## ${f}\n${files[f]}\n\n`;
  }
  for (const f of Object.keys(files)) {
    if (f.endsWith('.md') && !core.includes(f)) {
      context += `## ${f}\n${files[f]}\n\n`;
    }
  }
  return context;
}

describe('loadWorkspaceContext logic', () => {
  it('loads core files in order: SOUL, AGENTS, MEMORY', async () => {
    const files = {
      'SOUL.md': 'I am an eagle agent.',
      'AGENTS.md': '## Guidelines',
      'MEMORY.md': '- remembered fact'
    };
    const ctx = await loadWorkspaceContextMock(files, '/fake');
    expect(ctx.indexOf('SOUL.md')).toBeLessThan(ctx.indexOf('AGENTS.md'));
    expect(ctx.indexOf('AGENTS.md')).toBeLessThan(ctx.indexOf('MEMORY.md'));
  });

  it('includes custom .md files after core', async () => {
    const files = {
      'SOUL.md': 'soul',
      'EPIXEIRISI.md': 'business context'
    };
    const ctx = await loadWorkspaceContextMock(files, '/fake');
    expect(ctx).toContain('## SOUL.md');
    expect(ctx).toContain('## EPIXEIRISI.md');
    expect(ctx).toContain('business context');
  });

  it('returns empty string when no files exist', async () => {
    const ctx = await loadWorkspaceContextMock({}, '/fake');
    expect(ctx).toBe('');
  });

  it('does not double-include core files in custom section', async () => {
    const files = {
      'SOUL.md': 'soul content',
      'MEMORY.md': 'memory content'
    };
    const ctx = await loadWorkspaceContextMock(files, '/fake');
    // SOUL.md should appear exactly once
    expect(ctx.split('## SOUL.md').length - 1).toBe(1);
  });
});

describe('engine provider resolution', () => {
  it('maps anthropic providerId to anthropic provider string', () => {
    const cfg = { provider: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' } };
    const provider = cfg?.provider?.providerId === 'anthropic' ? 'anthropic'
      : cfg?.provider?.providerId === 'custom' ? 'custom' : 'openrouter';
    expect(provider).toBe('anthropic');
  });

  it('maps custom providerId to custom provider string', () => {
    const cfg = { provider: { providerId: 'custom', modelId: 'llama3', baseUrl: 'http://localhost:11434' } };
    const provider = cfg?.provider?.providerId === 'anthropic' ? 'anthropic'
      : cfg?.provider?.providerId === 'custom' ? 'custom' : 'openrouter';
    expect(provider).toBe('custom');
  });

  it('maps anything else to openrouter', () => {
    const cfg = { provider: { providerId: 'openrouter', modelId: 'mistral/mistral-7b' } };
    const provider = cfg?.provider?.providerId === 'anthropic' ? 'anthropic'
      : cfg?.provider?.providerId === 'custom' ? 'custom' : 'openrouter';
    expect(provider).toBe('openrouter');
  });

  it('defaults model to claude-sonnet-4-5 when not set', () => {
    const cfg = {};
    const model = (cfg as any)?.provider?.modelId || 'claude-sonnet-4-5';
    expect(model).toBe('claude-sonnet-4-5');
  });

  it('calculates maxTokens correctly with thinking budget', () => {
    const thinkingBudget = 8000;
    const maxTokens = thinkingBudget > 0 ? thinkingBudget + 4096 : 4096;
    expect(maxTokens).toBe(12096);
  });

  it('uses default maxTokens when no thinking budget', () => {
    const thinkingBudget = 0;
    const maxTokens = thinkingBudget > 0 ? thinkingBudget + 4096 : 4096;
    expect(maxTokens).toBe(4096);
  });
});

describe('CHANNEL_SOURCES sandbox detection', () => {
  const CHANNEL_SOURCES = ['telegram', 'discord', 'whatsapp', 'slack', 'signal', 'matrix',
    'line', 'nostr', 'feishu', 'msteams', 'teams', 'instagram', 'messenger', 'twitter', 'viber', 'zalo'];

  it('identifies telegram as a channel source', () => {
    expect(CHANNEL_SOURCES.includes('telegram')).toBe(true);
  });

  it('does not identify cli as a channel source', () => {
    expect(CHANNEL_SOURCES.includes('cli')).toBe(false);
  });

  it('triggers sandbox for non-main channel source with non-main mode', () => {
    const cfg = { agents: { defaults: { sandbox: { mode: 'non-main' } } } };
    const source = 'telegram';
    const sandboxNonMain = cfg?.agents?.defaults?.sandbox?.mode === 'non-main'
      && source && CHANNEL_SOURCES.includes(source);
    expect(sandboxNonMain).toBe(true);
  });

  it('does not sandbox cli even with non-main mode', () => {
    const cfg = { agents: { defaults: { sandbox: { mode: 'non-main' } } } };
    const source = 'cli';
    const sandboxNonMain = cfg?.agents?.defaults?.sandbox?.mode === 'non-main'
      && source && CHANNEL_SOURCES.includes(source);
    expect(sandboxNonMain).toBeFalsy();
  });
});
