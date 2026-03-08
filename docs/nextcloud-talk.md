# Nextcloud Talk
---

<div align="center">

[← Twitch](twitch.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [BlueBubbles →](bluebubbles.md)

</div>

---

**Status:** supported via webhook bot. Direct messages, rooms, reactions, and markdown messages are supported.

| Feature | Status |
|---------|--------|
| Direct messages | Supported (requires `apiUser` for DM detection) |
| Rooms | Supported |
| Threads | Not supported |
| Media | URL-only (no uploads) |
| Reactions | Supported (`--feature reaction` flag required) |
| Native commands | Not supported |

---

## Quick setup

```bash
hyperclaw channels add nextcloud-talk
```

1. **Install the bot on your Nextcloud server:**

```bash
./occ talk:bot:install "HyperClaw" "<shared-secret>" "<webhook-url>" --feature reaction
```

Replace `<webhook-url>` with your gateway's externally reachable URL:
```
https://yourhost/nextcloud-talk-webhook
```

2. **Enable the bot in the target room** — Room menu → ⋯ → Bots → enable HyperClaw.

3. **Configure HyperClaw:**

```jsonc
{
  "channels": {
    "nextcloud-talk": {
      "enabled": true,
      "baseUrl": "https://cloud.example.com",
      "botSecret": "shared-secret",
      "dmPolicy": "pairing"
    }
  }
}
```

Or via env (default account only):
```
NEXTCLOUD_TALK_BASE_URL=https://cloud.example.com
NEXTCLOUD_TALK_BOT_SECRET=shared-secret
```

4. **Restart the gateway** (or finish onboarding).

---

## Notes

- Bots **cannot initiate DMs**. The user must message the bot first.
- Webhook URL must be reachable by the Nextcloud server; set `webhookPublicUrl` if behind a proxy.
- Media uploads are not supported by the bot API — media is sent as URLs.
- The webhook payload does not distinguish DMs from rooms. Set `apiUser` + `apiPassword` to enable room-type lookups via the OCS API; otherwise all rooms are treated as group rooms.

---

## Configuration reference

| Field | Default | Description |
|-------|---------|-------------|
| `baseUrl` | — | Nextcloud instance URL (required) |
| `botSecret` | — | Bot shared secret from `occ talk:bot:install` (or use `botSecretFile`) |
| `botSecretFile` | — | Path to file containing the bot secret |
| `apiUser` | — | Nextcloud username for OCS API calls (DM detection + fallback send) |
| `apiPassword` | — | Nextcloud app password for `apiUser` |
| `apiPasswordFile` | — | Path to file containing the API password |
| `webhookPort` | `8788` | Port for the inbound webhook HTTP server |
| `webhookHost` | `0.0.0.0` | Bind host for the webhook server |
| `webhookPath` | `/nextcloud-talk-webhook` | Webhook URL path |
| `webhookPublicUrl` | — | Externally reachable URL (for reverse-proxy setups) |
| `dmPolicy` | `pairing` | DM access policy |
| `allowFrom` | `[]` | DM allowlist (Nextcloud user IDs; `"*"` for open) |
| `groupPolicy` | `allowlist` | Room access policy |
| `groupAllowFrom` | `[]` | Room sender allowlist (Nextcloud user IDs) |
| `rooms` | `{}` | Per-room settings (room token → `{ requireMention, allowFrom }`) |
| `textChunkLimit` | `32000` | Outbound text chunk size (chars) |
| `chunkMode` | `length` | `length` / `newline` (split on paragraph boundaries first) |
| `historyLimit` | — | Group history limit (0 disables) |
| `dmHistoryLimit` | — | DM history limit (0 disables) |
| `dms` | — | Per-DM overrides (`{ historyLimit }`) |
| `mediaMaxMb` | `10` | Inbound media size cap (MB) |

---

## Access control

### DM policy

| Value | Behaviour |
|-------|-----------|
| `pairing` (default) | Unknown senders get a pairing code; ignored until approved |
| `allowlist` | Only `allowFrom` user IDs accepted |
| `open` | All DMs accepted (add `"*"` to `allowFrom`) |
| `disabled` | All DMs ignored |

```bash
hyperclaw pairing list nextcloud-talk
hyperclaw pairing approve nextcloud-talk <CODE>
```

> `allowFrom` matches Nextcloud user IDs only; display names are ignored.

### Rooms (groups)

Default: `groupPolicy: "allowlist"` — room must be listed in `rooms`.

```jsonc
{
  "channels": {
    "nextcloud-talk": {
      "groupPolicy": "allowlist",
      "rooms": {
        "room-token-abc": { "requireMention": true },
        "room-token-xyz": { "requireMention": false, "allowFrom": ["alice"] }
      },
      "groupAllowFrom": ["alice", "bob"]
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `rooms.<token>.requireMention` | `true` = only respond when mentioned; `false` = auto-reply |
| `rooms.<token>.allowFrom` | Per-room sender allowlist |
| `groupAllowFrom` | Global sender allowlist for all rooms |

To block all rooms: set `groupPolicy: "disabled"` or leave `rooms` empty.

---

## Troubleshooting

**Webhook signature fails**
- Verify the `botSecret` matches exactly what was passed to `occ talk:bot:install`.
- Check that the Nextcloud server can reach your webhook URL (test with curl).

**DMs not detected / treated as rooms**
- Add `apiUser` + `apiPassword` to enable OCS API room-type lookups.

**Room messages ignored**
- Confirm the room token is listed in `rooms` (for `groupPolicy: allowlist`).
- Check `requireMention`: if `true`, the bot must be @-mentioned in the message.

**Bot not installed on room**
- Open the room → ⋯ → Bots → enable HyperClaw.

---

<div align="center">

[← Twitch](twitch.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [BlueBubbles →](bluebubbles.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>