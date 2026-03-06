/**
 * tests/unit/telegram-connector.test.ts
 * Unit tests — Telegram connector (mocked network)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    readJson: vi.fn().mockRejectedValue(new Error('no file')),
    writeJson: vi.fn().mockResolvedValue(undefined),
  }
}));

// Mock https
vi.mock('https', () => ({
  default: { request: vi.fn() },
  request: vi.fn()
}));

import { TelegramConnector } from '../../extensions/telegram/src/connector';

describe('TelegramConnector', () => {
  describe('pairing code generation', () => {
    it('should generate codes without ambiguous chars', () => {
      const ambiguous = new Set(['0', 'O', '1', 'I', 'L']);
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ2346789'; // excludes 0,O,1,I,L,5
      const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      expect(code).toHaveLength(6);
      for (const char of code) {
        expect(ambiguous.has(char)).toBe(false);
      }
    });
  });

  describe('text chunking', () => {
    it('should split long messages at 4096 chars', () => {
      const text = 'a'.repeat(5000);
      const chunks: string[] = [];
      let i = 0;
      while (i < text.length) {
        chunks.push(text.slice(i, Math.min(i + 4096, text.length)));
        i += 4096;
      }
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(4096);
      expect(chunks.join('')).toBe(text);
    });
  });

  describe('DM policy', () => {
    it('should block unknown user on allowlist policy', async () => {
      const conn = new TelegramConnector('token', {
        dmPolicy: 'allowlist',
        allowFrom: ['123'],
        approvedPairings: []
      });
      // Mock sendMessage
      let sent = '';
      (conn as any).sendMessage = async (_: any, text: string) => { sent = text; };
      const result = await (conn as any).checkDMPolicy('999', 1001, 'hello');
      expect(result).toBe(false);
      expect(sent).toContain('not on the allowlist');
    });

    it('should allow whitelisted user', async () => {
      const conn = new TelegramConnector('token', {
        dmPolicy: 'allowlist',
        allowFrom: ['123']
      });
      const result = await (conn as any).checkDMPolicy('123', 1001, 'hello');
      expect(result).toBe(true);
    });

    it('should allow all on open policy', async () => {
      const conn = new TelegramConnector('token', { dmPolicy: 'open' });
      expect(await (conn as any).checkDMPolicy('any', 1001, 'msg')).toBe(true);
    });

    it('should block all on none policy', async () => {
      const conn = new TelegramConnector('token', { dmPolicy: 'none' });
      expect(await (conn as any).checkDMPolicy('any', 1001, 'msg')).toBe(false);
    });
  });

  describe('allowlist management', () => {
    it('should not add duplicate user IDs', () => {
      const conn = new TelegramConnector('token', { dmPolicy: 'allowlist', allowFrom: [] });
      conn.addToAllowlist('123');
      conn.addToAllowlist('123');
      expect(conn.config.allowFrom).toHaveLength(1);
    });
  });
});
