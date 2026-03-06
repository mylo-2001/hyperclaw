/**
 * src/agent/pi-rpc.ts
 * Pi-style RPC interface — OpenClaw compatibility.
 * JSON-RPC over HTTP + optional SSE events.
 * Methods: send, chats.list, session.create
 */

import type { InferenceMessage } from './inference';

export interface PiRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface PiRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface PiRPCSendParams {
  message: string;
  sessionId?: string;
}

export interface PiRPCSendResult {
  response: string;
  sessionId: string;
  toolCalls?: Array<{ name: string; result: string }>;
}

export interface PiRPCChatsListResult {
  chats: Array<{ id: string; source: string; connectedAt: string }>;
}

export function createPiRPCHandler(callAgent: (msg: string, opts?: { sessionId?: string; source?: string }) => Promise<string>, getSessions?: () => Array<{ id: string; source: string; connectedAt: string }>) {
  return async (req: PiRPCRequest): Promise<PiRPCResponse> => {
    const { id, method, params } = req;
    try {
      let result: unknown;
      switch (method) {
        case 'send':
          result = await handleSend(params as unknown as PiRPCSendParams, callAgent);
          break;
        case 'chats.list':
          result = handleChatsList(getSessions);
          break;
        case 'ping':
          result = { pong: Date.now() };
          break;
        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      }
      return { jsonrpc: '2.0', id, result };
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message || 'Internal error' } };
    }
  };
}

async function handleSend(params: PiRPCSendParams | undefined, callAgent: (msg: string, opts?: { sessionId?: string; source?: string }) => Promise<string>): Promise<PiRPCSendResult> {
  const message = params?.message;
  if (!message || typeof message !== 'string') {
    throw new Error('params.message is required');
  }
  const sessionId = params?.sessionId as string | undefined;
  const response = await callAgent(message, { sessionId, source: 'pi-rpc' });
  return { response, sessionId: sessionId || 'default' };
}

function handleChatsList(getSessions?: () => Array<{ id: string; source: string; connectedAt: string }>): PiRPCChatsListResult {
  const chats = getSessions ? getSessions() : [];
  return { chats };
}
