/**
 * tests/e2e/gateway-critical.test.ts
 * E2E — critical paths: status, chat, dashboard
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GatewayServer, GatewayConfig } from '../../src/gateway/server';

const port = 19791;

async function httpReq(method: string, path: string, body?: string): Promise<{ status: number; headers: any; body: string }> {
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
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let server: GatewayServer;

describe('Gateway critical paths', () => {
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

  it('GET /api/status returns 200', async () => {
    const { status } = await httpReq('GET', '/api/status');
    expect(status).toBe(200);
  });

  it('GET /dashboard returns HTML', async () => {
    const { status, headers } = await httpReq('GET', '/dashboard');
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/html/);
  });

  it('GET /chat returns HTML', async () => {
    const { status, headers } = await httpReq('GET', '/chat');
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/html/);
  });

  it('GET / redirects to dashboard', async () => {
    const { status, headers } = await httpReq('GET', '/');
    expect(status).toBe(302);
    expect(headers.location).toBe('/dashboard');
  });
});
