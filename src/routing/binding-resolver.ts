/**
 * src/routing/binding-resolver.ts
 * Runtime binding resolution — picks which agent handles an inbound message.
 *
 * Routing priority (first match wins):
 *  1. Exact peer match (peer.kind + peer.id)
 *  2. Parent peer match (thread → parent group/channel)
 *  3. Guild + roles match (Discord) via guildId + roles
 *  4. Guild match (Discord) via guildId
 *  5. Team match (Slack) via teamId
 *  6. Account match via accountId
 *  7. Channel match (any account) via channel: "*"
 *  8. Default agent (agents.list[].default, else first list entry, fallback "main")
 *
 * If the top-level `broadcast` key has an entry for the peer, broadcast takes
 * precedence over bindings for multi-agent dispatch.
 */

import type { BindingRule, AgentListItem } from '../cli/config';

// ─── Inbound message context ──────────────────────────────────────────────────

export interface InboundContext {
  /** Channel name (e.g. "whatsapp", "telegram", "slack"). */
  channel: string;
  /** Account/bot ID on multi-account channels. */
  accountId?: string;
  /** Chat/peer ID: user ID for DMs, group JID for groups, channel ID for channels. */
  peerId: string;
  /** Chat type. */
  chatType: 'dm' | 'group' | 'channel';
  /** Thread/topic ID (Slack thread, Telegram topic, etc.). */
  threadId?: string;
  /** Discord guild/server ID. */
  guildId?: string;
  /** Slack workspace/team ID. */
  teamId?: string;
  /** Discord role IDs the sender has. */
  senderRoles?: string[];
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve which agentId should handle an inbound message.
 *
 * @param ctx      Inbound message context.
 * @param bindings The `bindings` array from config.
 * @param agents   The `agents.list` array from config (for default resolution).
 * @returns        agentId string, or "main" as the ultimate fallback.
 */
export function resolveBinding(
  ctx: InboundContext,
  bindings: BindingRule[] | undefined,
  agents: AgentListItem[] | undefined
): string {
  if (bindings && bindings.length > 0) {
    // ── Step 1: Exact peer match ─────────────────────────────────────────────
    const peerExact = bindings.find(
      (b) =>
        matchChannel(b, ctx) &&
        matchAccount(b, ctx) &&
        b.match.peer?.id === ctx.peerId
    );
    if (peerExact) return peerExact.agentId;

    // ── Step 2: Parent peer match (thread → parent) ──────────────────────────
    // Thread IDs are composed as parentId + ":thread:" + threadId
    if (ctx.threadId) {
      const parentId = ctx.peerId;
      const parentMatch = bindings.find(
        (b) =>
          matchChannel(b, ctx) &&
          matchAccount(b, ctx) &&
          b.match.peer?.id === parentId
      );
      if (parentMatch) return parentMatch.agentId;
    }

    // ── Step 3: Guild + roles match ──────────────────────────────────────────
    if (ctx.guildId && ctx.senderRoles && ctx.senderRoles.length > 0) {
      const guildRoles = bindings.find(
        (b) =>
          matchChannel(b, ctx) &&
          b.match.guildId === ctx.guildId &&
          b.match.roles &&
          b.match.roles.every((r) => ctx.senderRoles!.includes(r))
      );
      if (guildRoles) return guildRoles.agentId;
    }

    // ── Step 4: Guild match ──────────────────────────────────────────────────
    if (ctx.guildId) {
      const guildOnly = bindings.find(
        (b) =>
          matchChannel(b, ctx) &&
          b.match.guildId === ctx.guildId &&
          !b.match.roles
      );
      if (guildOnly) return guildOnly.agentId;
    }

    // ── Step 5: Team match ───────────────────────────────────────────────────
    if (ctx.teamId) {
      const team = bindings.find(
        (b) => matchChannel(b, ctx) && b.match.teamId === ctx.teamId
      );
      if (team) return team.agentId;
    }

    // ── Step 6: Account match ────────────────────────────────────────────────
    if (ctx.accountId) {
      const account = bindings.find(
        (b) =>
          matchChannel(b, ctx) &&
          b.match.accountId === ctx.accountId &&
          !b.match.peer
      );
      if (account) return account.agentId;
    }

    // ── Step 7: Channel-only match ───────────────────────────────────────────
    const channelOnly = bindings.find(
      (b) =>
        b.match.channel === ctx.channel &&
        !b.match.peer &&
        !b.match.accountId &&
        !b.match.guildId &&
        !b.match.teamId
    );
    if (channelOnly) return channelOnly.agentId;

    // Wildcard channel
    const wildcard = bindings.find(
      (b) =>
        b.match.channel === '*' &&
        !b.match.peer &&
        !b.match.guildId &&
        !b.match.teamId
    );
    if (wildcard) return wildcard.agentId;
  }

  // ── Step 8: Default agent ──────────────────────────────────────────────────
  return resolveDefaultAgent(agents);
}

/** Resolve the default agentId from agents.list. */
export function resolveDefaultAgent(agents: AgentListItem[] | undefined): string {
  if (!agents || agents.length === 0) return 'main';
  const defaultAgent = agents.find((a) => a.default);
  if (defaultAgent) return defaultAgent.id;
  return agents[0].id;
}

// ─── Match helpers ────────────────────────────────────────────────────────────

function matchChannel(binding: BindingRule, ctx: InboundContext): boolean {
  const ch = binding.match.channel;
  return !ch || ch === '*' || ch === ctx.channel;
}

function matchAccount(binding: BindingRule, ctx: InboundContext): boolean {
  const acc = binding.match.accountId;
  return !acc || acc === '*' || acc === ctx.accountId;
}

// ─── Config extraction helpers ────────────────────────────────────────────────

/** Extract bindings array from raw config (tolerates untyped config objects). */
export function extractBindings(cfg: any): BindingRule[] {
  if (!cfg || !Array.isArray(cfg.bindings)) return [];
  return cfg.bindings as BindingRule[];
}

/** Extract agents list from raw config. */
export function extractAgentsList(cfg: any): AgentListItem[] {
  if (!cfg?.agents?.list || !Array.isArray(cfg.agents.list)) return [];
  return cfg.agents.list as AgentListItem[];
}

/** Build InboundContext from the message envelope emitted by a connector. */
export function buildInboundContext(msg: {
  chatId: string | number;
  from?: string;
  isDM?: boolean;
  isGroup?: boolean;
  channelId?: string;
  accountId?: string;
  threadId?: string;
  guildId?: string;
  teamId?: string;
  senderRoles?: string[];
}, channelId: string): InboundContext {
  const peerId = String(msg.chatId);
  const chatType: 'dm' | 'group' | 'channel' =
    msg.isDM ? 'dm' : msg.isGroup ? 'group' : 'channel';

  return {
    channel: channelId,
    accountId: msg.accountId,
    peerId,
    chatType,
    threadId: msg.threadId,
    guildId: msg.guildId,
    teamId: msg.teamId,
    senderRoles: msg.senderRoles
  };
}
