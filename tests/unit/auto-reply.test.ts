/**
 * tests/unit/auto-reply.test.ts
 * Unit tests — Auto-reply rule engine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStore = vi.hoisted(() => ({ rules: [] as any[] }));
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockImplementation(async () => [...mockStore.rules]),
    writeJson: vi.fn().mockImplementation(async (_: string, data: any) => {
      mockStore.rules = Array.isArray(data) ? [...data] : [];
    }),
  }
}));

import { AutoReplyEngine } from '../../src/auto-reply/rules';

const msg = (text: string, from = 'user1', channelId = 'telegram') => ({
  content: text, from, channelId, timestamp: new Date().toISOString()
});

describe('AutoReplyEngine', () => {
  beforeEach(() => {
    mockStore.rules = [];
  });

  it('returns null when no rules exist', async () => {
    const engine = new AutoReplyEngine();
    const result = await engine.evaluate(msg('hello'));
    expect(result).toBeNull();
  });

  it('matches contains condition', async () => {
    const engine = new AutoReplyEngine();
    await engine.add({
      name: 'Test rule',
      enabled: true,
      priority: 1,
      stopOnMatch: true,
      conditions: [{ type: 'contains', value: 'hello' }],
      conditionLogic: 'AND',
      action: { type: 'reply', reply: 'Hi there!' }
    });

    const result = await engine.evaluate(msg('Hello World'));
    expect(result).not.toBeNull();
    expect(result?.type).toBe('reply');
    expect(result?.reply).toBe('Hi there!');
  });

  it('does not match when condition fails', async () => {
    const engine = new AutoReplyEngine();
    await engine.add({
      name: 'Test rule',
      enabled: true,
      priority: 1,
      stopOnMatch: true,
      conditions: [{ type: 'contains', value: 'goodbye' }],
      conditionLogic: 'AND',
      action: { type: 'reply', reply: 'Bye!' }
    });

    const result = await engine.evaluate(msg('Hello World'));
    expect(result).toBeNull();
  });

  it('matches regex condition', async () => {
    const engine = new AutoReplyEngine();
    await engine.add({
      name: 'Regex rule',
      enabled: true,
      priority: 1,
      stopOnMatch: true,
      conditions: [{ type: 'regex', value: '^/start', flags: 'i' }],
      conditionLogic: 'AND',
      action: { type: 'reply', reply: 'Started!' }
    });

    expect(await engine.evaluate(msg('/start'))).not.toBeNull();
    expect(await engine.evaluate(msg('not start'))).toBeNull();
  });

  it('respects disabled rules', async () => {
    const engine = new AutoReplyEngine();
    await engine.add({
      name: 'Disabled rule',
      enabled: false,
      priority: 1,
      stopOnMatch: true,
      conditions: [{ type: 'always' }],
      conditionLogic: 'AND',
      action: { type: 'reply', reply: 'Should not fire' }
    });

    const result = await engine.evaluate(msg('anything'));
    expect(result).toBeNull();
  });

  it('OR logic fires when any condition matches', async () => {
    const engine = new AutoReplyEngine();
    await engine.add({
      name: 'OR rule',
      enabled: true,
      priority: 1,
      stopOnMatch: true,
      conditions: [
        { type: 'contains', value: 'cat' },
        { type: 'contains', value: 'dog' }
      ],
      conditionLogic: 'OR',
      action: { type: 'ignore' }
    });

    expect(await engine.evaluate(msg('I love cats'))).not.toBeNull();
    expect(await engine.evaluate(msg('I love dogs'))).not.toBeNull();
    expect(await engine.evaluate(msg('I love fish'))).toBeNull();
  });

  it('AND logic requires all conditions', async () => {
    const engine = new AutoReplyEngine();
    await engine.add({
      name: 'AND rule',
      enabled: true,
      priority: 1,
      stopOnMatch: true,
      conditions: [
        { type: 'contains', value: 'urgent' },
        { type: 'from', value: 'admin' }
      ],
      conditionLogic: 'AND',
      action: { type: 'notify' }
    });

    expect(await engine.evaluate(msg('urgent message', 'admin'))).not.toBeNull();
    expect(await engine.evaluate(msg('urgent message', 'user'))).toBeNull();
    expect(await engine.evaluate(msg('normal message', 'admin'))).toBeNull();
  });
});
