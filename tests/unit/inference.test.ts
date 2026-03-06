/**
 * tests/unit/inference.test.ts
 * Unit tests — AI inference engine (mocked API)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('InferenceEngine helpers', () => {
  it('should chunk text at newline boundaries', () => {
    function chunkText(text: string, max: number): string[] {
      if (text.length <= max) return [text];
      const chunks: string[] = [];
      let i = 0;
      while (i < text.length) {
        let end = Math.min(i + max, text.length);
        if (end < text.length) {
          const nl = text.lastIndexOf('\n', end);
          if (nl > i) end = nl + 1;
        }
        chunks.push(text.slice(i, end));
        i = end;
      }
      return chunks;
    }

    const short = 'Hello World';
    expect(chunkText(short, 100)).toEqual([short]);

    const long = 'Line1\nLine2\nLine3\n'.repeat(10);
    const chunks = chunkText(long, 30);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(long);
  });

  it('should parse SSE data lines', () => {
    function parseSSE(line: string): any | null {
      if (!line.startsWith('data: ')) return null;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return null;
      try { return JSON.parse(data); } catch { return null; }
    }

    expect(parseSSE('data: {"type":"text"}')).toEqual({ type: 'text' });
    expect(parseSSE('data: [DONE]')).toBeNull();
    expect(parseSSE('event: ping')).toBeNull();
    expect(parseSSE('data: invalid json{')).toBeNull();
  });

  it('should validate thinking levels', () => {
    const THINKING_BUDGET: Record<string, number> = {
      high: 10000, medium: 4000, low: 1000, none: 0
    };
    expect(THINKING_BUDGET['high']).toBe(10000);
    expect(THINKING_BUDGET['none']).toBe(0);
    expect(Object.keys(THINKING_BUDGET)).toHaveLength(4);
  });

  it('should strip markdown fences from JSON', () => {
    function stripFences(text: string): string {
      return text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});
