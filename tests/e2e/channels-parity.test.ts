/**
 * tests/e2e/channels-parity.test.ts
 * E2E — channel registry and runner parity with OpenClaw.
 * Verifies wired channels exist and webhook routes work.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GatewayServer, GatewayConfig } from '../../src/gateway/server';
import { CHANNELS, getChannel, getAvailableChannels } from '../../src/channels/registry';

const port = 19793;

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

describe('Channel registry parity', () => {
  const wiredChannels = [
    'telegram',
    'discord',
    'slack',
    'whatsapp',
    'whatsapp-baileys',
    'signal',
    'matrix',
    'nostr',
    'line',
    'feishu',
    'msteams',
    'teams',
    'bluebubbles',
    'imessage',
    'zalo',
    'zalo-personal',
    'instagram',
    'messenger',
    'twitter',
    'viber',
    'irc',
    'mattermost',
    'gchat',
    'email',
    'sms',
    'web',
    'cli',
    'chrome-extension',
    'voice-call'
  ];

  it('registry includes all wired channels', () => {
    for (const id of wiredChannels) {
      const ch = getChannel(id);
      expect(ch).toBeDefined();
      expect(ch!.id).toBe(id);
    }
  });

  it('registry includes instagram, messenger, twitter, viber, zalo-personal, chrome-extension, voice-call', () => {
    expect(getChannel('instagram')).toBeDefined();
    expect(getChannel('messenger')).toBeDefined();
    expect(getChannel('twitter')).toBeDefined();
    expect(getChannel('viber')).toBeDefined();
    expect(getChannel('zalo-personal')).toBeDefined();
    expect(getChannel('chrome-extension')).toBeDefined();
    expect(getChannel('voice-call')).toBeDefined();
  });

  it('getAvailableChannels returns platform-appropriate channels', () => {
    const available = getAvailableChannels();
    expect(available.length).toBeGreaterThan(0);
    expect(available.some(c => c.id === 'telegram')).toBe(true);
    expect(available.some(c => c.id === 'instagram')).toBe(true);
  });
});

describe('Channel runner with empty config', () => {
  it('startChannelRunners returns stop function when no channels enabled', async () => {
    const { startChannelRunners } = await import('../../src/channels/runner');
    const result = await startChannelRunners({ port: 18789, bind: '127.0.0.1' });
    expect(result.stop).toBeDefined();
    expect(typeof result.stop).toBe('function');
    await result.stop();
  });
});

describe('Webhook routes for wired channels', () => {
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

  it('GET /webhook/instagram returns 200 (verify endpoint exists)', async () => {
    const { status } = await httpReq('GET', '/webhook/instagram?hub.mode=subscribe&hub.verify_token=test&hub.challenge=challenge123');
    expect(status).toBe(200);
  });

  it('GET /webhook/messenger returns 200', async () => {
    const { status } = await httpReq('GET', '/webhook/messenger?hub.mode=subscribe&hub.verify_token=test&hub.challenge=ok');
    expect(status).toBe(200);
  });

  it('GET /webhook/twitter with crc_token returns 200', async () => {
    const { status } = await httpReq('GET', '/webhook/twitter?crc_token=test123');
    expect(status).toBe(200);
  });

  it('POST /webhook/viber returns 200', async () => {
    const { status } = await httpReq('POST', '/webhook/viber', '{}');
    expect(status).toBe(200);
  });

  it('POST /webhook/line returns 200', async () => {
    const { status } = await httpReq('POST', '/webhook/line', '{}');
    expect(status).toBe(200);
  });

  it('POST /webhook/slack returns 200', async () => {
    const { status } = await httpReq('POST', '/webhook/slack', '{}');
    expect(status).toBe(200);
  });
});
