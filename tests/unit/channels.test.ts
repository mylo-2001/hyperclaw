/**
 * tests/unit/channels.test.ts
 * Unit tests — Channel registry
 */
import { describe, it, expect } from 'vitest';
import { CHANNELS, getChannel } from '../../src/channels/registry';

describe('Channel registry', () => {
  it('should have at least 20 channels', () => {
    expect(CHANNELS.length).toBeGreaterThanOrEqual(20);
  });

  it('should include Zalo Personal as separate channel', () => {
    const zaloPersonal = CHANNELS.find(c => c.id === 'zalo-personal');
    expect(zaloPersonal).toBeDefined();
    expect(zaloPersonal?.name).toBe('Zalo Personal');
  });

  it('should include all major platforms', () => {
    const ids = CHANNELS.map(c => c.id);
    const expected = ['telegram', 'whatsapp', 'discord', 'slack', 'signal', 'email', 'web', 'cli'];
    for (const id of expected) {
      expect(ids).toContain(id);
    }
  });

  it('should find channel by id', () => {
    const tg = getChannel('telegram');
    expect(tg).toBeDefined();
    expect(tg?.name).toBe('Telegram');
    expect(tg?.emoji).toBe('✈️');
  });

  it('should return undefined for unknown channel', () => {
    const ch = getChannel('nonexistent');
    expect(ch).toBeUndefined();
  });

  it('each channel should have required fields', () => {
    for (const ch of CHANNELS) {
      expect(ch.id).toBeTruthy();
      expect(ch.name).toBeTruthy();
      expect(ch.emoji).toBeTruthy();
      expect(typeof ch.supportsDM).toBe('boolean');
      expect(Array.isArray(ch.platforms)).toBe(true);
    }
  });
});
