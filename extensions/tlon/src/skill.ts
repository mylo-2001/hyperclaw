/**
 * extensions/tlon/src/skill.ts
 * Bundled Tlon skill — provides CLI access to Tlon operations via agent tools.
 *
 * Available slash commands (owner-only by default):
 *   /tlon contacts list
 *   /tlon contacts get ~ship
 *   /tlon channels list
 *   /tlon channels post <nest> <message>
 *   /tlon channels history <nest> [limit]
 *   /tlon groups list
 *   /tlon groups members <group-ref>
 *   /tlon dms send ~ship <message>
 *   /tlon react <nest> <postId> <emoji>
 *   /tlon unreact <nest> <postId> <emoji>
 *   /tlon pairing list
 *   /tlon pairing approve <code>
 */

import { TlonConnector } from './connector';

export interface TlonSkillContext {
  connector: TlonConnector;
  ownerShip: string;
  sender: string;
  reply: (text: string) => Promise<void>;
}

export async function handleTlonSkillCommand(
  command: string,
  ctx: TlonSkillContext
): Promise<boolean> {
  const { connector, ownerShip, sender, reply } = ctx;

  // Owner-only check for management commands
  const isOwner = !ownerShip || sender === ownerShip;

  const args = command.trim().split(/\s+/);
  const [, sub, ...rest] = args; // args[0] = '/tlon'

  switch (sub) {
    case 'pairing': {
      if (!isOwner) { await reply('🦅 Owner only.'); return true; }
      if (rest[0] === 'list') {
        const pending = connector.listPendingPairings();
        const entries = Object.entries(pending);
        if (entries.length === 0) {
          await reply('No pending pairing requests.');
        } else {
          const lines = entries.map(([code, ship]) => `  ${code} → ${ship}`).join('\n');
          await reply(`Pending pairings:\n${lines}`);
        }
        return true;
      }
      if (rest[0] === 'approve' && rest[1]) {
        const ok = connector.approvePairing(rest[1]);
        await reply(ok ? `✅ Approved code ${rest[1].toUpperCase()}` : `❌ Code not found or expired`);
        return true;
      }
      break;
    }

    case 'channels': {
      if (rest[0] === 'list') {
        const ch = connector.getKnownChannels();
        await reply(ch.length ? `Channels:\n${ch.map(c => `  ${c}`).join('\n')}` : 'No channels discovered yet.');
        return true;
      }
      if (rest[0] === 'post' && rest[1] && rest.slice(2).length) {
        const nest = rest[1];
        const msg = rest.slice(2).join(' ');
        await connector.sendToNest(nest, msg);
        await reply(`✅ Sent to ${nest}`);
        return true;
      }
      break;
    }

    case 'dms': {
      if (rest[0] === 'send' && rest[1] && rest.slice(2).length) {
        const ship = rest[1];
        const msg = rest.slice(2).join(' ');
        await connector.sendDM(ship, msg);
        await reply(`✅ DM sent to ${ship}`);
        return true;
      }
      break;
    }

    case 'react': {
      if (!isOwner) { await reply('🦅 Owner only.'); return true; }
      if (rest.length >= 3) {
        const [nest, postId, emoji] = rest;
        await connector.addReaction(nest, postId, emoji);
        await reply(`✅ Reacted ${emoji} on ${postId}`);
        return true;
      }
      break;
    }

    case 'unreact': {
      if (!isOwner) { await reply('🦅 Owner only.'); return true; }
      if (rest.length >= 3) {
        const [nest, postId, emoji] = rest;
        await connector.removeReaction(nest, postId, emoji);
        await reply(`✅ Removed reaction ${emoji} from ${postId}`);
        return true;
      }
      break;
    }

    case 'ships': {
      const approved = connector.getApprovedShips();
      await reply(approved.length
        ? `Approved ships:\n${approved.map(s => `  ${s}`).join('\n')}`
        : 'No approved ships yet.');
      return true;
    }
  }

  // Unknown/incomplete command — show help
  await reply(
    `🌊 **Tlon Skill Commands**\n` +
    `  /tlon channels list\n` +
    `  /tlon channels post <nest> <message>\n` +
    `  /tlon dms send ~ship <message>\n` +
    `  /tlon react <nest> <postId> <emoji>\n` +
    `  /tlon unreact <nest> <postId> <emoji>\n` +
    `  /tlon pairing list\n` +
    `  /tlon pairing approve <code>\n` +
    `  /tlon ships`
  );
  return true;
}
