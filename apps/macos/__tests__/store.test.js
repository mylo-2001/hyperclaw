/**
 * Store logic tests — tested inline (no electron-store needed).
 * Uses vitest globals (no import needed — globals: true in vitest.config.js)
 */

// Inline the pure logic from store.js so we don't need electron-store at all
const DEFAULTS = {
  gatewayUrl: 'http://localhost:18789',
  authToken: '',
  launchAtLogin: false,
  notifications: true,
  chatMessages: [],
  lastSessionId: null
};

function makeStore() {
  const data = {};

  function get(key) {
    return key in data ? data[key] : DEFAULTS[key];
  }

  function set(key, val) {
    data[key] = val;
  }

  function getGatewayUrl() {
    const u = get('gatewayUrl') || DEFAULTS.gatewayUrl;
    return u.replace(/\/$/, '');
  }

  function getWsUrl() {
    return getGatewayUrl().replace(/^http/, 'ws');
  }

  function getChatMessages() {
    const msgs = get('chatMessages');
    return Array.isArray(msgs) ? msgs : [];
  }

  function appendChatMessage(msg) {
    const msgs = getChatMessages();
    msgs.push(msg);
    set('chatMessages', msgs.slice(-200));
  }

  return { get, set, getGatewayUrl, getWsUrl, getChatMessages, appendChatMessage };
}

describe('store', () => {
  let store;

  beforeEach(() => {
    store = makeStore();
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
    it('caps messages at 200', () => {
      for (let i = 0; i < 205; i++) {
        store.appendChatMessage({ role: 'user', content: `msg ${i}` });
      }
      expect(store.getChatMessages()).toHaveLength(200);
    });
  });
});
