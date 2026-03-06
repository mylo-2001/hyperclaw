/**
 * tests/e2e/bot.test.ts
 * E2E — bot command flow: command parsing, gateway integration, /restart path
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GatewayServer, GatewayConfig } from '../../src/gateway/server';

const port = 19792;

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

describe('Bot integration: gateway endpoints', () => {
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

  it('GET /api/status returns 200 for bot /status', async () => {
    const { status, body } = await httpReq('GET', '/api/status');
    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json).toHaveProperty('running', true);
    expect(json).toHaveProperty('port', port);
  });

  it('POST /api/remote/restart returns 200 with accepted/restarted fields', async () => {
    const { status, body } = await httpReq('POST', '/api/remote/restart');
    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json).toHaveProperty('accepted', true);
    expect(json).toHaveProperty('message');
    // restarted: true when daemon mode; undefined/false otherwise
    if (json.restarted !== undefined) expect(typeof json.restarted).toBe('boolean');
  });

  it('POST /api/restart returns 404 (legacy path not exposed)', async () => {
    const { status } = await httpReq('POST', '/api/restart');
    expect(status).toBe(404);
  });
});

describe('Bot module exports', () => {
  it('loads TelegramHyperClawBot and DiscordHyperClawBot', async () => {
    const bot = await import('../../src/bot/hyperclawbot');
    expect(bot.TelegramHyperClawBot).toBeDefined();
    expect(bot.DiscordHyperClawBot).toBeDefined();
    expect(bot.loadBotConfig).toBeDefined();
    expect(bot.stopBotProcess).toBeDefined();
  });
});
