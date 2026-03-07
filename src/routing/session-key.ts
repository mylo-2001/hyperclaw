/**
 * src/routing/session-key.ts
 * Session key computation — deterministic bucket keys for context storage.
 *
 * Key shapes:
 *   DMs:      agent:<agentId>:main
 *   Groups:   agent:<agentId>:<channel>:group:<id>
 *   Channels: agent:<agentId>:<channel>:channel:<id>
 *   + optional suffixes:
 *     Slack/Discord threads:    :thread:<threadId>
 *     Telegram forum topics:   :topic:<topicId>  (embedded in group key)
 *
 * Examples:
 *   agent:main:main
 *   agent:main:telegram:group:-1001234567890:topic:42
 *   agent:main:discord:channel:123456:thread:987654
 */

export interface SessionContext {
  agentId: string;
  channel: string;
  /** 'dm' | 'group' | 'channel' | 'room' */
  peerKind: 'dm' | 'group' | 'channel' | 'room';
  peerId: string;
  threadId?: string;
  topicId?: string;
  /** When true, DMs collapse to agent main session */
  dmScope?: 'main' | 'isolated';
}

/**
 * Compute the canonical session key for an inbound message context.
 */
export function computeSessionKey(ctx: SessionContext): string {
  const { agentId, channel, peerKind, peerId, threadId, topicId, dmScope } = ctx;

  if (peerKind === 'dm') {
    if (dmScope === 'main' || dmScope === undefined) {
      return `agent:${agentId}:main`;
    }
    // isolated DM: one session per sender
    return `agent:${agentId}:${channel}:dm:${peerId}`;
  }

  if (peerKind === 'group') {
    let key = `agent:${agentId}:${channel}:group:${peerId}`;
    if (topicId) key += `:topic:${topicId}`;
    if (threadId) key += `:thread:${threadId}`;
    return key;
  }

  // channel / room
  let key = `agent:${agentId}:${channel}:channel:${peerId}`;
  if (threadId) key += `:thread:${threadId}`;
  return key;
}

/**
 * Parse a session key back into its components (for debugging / display).
 */
export function parseSessionKey(key: string): Partial<SessionContext> & { raw: string } {
  const parts = key.split(':');
  // agent:<agentId>:main
  if (parts.length === 3 && parts[2] === 'main') {
    return { raw: key, agentId: parts[1], peerKind: 'dm' };
  }
  // agent:<agentId>:<channel>:<kind>:<peerId>[:<suffix>:<id>...]
  if (parts.length >= 5) {
    const agentId = parts[1];
    const channel = parts[2];
    const kind = parts[3] as 'dm' | 'group' | 'channel';
    const peerId = parts[4];
    const result: Partial<SessionContext> & { raw: string } = { raw: key, agentId, channel, peerKind: kind, peerId };
    for (let i = 5; i < parts.length - 1; i += 2) {
      if (parts[i] === 'topic') result.topicId = parts[i + 1];
      if (parts[i] === 'thread') result.threadId = parts[i + 1];
    }
    return result;
  }
  return { raw: key };
}
