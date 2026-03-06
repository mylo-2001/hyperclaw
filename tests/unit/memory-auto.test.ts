/**
 * tests/unit/memory-auto.test.ts
 * Unit tests — Auto-memory extraction
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockRejectedValue(new Error('no file')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
  }
}));

import { extractFactsLocally, type ChatTurn } from 'hyperclaw/core';

const turns = (msgs: string[]): ChatTurn[] =>
  msgs.map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content }));

describe('extractFactsLocally', () => {
  it('extracts name from message', () => {
    const facts = extractFactsLocally(turns(['My name is Alex']));
    expect(facts.some(f => f.fact.toLowerCase().includes('alex'))).toBe(true);
  });

  it('extracts preference', () => {
    const facts = extractFactsLocally(turns(['I prefer TypeScript over JavaScript']));
    expect(facts.some(f => f.category === 'preference')).toBe(true);
  });

  it('extracts goal', () => {
    const facts = extractFactsLocally(turns(["I'm working on a SaaS app for freelancers"]));
    expect(facts.some(f => f.category === 'goal')).toBe(true);
  });

  it('extracts job/identity', () => {
    const facts = extractFactsLocally(turns(['I work at Google as a software engineer']));
    expect(facts.some(f => f.category === 'identity')).toBe(true);
  });

  it('skips sensitive data', () => {
    const facts = extractFactsLocally(turns(['My password is abc123', 'My API key is sk-abc123']));
    expect(facts).toHaveLength(0);
  });

  it('deduplicates identical facts', () => {
    const facts = extractFactsLocally(turns([
      'My name is Alex',
      'assistant response',
      'My name is Alex again'
    ]));
    const nameCount = facts.filter(f => f.fact.toLowerCase().includes('alex')).length;
    expect(nameCount).toBe(1);
  });

  it('ignores assistant messages', () => {
    const conversationWithOnlyAssistant: ChatTurn[] = [
      { role: 'assistant', content: 'My name is HyperClaw' }
    ];
    const facts = extractFactsLocally(conversationWithOnlyAssistant);
    expect(facts).toHaveLength(0);
  });

  it('returns empty for generic questions', () => {
    const facts = extractFactsLocally(turns(['What is the capital of France?']));
    expect(facts.length).toBe(0);
  });

  it('extracts multiple facts from one message', () => {
    const facts = extractFactsLocally(turns([
      "I'm a developer from Athens and I prefer dark mode"
    ]));
    expect(facts.length).toBeGreaterThanOrEqual(1);
  });

  it('assigns high confidence to clear preferences', () => {
    const facts = extractFactsLocally(turns(['I always use tabs not spaces']));
    const pref = facts.find(f => f.category === 'preference');
    expect(pref?.confidence).toBe('high');
  });
});
