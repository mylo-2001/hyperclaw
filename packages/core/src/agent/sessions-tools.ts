/**
 * src/agent/sessions-tools.ts
 * Agent-to-agent session tools: sessions_list, sessions_send, sessions_history.
 * Requires gateway context (getActiveServer).
 */

import type { Tool } from './inference';

/** Minimal interface for session server (gateway implements this). */
export interface ISessionServer {
  getSessionsList?(): unknown[];
  sendToSession?(id: string, msg: unknown): boolean;
  getSessionHistory?(id: string, limit: number): unknown[] | undefined;
}

export function getSessionsTools(
  getServer: () => ISessionServer | null,
  currentSessionId?: string
): Tool[] {
  return [
    {
      name: 'sessions_list',
      description: 'List active WebSocket sessions connected to the gateway. Use to discover other agents or clients.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async () => {
        const server = getServer();
        if (!server) return 'Gateway not available (sessions tools only work when running in gateway).';
        const list = (server as any).getSessionsList?.() ?? [];
        return JSON.stringify(list, null, 2);
      }
    },
    {
      name: 'sessions_send',
      description: 'Send a message to another session. Use sessions_list to get session IDs.',
      input_schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Target session ID from sessions_list' },
          content: { type: 'string', description: 'Message content to send' }
        },
        required: ['sessionId', 'content']
      },
      handler: async (input) => {
        const server = getServer();
        if (!server) return 'Gateway not available.';
        const sessionId = input.sessionId as string;
        const content = input.content as string;
        const ok = (server as any).sendToSession?.(sessionId, { type: 'chat:incoming', content, fromSession: currentSessionId ?? 'unknown' });
        if (ok) return `Sent to session ${sessionId}.`;
        return `Session ${sessionId} not found or disconnected.`;
      }
    },
    {
      name: 'sessions_history',
      description: 'Get recent chat transcript for a session. Returns user/assistant turns.',
      input_schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID (use "self" for current session)' },
          limit: { type: 'string', description: 'Max turns to return (default 20)' }
        },
        required: ['sessionId']
      },
      handler: async (input) => {
        const server = getServer();
        if (!server) return 'Gateway not available.';
        const sid = (input.sessionId as string) === 'self' ? currentSessionId : (input.sessionId as string);
        if (!sid) return 'No current session.';
        const limit = parseInt((input.limit as string) || '20');
        const history = (server as any).getSessionHistory?.(sid, limit) ?? [];
        return JSON.stringify(history, null, 2);
      }
    }
  ];
}
