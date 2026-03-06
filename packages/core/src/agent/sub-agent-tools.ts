/**
 * packages/core/src/agent/sub-agent-tools.ts
 * Multi-agent orchestration: spawn sub-agents for delegated tasks.
 */

import type { Tool } from './inference';

/** Tool: spawn a sub-agent to accomplish a focused goal. Returns the sub-agent's response. */
export function getSubAgentTools(): Tool[] {
  return [
    {
      name: 'spawn_sub_agent',
      description: 'Delegate a focused subtask to a sub-agent. Use when you need specialized work (research, coding, summarization) that benefits from a fresh context. Provide a clear, self-contained goal.',
      input_schema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Clear, self-contained goal for the sub-agent (e.g. "Summarize the key points of X", "Write a function that does Y")' },
          context: { type: 'string', description: 'Optional context the sub-agent needs (paste relevant excerpts)' }
        },
        required: ['goal']
      },
      handler: async (input) => {
        const goal = String(input.goal || '').trim();
        const context = String(input.context || '').trim();
        if (!goal) return 'Error: goal is required.';
        const prompt = context
          ? `Context:\n${context}\n\nTask: ${goal}`
          : goal;
        const { runAgentEngine } = await import('./engine');
        const result = await runAgentEngine(prompt, {});
        if (result.error) return `Sub-agent error: ${result.text}`;
        return result.text;
      }
    }
  ];
}
