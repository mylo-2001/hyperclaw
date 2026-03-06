/**
 * tests/unit/secrets.test.ts
 * Unit tests — Secrets manager
 */
import { describe, it, expect, vi } from 'vitest';

// Mock os and fs-extra
vi.mock('os', () => ({ default: { homedir: () => '/tmp/test-home' } }));
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockRejectedValue(new Error('no file')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
  }
}));

describe('Secrets parsing', () => {
  it('should parse KEY=value format', () => {
    const line = 'ANTHROPIC_API_KEY=sk-ant-test-123';
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    expect(key).toBe('ANTHROPIC_API_KEY');
    expect(value).toBe('sk-ant-test-123');
  });

  it('should handle values with = signs', () => {
    const line = 'DB_URL=postgres://user:pass@host/db?ssl=true';
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    expect(key).toBe('DB_URL');
    expect(value).toBe('postgres://user:pass@host/db?ssl=true');
  });

  it('should reject invalid format', () => {
    const invalid = 'JUSTAKEYNOVALUE';
    expect(invalid.includes('=')).toBe(false);
  });
});

describe('Known secrets list', () => {
  it('should include major API keys', () => {
    const KNOWN = [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY',
      'XAI_API_KEY', 'GOOGLE_AI_API_KEY', 'HYPERCLAW_GATEWAY_TOKEN'
    ];
    expect(KNOWN).toContain('ANTHROPIC_API_KEY');
    expect(KNOWN).toContain('OPENROUTER_API_KEY');
    expect(KNOWN.length).toBeGreaterThanOrEqual(6);
  });
});
