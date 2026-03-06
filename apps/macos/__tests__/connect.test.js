/**
 * Connect flow logic tests — URL/token parsing, wsUrl derivation.
 */
const { describe, it, expect } = require('vitest');

function deriveWsUrl(baseUrl) {
  const u = (baseUrl || 'http://localhost:18789').replace(/\/$/, '');
  return u.replace(/^http/, 'ws').replace(/^https/, 'wss');
}

describe('connect flow', () => {
  it('derives ws from http', () => {
    expect(deriveWsUrl('http://localhost:18789')).toBe('ws://localhost:18789');
  });
  it('derives wss from https', () => {
    expect(deriveWsUrl('https://example.com:443')).toBe('wss://example.com:443');
  });
  it('strips trailing slash before convert', () => {
    expect(deriveWsUrl('http://localhost:18789/')).toBe('ws://localhost:18789');
  });
  it('defaults to localhost', () => {
    expect(deriveWsUrl('')).toBe('ws://localhost:18789');
  });
});
