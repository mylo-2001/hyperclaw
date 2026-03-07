# Zalo

**Status:** experimental. DMs are supported; group handling is available with explicit group policy controls.

Zalo is a Vietnam-focused messaging app. The Bot API lets HyperClaw run a bot for 1:1 conversations and group chats. Replies always route back to Zalo (deterministic routing). DMs share the agent's main session.

| Feature | Status |
|---------|--------|
| Direct messages | Supported |
| Groups | Supported (allowlist by default) |
| Media (images) | Supported |
| Reactions | Not supported |
| Threads | Not supported |
| Streaming | Blocked (2000 char limit) |

---

## Quick setup

```bash
hyperclaw channels add zalo
```

1. Go to **https://bot.zaloplatforms.com** and sign in.
2. Create a new bot and configure its settings.
3. Copy the **bot token** (format: `12345689:abc-xyz`).

### Minimal config

```jsonc
{
  "channels": {
    "zalo": {
      "enabled": true,
      "botToken": "12345689:abc-xyz",
      "dmPolicy": "pairing"
    }
  }
}
```

Env fallback (default account only):
```
ZALO_BOT_TOKEN=12345689:abc-xyz
```

DM access defaults to `pairing` — approve the code when the bot is first contacted.

---

## Long-polling vs webhook

**Default: long-polling** — no public URL required. HyperClaw polls the Zalo Bot API continuously.

**Webhook mode** (optional):

```jsonc
{
  "channels": {
    "zalo": {
      "botToken": "12345689:abc-xyz",
      "webhookUrl": "https://yourhost/zalo-webhook",
      "webhookSecret": "your-secret-8-256-chars"
    }
  }
}
```

> `getUpdates` (polling) and webhook are **mutually exclusive** per Zalo API. Setting `webhookUrl` switches to webhook mode.

Webhook verification: Zalo sends the secret in the `X-Bot-Api-Secret-Token` header.
- Webhook URL must use HTTPS.
- Secret must be 8-256 characters.
- Duplicate events (`event_name` + `message_id`) are ignored within a 1-minute replay window.

---

## Configuration reference

| Field | Default | Description |
|-------|---------|-------------|
| `botToken` | — | Bot token from bot.zaloplatforms.com (required) |
| `tokenFile` | — | Path to file containing the bot token |
| `dmPolicy` | `pairing` | DM access policy |
| `allowFrom` | `[]` | DM allowlist (numeric user IDs; `"*"` for open) |
| `groupPolicy` | `allowlist` | Group access policy |
| `groupAllowFrom` | `[]` | Group sender allowlist (falls back to `allowFrom` when unset) |
| `mediaMaxMb` | `5` | Inbound/outbound media cap (MB) |
| `webhookUrl` | — | Enable webhook mode (HTTPS required) |
| `webhookSecret` | — | Webhook secret token (8-256 chars) |
| `webhookPath` | URL path | Gateway webhook path (defaults to `webhookUrl` path) |
| `proxy` | — | Proxy URL for API requests |
| `accounts` | — | Multi-account map |

---

## Access control

### DM policy

| Value | Behaviour |
|-------|-----------|
| `pairing` (default) | Unknown senders get a 6-char code; ignored until approved (expires 1 hour) |
| `allowlist` | Only `allowFrom` numeric user IDs accepted |
| `open` | All DMs accepted (add `"*"` to `allowFrom`) |
| `disabled` | All DMs ignored |

```bash
hyperclaw pairing list zalo
hyperclaw pairing approve zalo <CODE>
```

> `allowFrom` accepts numeric user IDs only. No username lookup is available.

### Group policy

| Value | Behaviour |
|-------|-----------|
| `allowlist` (default) | Only `groupAllowFrom` IDs can trigger the bot |
| `open` | Any group member can trigger the bot (mention-gated) |
| `disabled` | All group messages ignored |

```jsonc
{
  "channels": {
    "zalo": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["123456789", "987654321"]
    }
  }
}
```

> If `groupAllowFrom` is unset, falls back to `allowFrom` for sender checks.
> **Runtime note:** if `channels.zalo` is missing entirely, runtime falls back to `groupPolicy: "allowlist"` for safety.

---

## Limits

- Outbound text is chunked to **2000 characters** (Zalo API limit).
- Media downloads/uploads capped by `mediaMaxMb` (default 5 MB).
- Streaming is **blocked** (2000-char limit makes partial streaming impractical).

---

## Multi-account

```jsonc
{
  "channels": {
    "zalo": {
      "dmPolicy": "pairing",
      "accounts": {
        "support": {
          "name": "Support bot",
          "botToken": "12345689:abc-support",
          "dmPolicy": "open",
          "allowFrom": ["*"]
        },
        "alerts": {
          "name": "Alerts bot",
          "botToken": "12345689:abc-alerts",
          "dmPolicy": "disabled",
          "webhookUrl": "https://yourhost/zalo-alerts",
          "webhookSecret": "alerts-secret"
        }
      }
    }
  }
}
```

Per-account options mirror top-level options: `botToken`, `tokenFile`, `dmPolicy`, `allowFrom`, `groupPolicy`, `groupAllowFrom`, `webhookUrl`, `webhookSecret`, `webhookPath`, `proxy`, `enabled`.

---

## Delivery (CLI / cron)

Use a numeric chat ID as the target:

```bash
hyperclaw message send --channel zalo --target 123456789 --message "hi"
```

---

## Troubleshooting

**Bot doesn't respond**
- Verify the token: `hyperclaw channels status --probe`
- Check that the sender is approved (pairing or allowFrom)
- Check gateway logs: `hyperclaw logs --follow`

**Webhook not receiving events**
- Ensure webhook URL uses HTTPS
- Verify secret is 8-256 characters
- Confirm gateway HTTP endpoint is reachable at `webhookPath`
- Check that polling is not also running (they're mutually exclusive)
- Duplicate events within 1-minute window are silently dropped

**Pairing code expired**
- Codes expire after 1 hour. Send a new message to receive a fresh code.
