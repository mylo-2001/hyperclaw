/**
 * tests/unit/rate-limit.test.ts
 * Unit tests for src/channels/rate-limit.ts
 * Uses vi.useFakeTimers to avoid real delays.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withRateLimit, resetRateLimit } from '../../src/channels/rate-limit';

describe('withRateLimit', () => {
  beforeEach(() => {
    // Reset module-level state between tests by resetting each channel we use
    resetRateLimit('test-ch');
    resetRateLimit('ch-a');
    resetRateLimit('ch-b');
    vi.useFakeTimers();
  });

  it('executes the wrapped function and returns its value', async () => {
    const result = await withRateLimit('test-ch', async () => 42, { minDelayMs: 0 });
    expect(result).toBe(42);
    vi.runAllTimers();
  });

  it('executes the function even under the rate limit', async () => {
    let called = 0;
    const fn = async () => { called++; return called; };
    const p1 = withRateLimit('test-ch', fn, { maxPerWindow: 5, windowMs: 60_000, minDelayMs: 0 });
    vi.runAllTimers();
    await p1;
    expect(called).toBe(1);
  });

  it('different channel IDs are isolated', async () => {
    const resultA = withRateLimit('ch-a', async () => 'A', { minDelayMs: 0 });
    const resultB = withRateLimit('ch-b', async () => 'B', { minDelayMs: 0 });
    vi.runAllTimers();
    expect(await resultA).toBe('A');
    expect(await resultB).toBe('B');
  });

  it('propagates errors from the wrapped function', async () => {
    const boom = async () => { throw new Error('boom'); };
    const p = withRateLimit('test-ch', boom, { minDelayMs: 0 });
    vi.runAllTimers();
    await expect(p).rejects.toThrow('boom');
  });
});

describe('resetRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not throw when called for an unknown channel', () => {
    expect(() => resetRateLimit('unknown-channel-xyz')).not.toThrow();
  });

  it('clears the window counter so the next call starts fresh', async () => {
    resetRateLimit('test-ch');
    // Run 3 calls to increment counter
    for (let i = 0; i < 3; i++) {
      const p = withRateLimit('test-ch', async () => i, { maxPerWindow: 100, minDelayMs: 0 });
      vi.runAllTimers();
      await p;
    }
    // Now reset and ensure a new call works fine
    resetRateLimit('test-ch');
    const p = withRateLimit('test-ch', async () => 'fresh', { maxPerWindow: 100, minDelayMs: 0 });
    vi.runAllTimers();
    expect(await p).toBe('fresh');
  });
});
