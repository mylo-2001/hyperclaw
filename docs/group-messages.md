# Groups — HyperClaw

HyperClaw treats group chats consistently across surfaces: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Microsoft Teams, Zalo.

---

## Beginner intro (2 minutes)

HyperClaw “lives” on your messaging accounts. If you are in a group, HyperClaw can see that group and respond there.

**Default behavior:**
- Groups are restricted (`groupPolicy: "allowlist"`).
- Replies require a mention unless you explicitly disable mention gating.
- **Translation:** Allowlisted senders can trigger HyperClaw by mentioning it.

### TL;DR

- **DM access** is controlled by `*.allowFrom`.
- **Group access** is controlled by `*.groupPolicy` + allowlists (`*.groups`, `*.groupAllowFrom`).
- **Reply triggering** is controlled by mention gating (`requireMention`, `/activation`).

### Quick flow (what happens to a group message)

```
groupPolicy? disabled → drop
groupPolicy? allowlist → group allowed? no → drop
requireMention? yes → mentioned? no → store for context only
otherwise → reply
```

---

## Group message flow

| If you want… | What to set |
|--------------|-------------|
| Allow all groups but only reply on @mentions | `groups: { "*": { requireMention: true } }` |
| Disable all group replies | `groupPolicy: "disabled"` |
| Only specific groups | `groups: { "<group-id>": { ... } }` (no `"*"` key) |
| Only you can trigger in groups | `groupPolicy: "allowlist"`, `groupAllowFrom: ["+1555..."]` |

---

## Session keys

- **Group sessions:** `agent:<agentId>:<channel>:group:<id>`
- **Rooms/channels:** `agent:<agentId>:<channel>:channel:<id>`
- **Telegram forum topics** add `:topic:<threadId>` to the group id; each topic has its own session.
- **Direct chats** use the main session (or per-sender if configured).
- **Heartbeats** are skipped for group sessions.

---

## Pattern: personal DMs + public groups (single agent)

This works well if your “personal” traffic is DMs and your “public” traffic is groups.

**Why:** In single-agent mode, DMs typically land in the main session, while groups use non-main keys (`agent:main:<channel>:group:<id>`). If you enable sandboxing with `mode: "non-main"`, those group sessions run in Docker while your main DM session stays on-host.

**Result:** One agent brain, two execution postures:
- **DMs:** full tools (host)
- **Groups:** sandbox + restricted tools (Docker)

Example (DMs on host, groups sandboxed + messaging-only tools):

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "non-main",
        "scope": "session",
        "workspaceAccess": "none"
      }
    }
  },
  "tools": {
    "sandbox": {
      "tools": {
        "allow": ["group:messaging", "group:sessions"],
        "deny": ["group:runtime", "group:fs", "group:ui", "nodes", "cron", "gateway"]
      }
    }
  }
}
```

For “groups can only see folder X”: keep `workspaceAccess: "none"` and mount paths into the sandbox:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "non-main",
        "scope": "session",
        "workspaceAccess": "none",
        "docker": {
          "binds": ["/home/user/FriendsShared:/data:ro"]
        }
      }
    }
  }
}
```

**Related:** [Configuration](configuration.md) · [Security](security.md)

---

## Group policy

Control how group/room messages are handled per channel:

```json
{
  "channels": {
    "whatsapp-baileys": {
      "groupPolicy": "disabled",
      "groupAllowFrom": ["+15551234567"]
    },
    "telegram": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": [],
      "groups": { "*": { "requireMention": true } }
    },
    "signal": {
      "groupPolicy": "disabled",
      "groupAllowFrom": ["+15551234567"]
    },
    "discord": {
      "groupPolicy": "allowlist",
      "guilds": { "GUILD_ID": { "channels": { "help": { "allow": true } } } }
    },
    "slack": {
      "groupPolicy": "allowlist",
      "channels": { "#general": { "allow": true } }
    },
    "matrix": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["@owner:example.org"],
      "groups": {
        "!roomId:example.org": { "allow": true },
        "#alias:example.org": { "allow": true }
      }
    }
  }
}
```

| Policy | Behavior |
|--------|----------|
| `open` | Groups bypass allowlists; mention-gating still applies. |
| `disabled` | Block all group messages entirely. |
| `allowlist` | Only allow groups/rooms that match the configured allowlist. |

**Notes:**
- `groupPolicy` is separate from mention-gating.
- **Telegram:** `groupAllowFrom` accepts numeric user IDs (`123456789`, `telegram:123456789`, `tg:123456789`) or usernames (`@alice`, `alice`).
- **WhatsApp / Signal / iMessage:** use `groupAllowFrom` (E.164 or channel-specific IDs).
- **Discord:** allowlist uses `guilds.<id>.channels`.
- **Slack:** allowlist uses `channels`.
- **Matrix:** allowlist uses `groups` (room IDs, aliases); `groupAllowFrom` restricts senders.
- **Default** is `groupPolicy: "allowlist"`; empty allowlist blocks group messages.

---

## Mention gating (default)

Group messages require a mention unless overridden per group. Defaults live under `*.groups."*"`.

Replying to a bot message counts as an implicit mention (when the channel supports reply metadata).

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "*": { "requireMention": true },
        "123456789": { "requireMention": false }
      }
    },
    "whatsapp-baileys": {
      "groups": {
        "*": { "requireMention": true },
        "123@g.us": { "requireMention": false }
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "main",
        "groupChat": {
          "mentionPatterns": ["@hyperclaw", "hyperclaw", "\\+15555550123"],
          "historyLimit": 50
        }
      }
    ]
  }
}
```

**Notes:**
- `mentionPatterns` are case-insensitive regexes.
- Surfaces that provide explicit mentions still pass; patterns are a fallback.
- Per-agent override: `agents.list[].groupChat.mentionPatterns`.
- Group history context: `historyLimit` (default 50); set 0 to disable.

---

## Group allowlists — common intents

### Disable all group replies

```json
{ "channels": { "telegram": { "groupPolicy": "disabled" } } }
```

### Allow only specific groups

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "123456789": { "requireMention": true },
        "987654321": { "requireMention": false }
      }
    }
  }
}
```

### Allow all groups but require mention

```json
{
  "channels": {
    "telegram": {
      "groups": { "*": { "requireMention": true } }
    }
  }
}
```

### Only the owner can trigger in groups

```json
{
  "channels": {
    "telegram": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["123456789"],
      "groups": { "*": { "requireMention": true } }
    }
  }
}
```

---

## Activation (owner-only)

Per-group activation toggle:

```
/activation mention
/activation always
```

Owner is determined by `channels.<channel>.allowFrom` (or the bot’s own ID when unset). Send as a standalone message. `/status` shows the current mode.

---

## Group/channel tool restrictions (optional)

Some connectors support restricting tools per group/room:

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "*": { "tools": { "deny": ["exec"] } },
        "-1001234567890": {
          "tools": { "deny": ["exec", "read", "write"] },
          "toolsBySender": {
            "id:123456789": { "alsoAllow": ["exec"] }
          }
        }
      }
    }
  }
}
```

Group restrictions are applied in addition to global/agent tool policy (deny wins).

---

## Channel support

| Channel | Groups | groupPolicy | groupAllowFrom | groups.*.requireMention |
|---------|--------|-------------|----------------|-------------------------|
| Telegram | ✅ | allowlist | ✅ | ✅ |
| Discord | ✅ | allowlist (guilds) | — | — |
| Slack | ✅ | allowlist (channels) | — | — |
| Signal | ✅ | allowlist \| open | ✅ | — |
| Matrix | ✅ | allowlist | ✅ | ✅ |
| IRC | ✅ | allowlist | ✅ | ✅ |
| Line | ✅ | allowlist \| disabled | ✅ | — |
| Nextcloud Talk | ✅ | allowlist | ✅ | ✅ |
| Mattermost | ✅ | allowlist | ✅ | ✅ |
| Zalo OA | ✅ | allowlist | ✅ | — |
| WhatsApp (Baileys) | ⏳ Planned | — | — | — |
| WhatsApp (Cloud API) | ✅ | via webhook | — | — |

---

## Context fields

Group inbound payloads include:
- `ChatType=group`
- `GroupSubject` (if known)
- `GroupMembers` (if known)
- `WasMentioned` (mention-gating result)

The agent system prompt includes a group intro on the first turn of a new group session.

---

## iMessage specifics

- Prefer `chat_id:<id>` when routing or allowlisting.
- List chats: `imsg chats --limit 20`.
- Group replies go back to the same `chat_id`.

---

## WhatsApp specifics

- **Baileys:** Group support planned. See [WhatsApp](whatsapp.md).
- **Cloud API:** Groups via webhook; ensure webhook subscribes to group events.
- `mentionPatterns` help when WhatsApp strips the visual @ but you want display-name or number pings.

---

## Related

- [Telegram](telegram.md) · [WhatsApp](whatsapp.md)
- [Configuration](configuration.md) · [Security](security.md)
