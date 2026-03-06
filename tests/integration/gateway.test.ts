/**
 * tests/integration/gateway.test.ts
 * Integration tests — Gateway REST API (real HTTP server)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GatewayServer, GatewayConfig } from '../../src/gateway/server';
import type { GatewayDeps } from '../../packages/gateway/src/deps';

const TEST_PORT = 19789; // Use different port for tests
const TEST_TOKEN = 'test-token-abc123';

const mockDeps: GatewayDeps = {
  getHyperClawDir: () => '/tmp/hyperclaw-test',
  getConfigPath: () => '/tmp/hyperclaw-test/openclaw.json',
  resolveGatewayToken: () => TEST_TOKEN,
  createSessionStore: async () => null,
  startChannelRunners: async () => ({ stop: async () => {} }),
  runAgentEngine: async () => ({ text: 'ok' }),
  createPiRPCHandler: () => async () => ({}),
};

const config: GatewayConfig = {
  port: TEST_PORT,
  bind: '127.0.0.1',
  authToken: TEST_TOKEN,
  runtime: 'node',
  enabledChannels: ['telegram', 'discord'],
  hooks: false,
  deps: mockDeps,
};

let server: GatewayServer;

function httpGet(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${TEST_PORT}${path}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 0, body: data }); }
      });
    }).on('error', reject);
  });
}

beforeAll(async () => {
  server = new GatewayServer(config);
  await server.start();
}, 10000);

afterAll(async () => {
  await server.stop();
});

describe('Gateway REST API', () => {
  it('GET /api/status returns running status', async () => {
    const { status, body } = await httpGet('/api/status');
    expect(status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.port).toBe(TEST_PORT);
    expect(body.channels).toContain('telegram');
  });

  it('GET /api/status has sessions field', async () => {
    const { body } = await httpGet('/api/status');
    expect(typeof body.sessions).toBe('number');
    expect(body.sessions).toBe(0);
  });

  it('GET /unknown returns 404', async () => {
    const { status } = await httpGet('/not-found');
    expect(status).toBe(404);
  });

  it('should respond quickly (< 500ms)', async () => {
    const start = Date.now();
    await httpGet('/api/status');
    expect(Date.now() - start).toBeLessThan(500);
  });
});
