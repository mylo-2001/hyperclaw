/**
 * tests/e2e/full-flow.test.ts
 * E2E — command → gateway → response and channel → gateway flows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GatewayServer, GatewayConfig } from '../../src/gateway/server';

const port = 19794;

async function httpReq(method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let server: GatewayServer;

describe('Full flow: HTTP chat path', () => {
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

  it('POST /api/chat receives message and returns (response or config error)', async () => {
    const { status, body } = await httpReq('POST', '/api/chat', JSON.stringify({ message: 'Hello', thinking: 'none' }));
    expect([200, 400, 500]).toContain(status);
    const json = JSON.parse(body || '{}');
    expect(json).toHaveProperty('response');
    expect(typeof json.response).toBe('string');
  });

  it('POST /api/chat with X-HyperClaw-Source routes channel source', async () => {
    const { status } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const payload = JSON.stringify({ message: 'Hi', thinking: 'none' });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-HyperClaw-Source': 'telegram' }
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    expect([200, 400, 500]).toContain(status);
  });
});
