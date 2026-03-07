/**
 * src/routing/broadcast.ts
 * Broadcast group resolution and dispatch.
 *
 * Broadcast groups let multiple agents process the same inbound message
 * simultaneously (or sequentially). Evaluated after channel allowlists and
 * group activation rules — agents only run when HyperClaw would normally reply.
 *
 * Current scope: WhatsApp (web channel). Telegram/Discord/Slack planned.
 *
 * Config shape (top-level broadcast key):
 * {
 *   broadcast: {
 *     strategy: "parallel",
 *     "120363403215116621@g.us": ["alfred", "baerbel"],
 *     "+15555550123": ["support", "logger"],
 *   }
 * }
 */

import type { BroadcastConfig } from '../cli/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BroadcastTarget {
  agentIds: string[];
  strategy: 'parallel' | 'sequential';
}

/**
 * Context for one agent's dispatch call.
 * Passed to the send function so the caller can route to the right agent.
 */
export interface BroadcastDispatchOpts {
  agentId: string;
  peerId: string;
  sessionKey: string;
  channel: string;
}

/**
 * A function that sends a message to the agent engine and returns its response.
 * Implementations may call postChat or invoke the engine directly.
 */
export type AgentSendFn = (
  message: string,
  opts: BroadcastDispatchOpts
) => Promise<string>;

/**
 * A function that delivers a reply back to the channel peer.
 */
export type ReplyFn = (
  peerId: string,
  agentId: string,
  response: string
) => Promise<void>;

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Check whether `peerId` is in the broadcast config.
 * Returns the list of agent IDs and strategy, or null if not found.
 *
 * @param peerId WhatsApp JID, E.164 number, or other peer ID
 * @param cfg    The top-level `broadcast` config block
 */
export function resolveBroadcast(
  peerId: string,
  cfg: BroadcastConfig | undefined | null
): BroadcastTarget | null {
  if (!cfg) return null;

  const strategy: 'parallel' | 'sequential' =
    cfg.strategy === 'sequential' ? 'sequential' : 'parallel';

  const agentIds = cfg[peerId];
  if (!Array.isArray(agentIds) || agentIds.length === 0) return null;

  return { agentIds, strategy };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Dispatch an inbound message to all agents in a broadcast group.
 *
 * - Parallel (default): all agents are invoked concurrently.
 * - Sequential: agents run in array order; each waits for the previous.
 *
 * Agents fail independently — one failure does not stop others.
 *
 * @param message   Raw inbound text to send to each agent.
 * @param peerId    Peer ID the message arrived in.
 * @param channel   Channel name (e.g. "whatsapp").
 * @param target    Resolved broadcast target (agentIds + strategy).
 * @param sendFn    Sends the message to one agent and returns its text response.
 * @param replyFn   Delivers the agent's response back to the peer.
 * @returns         Map of agentId → response (or error string).
 */
export async function dispatchBroadcast(
  message: string,
  peerId: string,
  channel: string,
  target: BroadcastTarget,
  sendFn: AgentSendFn,
  replyFn: ReplyFn
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  const runAgent = async (agentId: string): Promise<void> => {
    const sessionKey = buildBroadcastSessionKey(agentId, channel, peerId);
    try {
      const response = await sendFn(message, { agentId, peerId, sessionKey, channel });
      results.set(agentId, response);
      if (response) {
        await replyFn(peerId, agentId, response).catch((e: any) =>
          console.error(`[broadcast] reply failed for agent "${agentId}": ${e.message}`)
        );
      }
    } catch (e: any) {
      const errMsg = `Error (${agentId}): ${e.message}`;
      results.set(agentId, errMsg);
      console.error(`[broadcast] agent "${agentId}" failed: ${e.message}`);
    }
  };

  if (target.strategy === 'sequential') {
    for (const agentId of target.agentIds) {
      await runAgent(agentId);
    }
  } else {
    await Promise.all(target.agentIds.map(runAgent));
  }

  return results;
}

// ─── Session key helpers ──────────────────────────────────────────────────────

/**
 * Build a broadcast session key for one agent in a group.
 *
 * Format: agent:<agentId>:<channel>:group:<peerId>
 * For DMs:    agent:<agentId>:<channel>:dm:<peerId>
 */
export function buildBroadcastSessionKey(
  agentId: string,
  channel: string,
  peerId: string
): string {
  const isDM = peerId.startsWith('+') || /^\d+$/.test(peerId);
  const chatType = isDM ? 'dm' : 'group';
  return `agent:${agentId}:${channel}:${chatType}:${peerId}`;
}

// ─── Config extraction ────────────────────────────────────────────────────────

/**
 * Extract the broadcast config from the full app config object.
 * Accepts any config shape (config may not be typed at call sites).
 */
export function extractBroadcastConfig(cfg: any): BroadcastConfig | null {
  if (!cfg || typeof cfg !== 'object') return null;
  const b = cfg.broadcast;
  if (!b || typeof b !== 'object') return null;
  return b as BroadcastConfig;
}
