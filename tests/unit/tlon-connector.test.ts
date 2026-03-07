/**
 * tests/unit/tlon-connector.test.ts
 * Unit tests — Tlon (Urbit Groups) connector
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    readJson: vi.fn().mockRejectedValue(new Error('no file')),
    writeJson: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
  }
}));

import { TlonConnector } from '../../extensions/tlon/src/connector';

describe('TlonConnector', () => {
  describe('SSRF guard', () => {
    it('throws on private IP when allowPrivateNetwork is false', () => {
      const connector = new TlonConnector({
        ship: '~sampel-palnet',
        url: 'http://192.168.1.1:8080',
        code: 'abc',
        allowPrivateNetwork: false,
      });
      // connect() is async and will hit the SSRF guard first
      return expect(connector.connect()).rejects.toThrow('private');
    });

    it('throws on localhost when allowPrivateNetwork is false', () => {
      const connector = new TlonConnector({
        ship: '~sampel-palnet',
        url: 'http://localhost:8080',
        code: 'abc',
        allowPrivateNetwork: false,
      });
      return expect(connector.connect()).rejects.toThrow('private');
    });

    it('does not throw SSRF error when allowPrivateNetwork is true (will fail on login instead)', async () => {
      const connector = new TlonConnector({
        ship: '~sampel-palnet',
        url: 'http://localhost:8080',
        code: 'abc',
        allowPrivateNetwork: true,
      });
      // Should get past SSRF check but fail on login attempt
      await expect(connector.connect()).rejects.not.toThrow('private');
    });
  });

  describe('pairing management', () => {
    let connector: TlonConnector;

    beforeEach(() => {
      connector = new TlonConnector({
        ship: '~sampel-palnet',
        url: 'https://sampel-palnet.tlon.network',
        code: 'abc',
      });
    });

    it('approvePairing returns false for unknown code', () => {
      expect(connector.approvePairing('BADCODE')).toBe(false);
    });

    it('listPendingPairings returns empty object initially', () => {
      const pending = connector.listPendingPairings();
      expect(typeof pending).toBe('object');
      expect(Object.keys(pending)).toHaveLength(0);
    });

    it('getKnownChannels returns array', () => {
      const channels = connector.getKnownChannels();
      expect(Array.isArray(channels)).toBe(true);
    });

    it('getApprovedShips returns array', () => {
      const ships = connector.getApprovedShips();
      expect(Array.isArray(ships)).toBe(true);
    });

    it('isRunning is false before connect', () => {
      expect(connector.isRunning()).toBe(false);
    });
  });

  describe('delivery targets', () => {
    it('sendToTarget resolves ~ship as DM', async () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
      });
      // sendDM will fail (not connected) but we test routing logic via type
      const sendDMSpy = vi.spyOn(connector, 'sendDM').mockResolvedValue(undefined);
      await connector.sendToTarget('~nec', 'hello');
      expect(sendDMSpy).toHaveBeenCalledWith('~nec', 'hello');
    });

    it('sendToTarget resolves dm/~ship as DM', async () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
      });
      const sendDMSpy = vi.spyOn(connector, 'sendDM').mockResolvedValue(undefined);
      await connector.sendToTarget('dm/~nec', 'hello');
      expect(sendDMSpy).toHaveBeenCalledWith('~nec', 'hello');
    });

    it('sendToTarget resolves chat/~host/name as nest', async () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
      });
      const sendToNestSpy = vi.spyOn(connector, 'sendToNest').mockResolvedValue(undefined);
      await connector.sendToTarget('chat/~host/general', 'hello group');
      expect(sendToNestSpy).toHaveBeenCalledWith('chat/~host/general', 'hello group');
    });

    it('sendToTarget resolves group: prefix as nest', async () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
      });
      const sendToNestSpy = vi.spyOn(connector, 'sendToNest').mockResolvedValue(undefined);
      await connector.sendToTarget('group:~host/mygroup', 'announcement');
      expect(sendToNestSpy).toHaveBeenCalledWith('chat/~host/mygroup', 'announcement');
    });
  });

  describe('channel authorization', () => {
    it('ownerShip is always authorized', async () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
        ownerShip: '~owner',
        defaultAuthorizedShips: [],
      });
      // Access private method via any cast for testing
      const isAuth = (connector as any).isAuthorizedForChannel('~owner', 'chat/~host/general');
      expect(isAuth).toBe(true);
    });

    it('defaultAuthorizedShips grants access', () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
        defaultAuthorizedShips: ['~zod'],
      });
      const isAuth = (connector as any).isAuthorizedForChannel('~zod', 'chat/~host/general');
      expect(isAuth).toBe(true);
    });

    it('unknown ship is denied', () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
        defaultAuthorizedShips: ['~zod'],
      });
      const isAuth = (connector as any).isAuthorizedForChannel('~nec', 'chat/~host/general');
      expect(isAuth).toBe(false);
    });

    it('channel rule mode=open allows anyone', () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
        authorization: {
          channelRules: {
            'chat/~host/general': { mode: 'open' }
          }
        }
      });
      const isAuth = (connector as any).isAuthorizedForChannel('~stranger', 'chat/~host/general');
      expect(isAuth).toBe(true);
    });

    it('channel rule mode=restricted allows only listed ships', () => {
      const connector = new TlonConnector({
        ship: '~bot',
        url: 'https://bot.tlon.network',
        code: 'abc',
        authorization: {
          channelRules: {
            'chat/~host/private': { mode: 'restricted', allowedShips: ['~nec'] }
          }
        }
      });
      expect((connector as any).isAuthorizedForChannel('~nec', 'chat/~host/private')).toBe(true);
      expect((connector as any).isAuthorizedForChannel('~zod', 'chat/~host/private')).toBe(false);
    });
  });
});
