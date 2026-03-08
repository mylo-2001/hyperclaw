# LINE
---

<div align="center">

[← iMessage](imessage-native.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Zalo →](zalo.md)

</div>

---

LINE connects to HyperClaw via the LINE Messaging API. The plugin runs as a webhook receiver on the gateway and uses your channel access token + channel secret for authentication.

**Status:** supported. Direct messages, group chats, rooms, media, locations, Flex messages, template messages, and quick replies are supported. Reactions and threads are not supported.

---

## Setup

1. Create a LINE Developers account and open the Console: https://developers.line.biz/console/
2. Create (or pick) a Provider and add a **Messaging API** channel.
3. Copy the **Channel access token** and **Channel secret** from the channel settings.
4. Enable **Use webhook** in the Messaging API settings.
5. Set the webhook URL to your gateway endpoint (HTTPS required):
   ```
   https://gateway-host/line/webhook
   ```
   The gateway responds to LINE's webhook verification (GET) and inbound events (POST).
   If you need a custom path, set `channels.line.webhookPath` and update the URL accordingly.

> **Security note:** LINE signature verification is body-dependent (HMAC-SHA256 over the raw body). HyperClaw applies strict pre-auth body limits and timeout before verification.

```bash
hyperclaw channels add line
```

---

## Configuration

### Minimal

```jsonc
{
  "channels": {
    "line": {
      "enabled": true,
      "channelAccessToken": "LINE_CHANNEL_ACCESS_TOKEN",
      "channelSecret": "LINE_CHANNEL_SECRET",
      "dmPolicy": "pairing"
    }
  }
}
```

### Environment variables (default account)

```
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
```

### Token / secret files

```jsonc
{
  "channels": {
    "line": {
      "tokenFile": "/path/to/line-token.txt",
      "secretFile": "/path/to/line-secret.txt"
    }
  }
}
```

### Multiple accounts

```jsonc
{
  "channels": {
    "line": {
      "accounts": {
        "marketing": {
          "channelAccessToken": "...",
          "channelSecret": "...",
          "webhookPath": "/line/marketing"
        }
      }
    }
  }
}
```

### Full reference

| Field | Default | Description |
|-------|---------|-------------|
| `channelAccessToken` | — | Channel access token (or use `tokenFile`) |
| `channelSecret` | — | Channel secret (or use `secretFile`) |
| `tokenFile` | — | Path to file containing the access token |
| `secretFile` | — | Path to file containing the channel secret |
| `webhookPath` | `/line/webhook` | Custom inbound webhook path |
| `mediaMaxMb` | `10` | Max media download size in MB |
| `dmPolicy` | `pairing` | DM access policy (see below) |
| `allowFrom` | `[]` | Allowlisted LINE user IDs for DMs |
| `groupPolicy` | `allowlist` | Group access policy |
| `groupAllowFrom` | `[]` | Allowlisted user/group IDs for groups |
| `groups.<id>.allowFrom` | — | Per-group allowlist override |

---

## Access control

### DM policy

```jsonc
{
  "channels": {
    "line": {
      "dmPolicy": "pairing"
    }
  }
}
```

| Value | Behaviour |
|-------|-----------|
| `pairing` (default) | Unknown senders get a pairing code and are ignored until approved |
| `allowlist` | Only `allowFrom` user IDs are accepted |
| `open` | All DMs accepted |
| `disabled` | All DMs ignored |

```bash
hyperclaw pairing list line
hyperclaw pairing approve line <CODE>
```

### Group policy

```jsonc
{
  "channels": {
    "line": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["U1234...", "C5678..."],
      "groups": {
        "C<groupId>": { "allowFrom": ["U1234..."] }
      }
    }
  }
}
```

| Value | Behaviour |
|-------|-----------|
| `allowlist` (default) | Only `groupAllowFrom` entries (user or group IDs) are accepted |
| `open` | All group messages accepted |
| `disabled` | All group messages ignored |

> **LINE IDs are case-sensitive.** Valid formats:
> - User: `U` + 32 hex chars
> - Group: `C` + 32 hex chars
> - Room: `R` + 32 hex chars

> **Runtime note:** if `channels.line` is completely missing, the runtime falls back to `groupPolicy="allowlist"` for group checks.

---

## Message behaviour

- Text is chunked at **5 000 characters**.
- Markdown formatting is stripped; code blocks and tables are converted into Flex cards when possible.
- Streaming responses are buffered; LINE receives full chunks with a loading animation while the agent works.
- Media downloads are capped by `channels.line.mediaMaxMb` (default 10).

---

## Channel data (rich messages)

Use `channelData.line` to send quick replies, locations, Flex cards, or template messages.

```jsonc
{
  "text": "Here you go",
  "channelData": {
    "line": {
      "quickReplies": ["Status", "Help"],
      "location": {
        "title": "Office",
        "address": "123 Main St",
        "latitude": 35.681236,
        "longitude": 139.767125
      },
      "flexMessage": {
        "altText": "Status card",
        "contents": { /* Flex payload */ }
      },
      "templateMessage": {
        "type": "confirm",
        "text": "Proceed?",
        "confirmLabel": "Yes",
        "confirmData": "yes",
        "cancelLabel": "No",
        "cancelData": "no"
      }
    }
  }
}
```

The LINE plugin also ships a `/card` command for Flex message presets:

```
/card info "Welcome" "Thanks for joining!"
```

---

## Troubleshooting

**Webhook verification fails**
- Ensure the webhook URL is HTTPS and the `channelSecret` matches the LINE console exactly.

**No inbound events**
- Confirm the webhook path matches `channels.line.webhookPath` and the gateway is reachable from LINE.
- Check that **Use webhook** is enabled in the LINE Developers Console.

**Media download errors**
- Raise `channels.line.mediaMaxMb` if media exceeds the default 10 MB limit.

**Group messages are ignored**
- Check `groupPolicy`. Default is `allowlist` — add user or group IDs to `groupAllowFrom`.

---

<div align="center">

[← iMessage](imessage-native.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Zalo →](zalo.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>