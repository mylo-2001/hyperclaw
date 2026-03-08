# Session Management
---

<div align="center">

[← Memory](memory-integration.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Multi-Agent →](multi-agent.md)

</div>

---

HyperClaw treats one direct-chat session per agent as primary. Direct chats collapse to `agent:<agentId>:<mainKey>` (default `main`), while group/channel chats get their own keys.

---

## DM Scope

Use `session.dmScope` to control how direct messages are grouped:

| Value | Behaviour |
|-------|-----------|
| `main` (default) | All DMs share the main session for continuity |
| `per-peer` | Isolated by sender ID across channels |
| `per-channel-peer` | Isolated by channel + sender (recommended for multi-user inboxes) |
| `per-account-channel-peer` | Isolated by account + channel + sender (recommended for multi-account inboxes) |

Use `session.identityLinks` to map provider-prefixed peer IDs to a canonical identity so the same person shares a DM session across channels when using `per-peer`, `per-channel-peer`, or `per-account-channel-peer`.

---

## Secure DM Mode (Recommended for Multi-User Setups)

> **Security Warning:** If your agent can receive DMs from multiple people, you should strongly consider enabling secure DM mode. Without it, all users share the same conversation context, which can leak private information between users.

**Example of the problem with default settings:**
- Alice messages your agent about a private topic (e.g., a medical appointment)
- Bob messages your agent asking "What were we talking about?"
- Because both DMs share the same session, the model may answer Bob using Alice's prior context

**The fix:** Set `dmScope` to isolate sessions per user:

```jsonc
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

**When to enable this:**
- You have pairing approvals for more than one sender
- You use a DM allowlist with multiple entries
- You set `dmPolicy: "open"`
- Multiple phone numbers or accounts can message your agent

**Notes:**
- Default is `dmScope: "main"` for continuity (fine for single-user setups)
- For multi-account inboxes on the same channel, prefer `per-account-channel-peer`
- Use `session.identityLinks` to collapse a person's DM sessions across channels into one canonical identity

---

## Gateway is the Source of Truth

All session state is owned by the gateway. UI clients (macOS app, WebChat, etc.) must query the gateway for session lists and token counts.

In remote mode, the session store lives on the remote gateway host, not your Mac.

---

## Where State Lives

On the gateway host:
```
Store file:  ~/.hyperclaw/agents/<agentId>/sessions/sessions.json
Transcripts: ~/.hyperclaw/agents/<agentId>/sessions/<SessionId>.jsonl
```

- The store is a map `sessionKey → { sessionId, updatedAt, ... }`
- Deleting entries is safe; they are recreated on demand
- Group entries may include `displayName`, `channel`, `subject`, `room`, and `space`

---

## Session Maintenance

HyperClaw applies session-store maintenance to keep `sessions.json` and transcript artifacts bounded over time.

### Defaults

| Setting | Default |
|---------|---------|
| `session.maintenance.mode` | `warn` |
| `session.maintenance.pruneAfter` | `30d` |
| `session.maintenance.maxEntries` | `500` |
| `session.maintenance.rotateBytes` | `10mb` |
| `session.maintenance.resetArchiveRetention` | defaults to `pruneAfter` |
| `session.maintenance.maxDiskBytes` | unset (disabled) |
| `session.maintenance.highWaterBytes` | 80% of `maxDiskBytes` |

### How It Works

Maintenance runs during session-store writes, and can be triggered on demand with `hyperclaw sessions cleanup`.

- **`mode: "warn"`**: Reports what would be evicted but does not mutate entries/transcripts.
- **`mode: "enforce"`**: Applies cleanup in order:
  1. Prune stale entries older than `pruneAfter`
  2. Cap entry count to `maxEntries` (oldest first)
  3. Archive transcript files for removed entries
  4. Purge old `*.deleted.*` and `*.reset.*` archives by retention policy
  5. Rotate `sessions.json` when it exceeds `rotateBytes`
  6. If `maxDiskBytes` is set, enforce disk budget toward `highWaterBytes`

### Configuration Examples

**Conservative enforce policy:**
```jsonc
{
  "session": {
    "maintenance": {
      "mode": "enforce",
      "pruneAfter": "45d",
      "maxEntries": 800,
      "rotateBytes": "20mb",
      "resetArchiveRetention": "14d"
    }
  }
}
```

**Hard disk budget:**
```jsonc
{
  "session": {
    "maintenance": {
      "mode": "enforce",
      "maxDiskBytes": "1gb",
      "highWaterBytes": "800mb"
    }
  }
}
```

**Large installs:**
```jsonc
{
  "session": {
    "maintenance": {
      "mode": "enforce",
      "pruneAfter": "14d",
      "maxEntries": 2000,
      "rotateBytes": "25mb",
      "maxDiskBytes": "2gb",
      "highWaterBytes": "1.6gb"
    }
  }
}
```

**Preview or force maintenance:**
```bash
hyperclaw sessions cleanup --dry-run
hyperclaw sessions cleanup --enforce
```

---

## Session Lifecycle

**Reset policy:** Sessions are reused until they expire; expiry is evaluated on the next inbound message.

- **Daily reset:** Defaults to 4:00 AM local time on the gateway host
- **Idle reset (optional):** `idleMinutes` adds a sliding idle window; whichever expires first forces a new session
- **Per-type overrides:** `resetByType` lets you override the policy for `direct`, `group`, and `thread` sessions
- **Per-channel overrides:** `resetByChannel` overrides the reset policy for a channel (takes precedence over `reset`/`resetByType`)

**Reset triggers:** Exact `/new` or `/reset` (plus any extras in `resetTriggers`) start a fresh session.

---

## Send Policy

Block delivery for specific session types without listing individual IDs:

```jsonc
{
  "session": {
    "sendPolicy": {
      "rules": [
        { "action": "deny", "match": { "channel": "discord", "chatType": "group" } },
        { "action": "deny", "match": { "keyPrefix": "cron:" } },
        { "action": "deny", "match": { "rawKeyPrefix": "agent:main:discord:" } }
      ],
      "default": "allow"
    }
  }
}
```

**Runtime override (owner only):**
- `/send on` → allow for this session
- `/send off` → deny for this session
- `/send inherit` → clear override and use config rules

---

## Full Configuration Reference

```jsonc
{
  "session": {
    "dmScope": "per-channel-peer",
    "mainKey": "main",
    "identityLinks": {
      "alice": ["telegram:123456789", "discord:987654321012345678"]
    },
    "reset": {
      "mode": "daily",
      "atHour": 4,
      "idleMinutes": 120
    },
    "resetByType": {
      "thread": { "mode": "daily", "atHour": 4 },
      "direct": { "mode": "idle", "idleMinutes": 240 },
      "group":  { "mode": "idle", "idleMinutes": 120 }
    },
    "resetByChannel": {
      "discord": { "mode": "idle", "idleMinutes": 10080 }
    },
    "resetTriggers": ["/new", "/reset"],
    "store": "~/.hyperclaw/agents/{agentId}/sessions/sessions.json",
    "maintenance": {
      "mode": "enforce",
      "pruneAfter": "30d",
      "maxEntries": 500
    }
  }
}
```

---

## Session Key Mapping

| Chat type | dmScope | Key format |
|-----------|---------|-----------|
| DM | `main` | `agent:<agentId>:<mainKey>` |
| DM | `per-peer` | `agent:<agentId>:dm:<peerId>` |
| DM | `per-channel-peer` | `agent:<agentId>:<channel>:dm:<peerId>` |
| DM | `per-account-channel-peer` | `agent:<agentId>:<channel>:<accountId>:dm:<peerId>` |
| Group | any | `agent:<agentId>:<channel>:group:<id>` |
| Channel/room | any | `agent:<agentId>:<channel>:channel:<id>` |
| Slack/Discord thread | any | `agent:<agentId>:<channel>:channel:<id>:thread:<threadId>` |
| Telegram topic | any | `agent:<agentId>:<channel>:group:<id>:topic:<threadId>` |
| Cron job | — | `cron:<jobId>` |
| Webhook | — | `hook:<uuid>` |
| Node run | — | `node-<nodeId>` |

---

## Inspecting Sessions

```bash
hyperclaw status                    # shows store path and recent sessions
hyperclaw sessions --json           # dumps every entry
hyperclaw sessions cleanup --dry-run  # preview maintenance
```

**In chat:**
- `/status` — see if agent is reachable, context usage, session info
- `/context list` — see system prompt and injected workspace files
- `/compact [instructions]` — summarize older context and free window space
- `/stop` — abort current run and clear queued followups

---

## Tips

- Keep the primary key dedicated to 1:1 traffic; let groups keep their own keys
- When automating cleanup, delete individual keys instead of the whole store
- For high-volume setups, use `mode: "enforce"` with both time and count limits

---

<div align="center">

[← Memory](memory-integration.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Multi-Agent →](multi-agent.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>