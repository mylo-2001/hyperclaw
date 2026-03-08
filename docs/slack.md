# Slack
---

<div align="center">

[← Discord](discord-setup.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Matrix →](matrix.md)

</div>

---

**Status:** production-ready. DMs, channels, groups (MPIMs), threads, reactions, pairing, slash commands, ack/typing reactions, and native text streaming are supported.

Default connection mode is **Socket Mode** (no public HTTPS endpoint required).

---

## Quick setup — Socket Mode (default)

```bash
hyperclaw channels add slack
```

1. **Create Slack app** at api.slack.com/apps → "From scratch".

2. **Enable Socket Mode** (Settings → Socket Mode → Enable).

3. **Create App Token:**
   Settings → Basic Information → App-Level Tokens → Generate Token
   - Scope: `connections:write`
   - Copy the `xapp-...` token.

4. **Add bot scopes** (OAuth & Permissions):
   ```
   chat:write  chat:write.customize  im:read  im:history
   channels:read  channels:history  groups:read  groups:history
   mpim:read  mpim:history  reactions:write  assistant:write
   users:read  emoji:read
   ```

5. **Subscribe to bot events** (Event Subscriptions):
   ```
   app_mention  message.channels  message.groups  message.im  message.mpim
   reaction_added  reaction_removed
   member_joined_channel  member_left_channel
   channel_rename  pin_added  pin_removed
   ```

6. **App Home → Messages Tab → Enable** (for DMs).

7. **Install app to workspace** → copy Bot Token (`xoxb-...`).

8. **Configure HyperClaw:**

```jsonc
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dmPolicy": "pairing"
    }
  }
}
```

Env fallback (default account only):
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

---

## HTTP Events API mode

```jsonc
{
  "channels": {
    "slack": {
      "mode": "http",
      "botToken": "xoxb-...",
      "signingSecret": "..."
    }
  }
}
```

Webhook URL: `https://<gateway-host>/webhook/slack`

---

## Token model

| Token | Field | Env | Required for |
|-------|-------|-----|--------------|
| Bot Token (`xoxb-...`) | `botToken` | `SLACK_BOT_TOKEN` | Both modes |
| App Token (`xapp-...`) | `appToken` | `SLACK_APP_TOKEN` | Socket Mode |
| Signing Secret | `signingSecret` | `SLACK_SIGNING_SECRET` | HTTP mode |
| User Token (`xoxp-...`) | `userToken` | — (config only) | Read operations (optional) |

- `userTokenReadOnly: true` (default) — user token is read-only.
- Config values override env fallback. Env only applies to the default account.
- Optional: add `chat:write.customize` scope and set `icon_emoji` (`:emoji_name:` syntax) for custom agent identity on outgoing messages.

---

## Configuration reference

### Full config example

```jsonc
{
  "channels": {
    "slack": {
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "dm": {
        "enabled": true,
        "policy": "pairing",
        "groupEnabled": false,
        "groupChannels": []
      },
      "allowFrom": [],
      "groupPolicy": "allowlist",
      "channels": {
        "C1234567890": { "requireMention": true, "allowFrom": ["U..."] }
      },
      "replyToMode": "off",
      "thread": {
        "historyScope": "thread",
        "inheritParent": false,
        "initialHistoryLimit": 20
      },
      "textChunkLimit": 3000,
      "streaming": "partial",
      "nativeStreaming": true,
      "ackReaction": "eyes",
      "typingReaction": "hourglass_flowing_sand",
      "actions": {
        "messages": true,
        "reactions": true,
        "pins": true,
        "memberInfo": true,
        "emojiList": true
      }
    }
  }
}
```

### Field reference

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `socket` | `socket` / `http` |
| `botToken` | — | Bot token (`xoxb-...`) |
| `appToken` | — | App token (`xapp-...`) — Socket Mode only |
| `signingSecret` | — | Signing secret — HTTP mode only |
| `userToken` | — | User token (`xoxp-...`) for read ops |
| `userTokenReadOnly` | `true` | Restrict user token to reads |
| `dmPolicy` | `pairing` | DM access policy (flat field; legacy: `dm.policy`) |
| `allowFrom` | `[]` | DM allowlist (Slack user IDs; `"*"` for open) |
| `dm.enabled` | `true` | Enable DM processing |
| `dm.groupEnabled` | `false` | Enable MPIM (group DM) processing |
| `dm.groupChannels` | `[]` | Optional MPIM allowlist |
| `groupPolicy` | `allowlist` | Channel access policy |
| `channels.<id>.requireMention` | `true` | Require `@bot` mention in channels |
| `channels.<id>.allowFrom` | — | Per-channel user allowlist |
| `replyToMode` | `off` | `off` / `first` / `all` threading mode |
| `replyToModeByChatType` | — | Per `direct`/`group`/`channel` override |
| `thread.historyScope` | `thread` | `thread` / `channel` history fetch scope |
| `thread.inheritParent` | `false` | Inherit parent message context |
| `thread.initialHistoryLimit` | `20` | Messages fetched when thread session starts |
| `textChunkLimit` | `3000` | Outbound chunk size (chars) |
| `chunkMode` | `length` | `length` / `newline` |
| `mediaMaxMb` | `10` | Inbound media size cap |
| `streaming` | `partial` | `off` / `partial` / `block` / `progress` |
| `nativeStreaming` | `true` | Use Slack Agents API streaming |
| `ackReaction` | — | Emoji shortcode added on receipt (e.g. `eyes`) |
| `typingReaction` | — | Emoji shortcode added while processing |
| `accounts` | — | Multi-account map |

---

## Access control

### DM policy

| Value | Behaviour |
|-------|-----------|
| `pairing` (default) | Unknown senders get a 6-char code; ignored until approved |
| `allowlist` | Only `allowFrom` user IDs accepted |
| `open` | All DMs accepted (add `"*"` to `allowFrom`) |
| `disabled` | All DMs ignored |

```bash
hyperclaw pairing list slack
hyperclaw pairing approve slack <CODE>
```

### Channel (group) policy

| Value | Behaviour |
|-------|-----------|
| `allowlist` (default) | Only channels listed in `channels` map are processed |
| `open` | All channels processed |
| `disabled` | No channel messages processed |

Per-channel settings:
```jsonc
{
  "channels": {
    "slack": {
      "channels": {
        "C1234567890": { "requireMention": false },
        "C0987654321": { "requireMention": true, "allowFrom": ["U..."] }
      }
    }
  }
}
```

---

## Threading

| Setting | Values | Default |
|---------|--------|---------|
| `replyToMode` | `off` / `first` / `all` | `off` |
| `thread.historyScope` | `thread` / `channel` | `thread` |
| `thread.initialHistoryLimit` | number | `20` |

> `replyToMode: "off"` disables all threading in Slack, including explicit `[[reply_to_*]]` tags.

---

## Text streaming (Agents API)

Requires: Agents and AI Apps enabled in Slack app settings, `assistant:write` scope.

```jsonc
{
  "channels": {
    "slack": {
      "streaming": "partial",
      "nativeStreaming": true
    }
  }
}
```

| `streaming` | Behaviour |
|-------------|-----------|
| `partial` (default) | Replace preview with latest partial output |
| `block` | Append chunked preview updates |
| `progress` | Show progress status while generating, then send final text |
| `off` | Disable live preview |

To keep draft preview but disable native streaming API:
```jsonc
{ "streaming": "partial", "nativeStreaming": false }
```

---

## Ack and typing reactions

- `ackReaction`: emoji shortcode (no colons) added to the inbound message immediately on receipt.
- `typingReaction`: emoji added while the agent is processing; removed when the reply is sent.

Resolution order: account config → global config → identity emoji fallback.

```jsonc
{ "ackReaction": "eyes", "typingReaction": "hourglass_flowing_sand" }
```

Use `""` to disable for a specific account.

---

## Multi-account

```jsonc
{
  "channels": {
    "slack": {
      "dmPolicy": "pairing",
      "accounts": {
        "support": {
          "botToken": "xoxb-support-...",
          "appToken": "xapp-support-...",
          "dm": { "policy": "open", "allowFrom": ["*"] }
        },
        "alerts": {
          "botToken": "xoxb-alerts-...",
          "appToken": "xapp-alerts-...",
          "dmPolicy": "disabled"
        }
      }
    }
  }
}
```

- Named accounts inherit top-level config unless overridden.
- Env vars apply to the default account only.
- Startup is serialized to avoid race conditions.

---

## Slash commands

```jsonc
{
  "channels": {
    "slack": {
      "commands": { "native": true },
      "slashCommand": {
        "enabled": true,
        "name": "hyperclaw",
        "ephemeral": true
      }
    }
  }
}
```

> Register `/agentstatus` for the status command (Slack reserves `/status`).
> Native commands auto-mode is **off** for Slack — enable explicitly with `commands.native: true`.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| No replies in channels | Channel not in `channels` map, or `groupPolicy: disabled` |
| DMs ignored | Sender pending pairing (`dmPolicy: pairing`) |
| Socket Mode not connecting | Missing or invalid `appToken` / `connections:write` scope |
| HTTP mode not receiving events | Webhook URL not set in Slack app / invalid `signingSecret` |
| Slash commands not firing | `commands.native: true` not set, or slash command not registered in Slack |
| Streaming errors | Agents and AI Apps not enabled / `assistant:write` scope missing |

---

<div align="center">

[← Discord](discord-setup.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Matrix →](matrix.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>