/**
 * tests/unit/gateway-config-rpc.test.ts
 * Unit tests — Config RPC rate limiter + trustedProxies IP resolution
 */
import { describe, it, expect } from 'vitest';

// We test the pure logic by importing and calling private methods via prototype access.
// The GatewayServer is instantiated minimally.

import { GatewayServer } from '../../packages/gateway/src/server';

function makeMinimalServer(): GatewayServer {
  return new GatewayServer({
    port: 19999,
    bind: '127.0.0.1',
    authToken: 'test-token',
    runtime: 'node',
    enabledChannels: [],
    hooks: false,
    trustedProxies: [],
    deps: {
      getHyperClawDir: () => '/tmp/.hyperclaw-test',
      getConfigPath: () => '/tmp/.hyperclaw-test/hyperclaw.json',
      resolveGatewayToken: (t: string) => t,
      createSessionStore: async () => null as any,
      startChannelRunners: async () => ({ stop: async () => {} }),
      runAgentEngine: async () => ({ text: '' }),
      createPiRPCHandler: () => async () => ({}),
    }
  });
}

describe('Config RPC rate limiter', () => {
  it('allows first 3 requests within window', () => {
    const server = makeMinimalServer();
    const check = (server as any).checkConfigRpcRateLimit.bind(server);
    expect(check('device:127.0.0.1').ok).toBe(true);
    expect(check('device:127.0.0.1').ok).toBe(true);
    expect(check('device:127.0.0.1').ok).toBe(true);
  });

  it('rejects 4th request in same window', () => {
    const server = makeMinimalServer();
    const check = (server as any).checkConfigRpcRateLimit.bind(server);
    check('dev2:127.0.0.1');
    check('dev2:127.0.0.1');
    check('dev2:127.0.0.1');
    const result = check('dev2:127.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates rate limits by key', () => {
    const server = makeMinimalServer();
    const check = (server as any).checkConfigRpcRateLimit.bind(server);
    // Fill up key A
    check('A:1.2.3.4');
    check('A:1.2.3.4');
    check('A:1.2.3.4');
    // Key B should still be free
    expect(check('B:1.2.3.4').ok).toBe(true);
  });
});

describe('trustedProxies IP resolution', () => {
  it('returns socket IP when no trusted proxies configured', () => {
    const server = makeMinimalServer();
    const resolve = (server as any).resolveClientIp.bind(server);
    const fakeReq = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '1.2.3.4' }
    };
    expect(resolve(fakeReq)).toBe('10.0.0.1');
  });

  it('uses X-Forwarded-For when socket IP is trusted proxy', () => {
    const server = new GatewayServer({
      port: 19999,
      bind: '127.0.0.1',
      authToken: 'test',
      runtime: 'node',
      enabledChannels: [],
      hooks: false,
      trustedProxies: ['10.0.0.1'],
      deps: {
        getHyperClawDir: () => '/tmp/.hyperclaw-test',
        getConfigPath: () => '/tmp/.hyperclaw-test/hyperclaw.json',
        resolveGatewayToken: (t: string) => t,
        createSessionStore: async () => null as any,
        startChannelRunners: async () => ({ stop: async () => {} }),
        runAgentEngine: async () => ({ text: '' }),
        createPiRPCHandler: () => async () => ({}),
      }
    });

    const resolve = (server as any).resolveClientIp.bind(server);
    const fakeReq = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }
    };
    expect(resolve(fakeReq)).toBe('5.6.7.8');
  });

  it('does not trust XFF from non-trusted socket IP', () => {
    const server = new GatewayServer({
      port: 19999,
      bind: '127.0.0.1',
      authToken: 'test',
      runtime: 'node',
      enabledChannels: [],
      hooks: false,
      trustedProxies: ['10.0.0.1'],
      deps: {
        getHyperClawDir: () => '/tmp/.hyperclaw-test',
        getConfigPath: () => '/tmp/.hyperclaw-test/hyperclaw.json',
        resolveGatewayToken: (t: string) => t,
        createSessionStore: async () => null as any,
        startChannelRunners: async () => ({ stop: async () => {} }),
        runAgentEngine: async () => ({ text: '' }),
        createPiRPCHandler: () => async () => ({}),
      }
    });

    const resolve = (server as any).resolveClientIp.bind(server);
    const fakeReq = {
      socket: { remoteAddress: '9.9.9.9' }, // NOT a trusted proxy
      headers: { 'x-forwarded-for': '1.2.3.4' }
    };
    expect(resolve(fakeReq)).toBe('9.9.9.9');
  });
});
