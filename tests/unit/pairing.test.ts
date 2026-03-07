/**
 * tests/unit/pairing.test.ts
 * Unit tests — DM pairing codes
 */
import { describe, it, expect, vi } from 'vitest';

// In-memory store so writeJson/readJson share state within each test
const fakeStore: Record<string, unknown> = {};

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    ensureDirSync: vi.fn(),
    pathExists: vi.fn().mockResolvedValue(false),
    readJson: vi.fn().mockImplementation((filePath: string) => {
      if (fakeStore[filePath] !== undefined) return Promise.resolve(fakeStore[filePath]);
      return Promise.reject(new Error('no file'));
    }),
    readJsonSync: vi.fn().mockImplementation(() => []),
    writeJson: vi.fn().mockImplementation((filePath: string, data: unknown) => {
      fakeStore[filePath] = data;
      return Promise.resolve();
    }),
    writeJsonSync: vi.fn(),
  }
}));

// Import after mocks
import { PairingStore } from '../../src/channels/pairing';
import { beforeEach } from 'vitest';

// PairingStore(channelId, accountId='default') — code generation happens inside createRequest
// We test code format by inspecting what createRequest returns.

describe('PairingStore', () => {
  beforeEach(() => {
    // Reset in-memory store so each test starts fresh
    Object.keys(fakeStore).forEach(k => delete fakeStore[k]);
  });
  it('should generate 8-character codes via createRequest', async () => {
    const store = new PairingStore('telegram');
    const code = await store.createRequest('user123');
    expect(code).not.toBeNull();
    expect(code!.length).toBe(8);
  });

  it('should generate codes with no ambiguous characters (A-Z no O/I/0/1, 2-9)', async () => {
    // Allowed chars: ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0, O, 1, I)
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    // Use separate channel per user to avoid hitting the 3-pending cap
    for (let i = 0; i < 10; i++) {
      const store = new PairingStore(`ch_char_${i}`);
      const code = await store.createRequest(`user${i}`);
      expect(code).not.toBeNull();
      expect(allowed.test(code!)).toBe(true);
    }
  });

  it('should return existing code for repeated requests from same sender', async () => {
    const store = new PairingStore('telegram');
    const code1 = await store.createRequest('user_repeat');
    const code2 = await store.createRequest('user_repeat');
    expect(code1).toBe(code2);
  });

  it('should return null when pending cap is reached', async () => {
    const store = new PairingStore('telegram');
    // 3 different senders fill the cap
    await store.createRequest('sender_a');
    await store.createRequest('sender_b');
    await store.createRequest('sender_c');
    // 4th sender should be silently rejected
    const code = await store.createRequest('sender_d');
    expect(code).toBeNull();
  });

  it('isApproved returns false for unknown sender', async () => {
    const store = new PairingStore('telegram');
    const result = await store.isApproved('nobody');
    expect(result).toBe(false);
  });

  it('cliApprove returns false for unknown code', async () => {
    const store = new PairingStore('telegram');
    const result = await store.cliApprove('BADCODE');
    expect(result).toBe(false);
  });

  it('listPending returns array (empty when no file)', async () => {
    const store = new PairingStore('telegram');
    const pending = await store.listPending();
    expect(Array.isArray(pending)).toBe(true);
  });
});
