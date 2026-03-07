# Channel Routing

HyperClaw routes replies back to the channel where a message came from. The model does not choose a channel; routing is **deterministic** and controlled by the host configuration.

---

## Key Terms

| Term | Description |
|------|-------------|
| **Channel** | `whatsapp`, `telegram`, `discord`, `slack`, `signal`, `imessage`, `webchat` |
| **AccountId** | Per-channel account instance (when multi-account is supported) |
| **AgentId** | Isolated workspace + session store ("brain") |
| **SessionKey** | The bucket key used to store context and control concurrency |

**Optional channel default account:** `channels.<channel>.defaultAccount` chooses which account is used when an outbound path does not specify `accountId`. In multi-account setups, set an explicit default when two or more accounts are configured.

---

## Session Key Shapes

Direct messages collapse to the agent's main session:
```
agent:<agentId>:<mainKey>          (default: agent:main:main)
```

Groups and channels remain isolated per chat:
```
agent:<agentId>:<channel>:group:<id>
agent:<agentId>:<channel>:channel:<id>
```

Threads:
```
agent:<agentId>:<channel>:channel:<id>:thread:<threadId>    (Slack/Discord)
agent:<agentId>:<channel>:group:<id>:topic:<topicId>        (Telegram forum)
```

Examples:
```
agent:main:telegram:group:-1001234567890:topic:42
agent:main:discord:channel:123456:thread:987654
```

---

## Routing Rules

Routing picks one agent for each inbound message (first match wins):

| Priority | Rule |
|----------|------|
| 1 | Exact peer match (`match.peer.kind` + `match.peer.id`) |
| 2 | Parent peer match (thread inheritance) |
| 3 | Guild + roles match (Discord) via `guildId` + `roles` |
| 4 | Guild match (Discord) via `guildId` |
| 5 | Team match (Slack) via `teamId` |
| 6 | Account match via `accountId` |
| 7 | Channel match (any account on that channel) |
| 8 | Default agent (`agents.list[].default`, else first list entry, fallback to `main`) |

When a binding includes multiple match fields (`peer`, `guildId`, `teamId`, `roles`), all provided fields **must match** for that binding to apply.

---

## Broadcast Groups

Broadcast groups let you run multiple agents for the same peer when HyperClaw would normally reply.

```jsonc
{
  "broadcast": {
    "strategy": "parallel",
    "120363403215116621@g.us": ["alfred", "baerbel"],
    "+15555550123": ["support", "logger"]
  }
}
```

See: [Broadcast Groups](./broadcast-groups.md)

**Precedence:** `broadcast` takes priority over `bindings`.

---

## Config Overview

```jsonc
{
  "agents": {
    "list": [
      { "id": "support", "name": "Support", "workspace": "~/.hyperclaw/workspace-support" }
    ]
  },
  "bindings": [
    { "match": { "channel": "slack", "teamId": "T123" }, "agentId": "support" },
    {
      "match": { "channel": "telegram", "peer": { "kind": "group", "id": "-100123" } },
      "agentId": "support"
    }
  ]
}
```

---

## Binding Examples

### Route specific WhatsApp group to a specific agent

```jsonc
{
  "bindings": [
    {
      "match": {
        "channel": "whatsapp",
        "peer": { "kind": "group", "id": "120363403215116621@g.us" }
      },
      "agentId": "dev-team"
    }
  ]
}
```

### Route all Slack traffic to a support agent

```jsonc
{
  "bindings": [
    { "match": { "channel": "slack" }, "agentId": "support" }
  ]
}
```

### Route a specific Slack workspace to a dedicated agent

```jsonc
{
  "bindings": [
    { "match": { "channel": "slack", "teamId": "T04ABC123" }, "agentId": "enterprise-bot" }
  ]
}
```

### Discord: route by guild + role

```jsonc
{
  "bindings": [
    {
      "match": {
        "channel": "discord",
        "guildId": "987654321",
        "roles": ["admin", "moderator"]
      },
      "agentId": "admin-agent"
    },
    {
      "match": { "channel": "discord", "guildId": "987654321" },
      "agentId": "public-agent"
    }
  ]
}
```

### Multi-account: route each account to a different agent

```jsonc
{
  "bindings": [
    { "match": { "channel": "telegram", "accountId": "sales-bot" }, "agentId": "sales" },
    { "match": { "channel": "telegram", "accountId": "support-bot" }, "agentId": "support" }
  ]
}
```

---

## Main DM Route Pinning

When `session.dmScope` is `main`, direct messages may share one main session. To prevent the session's `lastRoute` from being overwritten by non-owner DMs, HyperClaw infers a pinned owner from `allowFrom` when all of these are true:

- `allowFrom` has exactly one non-wildcard entry
- The entry can be normalized to a concrete sender ID for that channel
- The inbound DM sender does not match that pinned owner

In that mismatch case, HyperClaw still records inbound session metadata, but skips updating the main session `lastRoute`.

---

## Session Storage

Session stores live under the state directory (default `~/.hyperclaw`):

```
~/.hyperclaw/agents/<agentId>/sessions/sessions.json
```

JSONL transcripts live alongside the store. Override the store path via `session.store` with `{agentId}` templating:

```jsonc
{ "session": { "store": "~/.hyperclaw/agents/{agentId}/sessions/sessions.json" } }
```

---

## WebChat Behavior

WebChat attaches to the selected agent and defaults to the agent's main session. This lets you see cross-channel context for that agent in one place.

---

## Reply Context

Inbound replies include:
- `ReplyToId`, `ReplyToBody`, and `ReplyToSender` when available
- Quoted context appended as a `[Replying to ...]` block

Consistent across all channels.

---

## Session Origin Metadata

Each session entry records where it came from (`origin`):

| Field | Description |
|-------|-------------|
| `label` | Human label (resolved from conversation label + group subject/channel) |
| `provider` | Normalized channel ID (including extensions) |
| `from`/`to` | Raw routing IDs from the inbound envelope |
| `accountId` | Provider account ID (multi-account) |
| `threadId` | Thread/topic ID when the channel supports it |
