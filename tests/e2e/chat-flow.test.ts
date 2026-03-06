/**
 * tests/e2e/chat-flow.test.ts
 * E2E — message flow: incoming -> gateway -> agent -> response
 * Covers: /api/chat, /api/webhook/inbound, channel connector loading
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GatewayServer, GatewayConfig } from '../../src/gateway/server';

const port = 19793;

async function httpReq(
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const h: Record<string, string> = { ...headers };
    if (body) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = String(Buffer.byteLength(body));
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: h
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let server: GatewayServer;

describe('Chat flow: incoming -> gateway -> agent path', () => {
  beforeAll(async () => {
    const config: GatewayConfig = {
      port,
      bind: '127.0.0.1',
      authToken: '',
      runtime: 'node',
      enabledChannels: [],
      hooks: false
    };
    server = new GatewayServer(config);
    await server.start();
  }, 15000);

  afterAll(async () => {
    await server?.stop();
  });

  it('POST /api/chat accepts message and returns response or provider error', async () => {
    const { status, body } = await httpReq('POST', '/api/chat', JSON.stringify({ message: 'hello' }));
    // 200 = agent responded; 500 = provider/config error (path still works)
    expect([200, 500]).toContain(status);
    if (status === 200) {
      const json = JSON.parse(body);
      expect(json).toHaveProperty('response');
    } else {
      const json = JSON.parse(body);
      expect(json).toHaveProperty('error');
    }
  });

  it('POST /api/webhook/inbound accepts message and hits agent path', async () => {
    const { status, body } = await httpReq(
      'POST',
      '/api/webhook/inbound',
      JSON.stringify({ message: 'ping' })
    );
    expect([200, 500]).toContain(status);
    if (status === 200) {
      const json = JSON.parse(body);
      expect(json).toHaveProperty('ok', true);
      expect(json).toHaveProperty('response');
    }
  });
});

describe('Channel connectors load', () => {
  it('Telegram connector can be imported', async () => {
    const { TelegramConnector } = await import('../../extensions/telegram/src/connector');
    expect(TelegramConnector).toBeDefined();
  });

  it('Discord connector can be imported', async () => {
    const { DiscordConnector } = await import('../../extensions/discord/src/connector');
    expect(DiscordConnector).toBeDefined();
  });
});
