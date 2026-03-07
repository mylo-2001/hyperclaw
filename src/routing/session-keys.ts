/**
 * src/routing/session-keys.ts
 * Session key construction for all dmScope values.
 *
 * Key shapes:
 *   main (default):              agent:<agentId>:<mainKey>
 *   per-peer:                    agent:<agentId>:dm:<peerId>
 *   per-channel-peer:            agent:<agentId>:<channel>:dm:<peerId>
 *   per-account-channel-peer:    agent:<agentId>:<channel>:<accountId>:dm:<peerId>
 *
 * Group sessions always isolate per-peer regardless of dmScope:
 *   group:                       agent:<agentId>:<channel>:group:<peerId>
 *   channel/room:                agent:<agentId>:<channel>:channel:<peerId>
 *   thread (Slack/Discord):      agent:<agentId>:<channel>:channel:<peerId>:thread:<threadId>
 *   Telegram topic:              agent:<agentId>:<channel>:group:<peerId>:topic:<threadId>
 *   Cron:                        cron:<jobId>
 *   Webhook:                     hook:<uuid>
 */

import type { DmScope } from '../cli/config';

// ─── Build ────────────────────────────────────────────────────────────────────

export interface SessionKeyOpts {
  agentId: string;
  channel: string;
  chatType: 'dm' | 'group' | 'channel';
  peerId: string;
  accountId?: string;
  threadId?: string;
  dmScope?: DmScope;
  mainKey?: string;
  /** Canonical identity link (replaces peerId in DM keys). */
  canonicalPeerId?: string;
}

/**
 * Build a session key based on the chat type and dmScope setting.
 */
export function buildSessionKey(opts: SessionKeyOpts): string {
  const {
    agentId,
    channel,
    chatType,
    peerId,
    accountId = 'default',
    threadId,
    dmScope = 'main',
    mainKey = 'main'
  } = opts;

  const effectivePeerId = opts.canonicalPeerId || peerId;

  // Group sessions always get their own key regardless of dmScope
  if (chatType === 'group') {
    const base = `agent:${agentId}:${channel}:group:${effectivePeerId}`;
    // Telegram topic threads
    if (threadId) return `${base}:topic:${threadId}`;
    return base;
  }

  if (chatType === 'channel') {
    const base = `agent:${agentId}:${channel}:channel:${effectivePeerId}`;
    // Slack/Discord thread sessions
    if (threadId) return `${base}:thread:${threadId}`;
    return base;
  }

  // DM — apply dmScope
  switch (dmScope) {
    case 'main':
      // All DMs collapse to the agent's main session
      return `agent:${agentId}:${mainKey}`;

    case 'per-peer':
      return `agent:${agentId}:dm:${effectivePeerId}`;

    case 'per-channel-peer':
      return `agent:${agentId}:${channel}:dm:${effectivePeerId}`;

    case 'per-account-channel-peer':
      return `agent:${agentId}:${channel}:${accountId}:dm:${effectivePeerId}`;

    default:
      return `agent:${agentId}:${mainKey}`;
  }
}

// ─── Identity link resolution ─────────────────────────────────────────────────

/**
 * Resolve a provider-prefixed peer ID to a canonical identity if a link exists.
 *
 * identityLinks shape:
 * {
 *   "alice": ["telegram:123456789", "discord:987654321012345678"]
 * }
 *
 * Returns the canonical identity key if found, otherwise returns the raw peerId.
 */
export function resolveIdentityLink(
  channel: string,
  peerId: string,
  identityLinks: Record<string, string[]> | undefined
): string {
  if (!identityLinks) return peerId;
  const providerPeerId = `${channel}:${peerId}`;
  for (const [canonical, links] of Object.entries(identityLinks)) {
    if (links.includes(providerPeerId)) return canonical;
  }
  return peerId;
}

// ─── Special key builders ─────────────────────────────────────────────────────

/** Session key for a cron job. */
export function cronSessionKey(jobId: string): string {
  return `cron:${jobId}`;
}

/** Session key for a webhook run. */
export function hookSessionKey(uuid: string): string {
  return `hook:${uuid}`;
}

/** Session key for a node run. */
export function nodeSessionKey(nodeId: string): string {
  return `node-${nodeId}`;
}

// ─── Config extraction ────────────────────────────────────────────────────────

/** Extract session config from raw config object. */
export function extractSessionConfig(cfg: any): {
  dmScope: DmScope;
  mainKey: string;
  identityLinks: Record<string, string[]>;
} {
  const session = cfg?.session || {};
  return {
    dmScope: (session.dmScope as DmScope) || 'main',
    mainKey: session.mainKey || 'main',
    identityLinks: session.identityLinks || {}
  };
}
