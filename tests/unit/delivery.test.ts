/**
 * tests/unit/delivery.test.ts
 * Unit tests — Delivery queue
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeliveryQueue } from '../../src/delivery/queue';

// Mock fs-extra (delivery queue uses sync methods)
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

describe('DeliveryQueue', () => {
  let queue: DeliveryQueue;

  beforeEach(() => {
    queue = new DeliveryQueue();
  });

  it('should enqueue items with correct initial state', () => {
    const item = queue.enqueue('telegram', '@user123', 'Hello!', 5);
    expect(item.id).toBeTruthy();
    expect(item.channelId).toBe('telegram');
    expect(item.target).toBe('@user123');
    expect(item.payload).toBe('Hello!');
    expect(item.status).toBe('pending');
    expect(item.attemptCount).toBe(0);
    expect(item.maxAttempts).toBe(5);
  });

  it('should return pending items', () => {
    queue.enqueue('telegram', '@a', 'msg1');
    queue.enqueue('discord', '@b', 'msg2');
    const pending = queue.pending();
    expect(pending).toHaveLength(2);
    expect(pending.every(i => i.status === 'pending')).toBe(true);
  });

  it('should return empty dead-letter queue initially', () => {
    expect(queue.dead()).toHaveLength(0);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => queue.enqueue('telegram', '@u', 'msg').id)
    );
    expect(ids.size).toBe(100);
  });
});
