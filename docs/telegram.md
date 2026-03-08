# Telegram — HyperClaw
---

<div align="center">

[← Sandboxing](sandboxing.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [WhatsApp →](whatsapp.md)

</div>

---

Telegram is production-ready for bot DMs and groups. Long polling is the default; webhook mode is optional.

**Status:** Recommended. Uses native Bot API (no grammY). Supports pairing, allowlist, voice notes.

---

## Quick setup

### 1. Create the bot token in BotFather

1. Open Telegram and chat with **@BotFather** (confirm the handle is exactly @BotFather).
2. Run `/newbot`, follow prompts, and save the token.

### 2. Configure token and DM policy

```json
{
  "gateway": { "enabledChannels": ["telegram"] },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123456:ABC...",
      "dmPolicy": "pairing",
      "groups": { "*": { "requireMention": true } }
    }
  }
}
```

**Env fallback:** `TELEGRAM_BOT_TOKEN=...` (used when `channels.telegram.botToken` is not set).

Configure the token in config or env, then start the gateway. HyperClaw does not use `hyperclaw channels login telegram` — set token in config/env.

### 3. Start gateway and approve first DM

```bash
hyperclaw gateway
hyperclaw pairing list telegram
hyperclaw pairing approve telegram <CODE>
```

Pairing codes expire after 1 hour (configurable in pairing store).

### 4. Add the bot to a group

Add the bot to your group, then set `channels.telegram.groups` and `groupPolicy` to match your access model (see Access control).

---

## Access control and activation

### DM policy

| `channels.telegram.dmPolicy` | Behavior |
|-----------------------------|----------|
| `pairing` (default) | Unknown senders get a pairing code. Approve with `hyperclaw pairing approve telegram <CODE>`. |
| `allowlist` | Only sender IDs in `allowFrom` can DM. Requires at least one ID. |
| `open` | Public inbound DMs. Use with caution. |
| `disabled` | Ignore inbound DMs. |

`channels.telegram.allowFrom` accepts numeric Telegram user IDs. Prefixes `telegram:` or `tg:` are accepted and normalized.

For one-owner bots, prefer `dmPolicy: "allowlist"` with explicit `allowFrom` IDs for durable access policy.

### Group policy and mention behavior

| Setting | Description |
|---------|-------------|
| `groupAllowFrom` | List of group chat IDs (numeric). Empty = respond in all groups. |
| `groupActivation` | `mention` (default) — respond only when @mentioned or replied to. `always` — respond to all group messages. |

`channels.telegram.groups["*"].requireMention: true` is equivalent to `groupActivation: "mention"` as global default.

---

## Finding your Telegram user ID

**Safer (no third-party bot):**
1. DM your bot.
2. Run `hyperclaw logs --follow`.
3. Read `from.id` from the log.

**Official Bot API:**
```bash
curl "https://api.telegram.org/bot<bot_token>/getUpdates"
```

**Third-party (less private):** @userinfobot or @getidsbot.

---

## Runtime behavior

- **Ownership:** Telegram is owned by the gateway process.
- **Routing:** Inbound replies go back to Telegram (deterministic; model does not pick channels).
- **Normalization:** Messages normalize into the shared channel envelope with reply metadata and media placeholders.
- **Group sessions:** Isolated by group ID. Forum topics append `:topic:<threadId>` when supported.
- **Long polling:** Uses getUpdates with 30s timeout; per-chat sequencing.
- **Read receipts:** Telegram Bot API has no read-receipt support; `sendReadReceipts` does not apply.

---

## Configuration reference

### Primary fields

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable channel startup |
| `botToken` | string | required | Bot token from BotFather |
| `tokenFile` | string | - | Read token from file path |
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `disabled` |
| `allowFrom` | string[] | [] | DM allowlist (numeric user IDs) |
| `groupPolicy` | string | `allowlist` | `allowlist` \| `open` \| `disabled` |
| `groupAllowFrom` | string[] | [] | Group chat ID allowlist. Empty = all groups |
| `groupActivation` | string | `mention` | `mention` \| `always` |
| `groups` | object | - | Per-group overrides |
| `groups.*.requireMention` | boolean | true | Mention gating |
| `groups.*.allowFrom` | string[] | - | Per-group sender allowlist |

### Env vars

| Var | Description |
|-----|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token (fallback when botToken not in config) |

### Token resolution

Config values win over env. `TELEGRAM_BOT_TOKEN` applies when `channels.telegram.botToken` is not set.

---

## Example configs

### Pairing (default)

```json
{
  "channels": {
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "dmPolicy": "pairing",
      "groups": { "*": { "requireMention": true } }
    }
  }
}
```

### Allowlist (one-owner bot)

```json
{
  "channels": {
    "telegram": {
      "botToken": "123456:ABC...",
      "dmPolicy": "allowlist",
      "allowFrom": ["123456789", "987654321"]
    }
  }
}
```

### Groups: mention only

```json
{
  "channels": {
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "dmPolicy": "pairing",
      "groupActivation": "mention",
      "groupAllowFrom": []
    }
  }
}
```

---

## Feature reference

| Feature | Status |
|---------|--------|
| DMs | ✅ |
| Groups / supergroups | ✅ |
| Pairing | ✅ |
| Allowlist | ✅ |
| Voice notes | ✅ ( transcribed via gateway ) |
| Long polling | ✅ |
| Webhook mode | ⚠️ Connector supports; gateway wiring optional |
| Forum topics | Planned |
| Inline buttons | Planned |
| Streaming preview | Planned |
| Reactions | Planned |

---

## Troubleshooting

### Bot does not respond to non-mention group messages

- Default is `groupActivation: "mention"`. Ensure the bot is @mentioned or the user replies to a bot message.
- To reply to all messages, set `groupActivation: "always"`.

### Bot not seeing group messages at all

- Ensure the bot was added to the group.
- Check `groupAllowFrom` — if set, the group ID must be in the list.
- Verify Privacy Mode in BotFather: set to Disabled if the bot should see all messages (needed for @mention detection in some setups).

### Commands work partially or not at all

- Check BotFather command setup and that the bot has `message` scope.
- Verify token is correct and not revoked.

### Polling or network instability

- Increase timeout or add retry. Check firewall/proxy for `api.telegram.org`.
- Consider webhook mode for production (requires public HTTPS URL).

**More help:** See [Channel troubleshooting](troubleshooting.md#channels).

---

## Related

- [Pairing](security.md#pairing) — DM approval flow
- [Configuration](configuration.md) — Full config reference
- [Troubleshooting](troubleshooting.md) — Common issues

---

<div align="center">

[← Sandboxing](sandboxing.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [WhatsApp →](whatsapp.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>