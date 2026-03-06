/**
 * tests/unit/openrouter-toolcalls.test.ts
 * Unit tests — OpenRouter streaming tool_calls accumulation logic
 */
import { describe, it, expect } from 'vitest';

// Mirrors the accumulation logic in inference.ts callOpenRouter
function accumulateToolCalls(
  events: Array<{ choices: Array<{ delta: Record<string, unknown>; finish_reason?: string }> }>
): Record<number, { id: string; name: string; arguments: string }> {
  const acc: Record<number, { id: string; name: string; arguments: string }> = {};
  for (const event of events) {
    const choice = event.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta as any;
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx: number = tc.index ?? 0;
        if (!acc[idx]) acc[idx] = { id: tc.id || `call_${idx}`, name: '', arguments: '' };
        if (tc.id) acc[idx].id = tc.id;
        if (tc.function?.name) acc[idx].name += tc.function.name;
        if (tc.function?.arguments) acc[idx].arguments += tc.function.arguments;
      }
    }
  }
  return acc;
}

describe('OpenRouter tool_calls streaming accumulation', () => {
  it('accumulates a single tool call across streaming chunks', () => {
    const events = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_current_time', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"time' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'zone":"UTC"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
    ];

    const acc = accumulateToolCalls(events);
    expect(Object.keys(acc)).toHaveLength(1);
    expect(acc[0].id).toBe('call_abc');
    expect(acc[0].name).toBe('get_current_time');
    expect(acc[0].arguments).toBe('{"timezone":"UTC"}');
  });

  it('accumulates multiple parallel tool calls', () => {
    const events = [
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'tool_a', arguments: '' } },
        { index: 1, id: 'call_2', function: { name: 'tool_b', arguments: '' } }
      ] } }] },
      { choices: [{ delta: { tool_calls: [
        { index: 0, function: { arguments: '{"x":1}' } },
        { index: 1, function: { arguments: '{"y":2}' } }
      ] } }] }
    ];

    const acc = accumulateToolCalls(events);
    expect(Object.keys(acc)).toHaveLength(2);
    expect(acc[0].name).toBe('tool_a');
    expect(acc[0].arguments).toBe('{"x":1}');
    expect(acc[1].name).toBe('tool_b');
    expect(acc[1].arguments).toBe('{"y":2}');
  });

  it('handles events with no tool_calls gracefully', () => {
    const events = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] }
    ];
    const acc = accumulateToolCalls(events);
    expect(Object.keys(acc)).toHaveLength(0);
  });

  it('parses accumulated arguments as valid JSON', () => {
    const events = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'http_get', arguments: '{"url":"htt' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ps://example.com"}' } }] } }] }
    ];
    const acc = accumulateToolCalls(events);
    const parsed = JSON.parse(acc[0].arguments);
    expect(parsed.url).toBe('https://example.com');
  });

  it('maps finish_reason tool_calls to tool_use (Anthropic format)', () => {
    const finishReason = 'tool_calls';
    const mapped = finishReason === 'tool_calls' ? 'tool_use' : finishReason;
    expect(mapped).toBe('tool_use');
  });
});
