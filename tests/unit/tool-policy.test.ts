/**
 * tests/unit/tool-policy.test.ts
 * Unit tests for src/infra/tool-policy.ts
 * Pure logic — no I/O, no mocks needed.
 */
import { describe, it, expect } from 'vitest';
import {
  applyToolPolicy,
  describeToolPolicy,
  TOOL_GROUPS,
  PROFILE_TOOLS
} from '../../src/infra/tool-policy';

// Minimal Tool stub matching the runtime shape (type is erased)
function makeTool(name: string) {
  return { name, description: '', input_schema: { type: 'object' as const, properties: {} } };
}

const ALL_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'delete_file', 'list_directory',
  'run_shell', 'kill_process',
  'sessions_list', 'sessions_send', 'sessions_history',
  'read_memory', 'write_memory',
  'get_current_time', 'http_get', 'canvas_add', 'create_skill',
  'analyze_image', 'extract_pdf'
].map(makeTool);

describe('applyToolPolicy', () => {
  it('returns all tools when config is null', () => {
    const result = applyToolPolicy(ALL_TOOLS, null);
    expect(result).toHaveLength(ALL_TOOLS.length);
  });

  it('returns all tools when config is undefined', () => {
    const result = applyToolPolicy(ALL_TOOLS, undefined);
    expect(result).toHaveLength(ALL_TOOLS.length);
  });

  it('profile=full allows all tools', () => {
    const result = applyToolPolicy(ALL_TOOLS, { profile: 'full' });
    expect(result).toHaveLength(ALL_TOOLS.length);
  });

  it('profile=minimal restricts to minimal set', () => {
    const result = applyToolPolicy(ALL_TOOLS, { profile: 'minimal' });
    const names = result.map(t => t.name);
    expect(names).toContain('get_current_time');
    expect(names).toContain('sessions_list');
    expect(names).toContain('read_memory');
    expect(names).not.toContain('run_shell');
    expect(names).not.toContain('delete_file');
  });

  it('profile=messaging allows session and memory tools only', () => {
    const result = applyToolPolicy(ALL_TOOLS, { profile: 'messaging' });
    const names = result.map(t => t.name);
    expect(names).toContain('sessions_list');
    expect(names).toContain('sessions_send');
    expect(names).toContain('read_memory');
    expect(names).not.toContain('run_shell');
    expect(names).not.toContain('edit_file');
  });

  it('profile=coding allows fs, runtime, sessions, memory, and extras', () => {
    const result = applyToolPolicy(ALL_TOOLS, { profile: 'coding' });
    const names = result.map(t => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('run_shell');
    expect(names).toContain('read_memory');
    expect(names).toContain('http_get');
  });

  it('deny list blocks specific tools', () => {
    const result = applyToolPolicy(ALL_TOOLS, { deny: ['run_shell', 'delete_file'] });
    const names = result.map(t => t.name);
    expect(names).not.toContain('run_shell');
    expect(names).not.toContain('delete_file');
    expect(names).toContain('read_file');
  });

  it('deny wildcard blocks prefixed tools', () => {
    const result = applyToolPolicy(ALL_TOOLS, { deny: ['sessions_*'] });
    const names = result.map(t => t.name);
    expect(names).not.toContain('sessions_list');
    expect(names).not.toContain('sessions_send');
    expect(names).not.toContain('sessions_history');
    expect(names).toContain('read_file');
  });

  it('allow list restricts to only listed tools', () => {
    const result = applyToolPolicy(ALL_TOOLS, { allow: ['get_current_time', 'http_get'] });
    const names = result.map(t => t.name);
    expect(names).toEqual(['get_current_time', 'http_get']);
  });

  it('allow group expands to group members', () => {
    const result = applyToolPolicy(ALL_TOOLS, { allow: ['group:runtime'] });
    const names = result.map(t => t.name);
    expect(names).toContain('run_shell');
    expect(names).toContain('kill_process');
    expect(names).not.toContain('read_file');
  });

  it('deny takes precedence over allow', () => {
    const result = applyToolPolicy(ALL_TOOLS, {
      allow: ['read_file', 'run_shell'],
      deny: ['run_shell']
    });
    const names = result.map(t => t.name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('run_shell');
  });

  it('byProvider overrides profile for matching provider', () => {
    const result = applyToolPolicy(ALL_TOOLS, {
      profile: 'full',
      byProvider: {
        anthropic: { profile: 'minimal' }
      }
    }, { provider: 'anthropic' });
    const names = result.map(t => t.name);
    expect(names).toContain('get_current_time');
    expect(names).not.toContain('run_shell');
  });

  it('byProvider does not affect other providers', () => {
    const result = applyToolPolicy(ALL_TOOLS, {
      profile: 'full',
      byProvider: {
        anthropic: { profile: 'minimal' }
      }
    }, { provider: 'openrouter' });
    // profile=full for openrouter — all tools pass
    expect(result).toHaveLength(ALL_TOOLS.length);
  });
});

describe('describeToolPolicy', () => {
  it('returns defaults when config is null', () => {
    const desc = describeToolPolicy(null);
    expect(desc.profile).toBe('full');
    expect(desc.source).toBe('default');
    expect(desc.allow).toEqual([]);
    expect(desc.deny).toEqual([]);
  });

  it('reflects config profile and deny', () => {
    const desc = describeToolPolicy({ profile: 'coding', deny: ['run_shell'] });
    expect(desc.profile).toBe('coding');
    expect(desc.deny).toContain('run_shell');
  });

  it('source changes when byProvider is used', () => {
    const desc = describeToolPolicy(
      { profile: 'full', byProvider: { anthropic: { profile: 'minimal' } } },
      { provider: 'anthropic' }
    );
    expect(desc.profile).toBe('minimal');
    expect(desc.source).toContain('anthropic');
  });
});

describe('TOOL_GROUPS and PROFILE_TOOLS', () => {
  it('group:fs contains file tools', () => {
    expect(TOOL_GROUPS['group:fs']).toContain('read_file');
    expect(TOOL_GROUPS['group:fs']).toContain('write_file');
    expect(TOOL_GROUPS['group:fs']).toContain('delete_file');
  });

  it('group:runtime contains shell and kill', () => {
    expect(TOOL_GROUPS['group:runtime']).toContain('run_shell');
    expect(TOOL_GROUPS['group:runtime']).toContain('kill_process');
  });

  it('PROFILE_TOOLS.full is empty (no restriction)', () => {
    expect(PROFILE_TOOLS.full).toHaveLength(0);
  });

  it('PROFILE_TOOLS.minimal is a small set', () => {
    expect(PROFILE_TOOLS.minimal.length).toBeGreaterThan(0);
    expect(PROFILE_TOOLS.minimal.length).toBeLessThan(5);
  });
});
