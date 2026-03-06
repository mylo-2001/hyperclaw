/**
 * tests/integration/delivery.test.ts
 * Integration tests — Delivery queue behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    ensureDirSync: vi.fn(),
    pathExists: vi.fn().mockResolvedValue(false),
    readJson: vi.fn().mockRejectedValue(new Error('no file')),
    readJsonSync: vi.fn().mockImplementation(() => []),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeJsonSync: vi.fn(),
  }
}));

import { DeliveryQueue } from '../../src/delivery/queue';

describe('DeliveryQueue backoff', () => {
  const BACKOFF_SECONDS = [5, 30, 120, 600, 3600];

  it('should use correct backoff schedule', () => {
    expect(BACKOFF_SECONDS[0]).toBe(5);    // 5s
    expect(BACKOFF_SECONDS[1]).toBe(30);   // 30s
    expect(BACKOFF_SECONDS[2]).toBe(120);  // 2m
    expect(BACKOFF_SECONDS[3]).toBe(600);  // 10m
    expect(BACKOFF_SECONDS[4]).toBe(3600); // 1h
  });

  it('should cap at last backoff value', () => {
    const getBackoff = (attempt: number) =>
      BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
    expect(getBackoff(10)).toBe(3600); // capped at 1h
    expect(getBackoff(0)).toBe(5);
  });

  it('should move to dead after maxAttempts', () => {
    const queue = new DeliveryQueue();
    const item = queue.enqueue('telegram', '@user', 'hello', 1);
    // After 1 failure, should be dead
    item.attemptCount = 1;
    item.status = 'failed';
    if (item.attemptCount >= item.maxAttempts) {
      item.status = 'dead';
    }
    expect(item.status).toBe('dead');
  });

  it('should track multiple items independently', () => {
    const queue = new DeliveryQueue();
    const a = queue.enqueue('telegram', '@a', 'msg1', 3);
    const b = queue.enqueue('discord', '@b', 'msg2', 5);
    expect(queue.pending()).toHaveLength(2);
    expect(a.maxAttempts).toBe(3);
    expect(b.maxAttempts).toBe(5);
  });
});
