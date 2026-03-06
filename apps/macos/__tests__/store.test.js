/**
 * Electron app store logic tests.
 * Mocks electron-store since it requires Electron runtime.
 */
const { describe, it, expect, vi, beforeEach } = require('vitest');

const mockData = {};
const mockStore = {
  get: vi.fn((key, def) => (key in mockData ? mockData[key] : def)),
  set: vi.fn((key, val) => { mockData[key] = val; })
};

vi.mock('electron-store', () => ({
  default: vi.fn(() => mockStore)
}));

// Load store after mock
const store = require('../store');

describe('store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockData).forEach(k => delete mockData[k]);
  });

  describe('getGatewayUrl', () => {
    it('returns default when empty', () => {
      expect(store.getGatewayUrl()).toBe('http://localhost:18789');
    });
    it('strips trailing slash', () => {
      store.set('gatewayUrl', 'http://localhost:18789/');
      expect(store.getGatewayUrl()).toBe('http://localhost:18789');
    });
    it('returns stored value', () => {
      store.set('gatewayUrl', 'http://192.168.1.1:9999');
      expect(store.getGatewayUrl()).toBe('http://192.168.1.1:9999');
    });
  });

  describe('getWsUrl', () => {
    it('converts http to ws', () => {
      store.set('gatewayUrl', 'http://localhost:18789');
      expect(store.getWsUrl()).toBe('ws://localhost:18789');
    });
    it('converts https to wss', () => {
      store.set('gatewayUrl', 'https://example.com:443');
      expect(store.getWsUrl()).toBe('wss://example.com:443');
    });
  });

  describe('getChatMessages / appendChatMessage', () => {
    it('starts empty', () => {
      expect(store.getChatMessages()).toEqual([]);
    });
    it('appends and retrieves messages', () => {
      store.appendChatMessage({ role: 'user', content: 'hi' });
      store.appendChatMessage({ role: 'assistant', content: 'hello' });
      const msgs = store.getChatMessages();
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toEqual({ role: 'user', content: 'hi' });
      expect(msgs[1]).toEqual({ role: 'assistant', content: 'hello' });
    });
  });
});
