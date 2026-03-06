/**
 * tests/unit/pairing.test.ts
 * Unit tests — DM pairing codes
 */
import { describe, it, expect, vi } from 'vitest';

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

// Import after mocks
import { PairingStore } from '../../src/channels/pairing';

describe('PairingStore', () => {
  it('should generate 6-character codes', () => {
    const store = new PairingStore();
    const code = store.generateCode('telegram');
    expect(code).toHaveLength(6);
    expect(/^[A-Z0-9]{6}$/.test(code)).toBe(true);
  });

  it('should generate unique codes', () => {
    const store = new PairingStore();
    const codes = new Set(
      Array.from({ length: 50 }, () => store.generateCode('telegram'))
    );
    // Very unlikely to have collisions in 50 codes
    expect(codes.size).toBeGreaterThanOrEqual(45);
  });

  it('should generate hex format (0-9, A-F)', () => {
    const store = new PairingStore();
    const hexChars = new Set('0123456789ABCDEF');
    for (let i = 0; i < 20; i++) {
      const code = store.generateCode('telegram');
      for (const char of code) {
        expect(hexChars.has(char)).toBe(true);
      }
    }
  });
});
