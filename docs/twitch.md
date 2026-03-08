# Twitch — HyperClaw
---

<div align="center">

[← Nostr](nostr.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Nextcloud Talk →](nextcloud-talk.md)

</div>

---

Twitch chat support via IRC connection. HyperClaw connects as a Twitch user (bot account) to receive and send messages in channels.

**Status:** Bundled. Uses Twitch IRC over WebSocket (TMI protocol). No external SDK.

---

## Quick setup

1. **Create a dedicated Twitch account** for the bot (or use an existing account).
2. **Generate credentials:** [Twitch Token Generator](https://twitchapps.com/tmi/) or [Twitch Token Generator (token generator)](https://www.twitchtokengenerator.com/)
   - Connect with your bot account
   - Copy the OAuth token (format: `oauth:...`)
3. **Find your Twitch user ID** (optional, for allowlist): [Convert username to ID](https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/)
4. **Configure:**

```json
{
  "gateway": { "enabledChannels": ["twitch"] },
  "channels": {
    "twitch": {
      "enabled": true,
      "username": "hyperclaw",
      "oauthToken": "oauth:abc123...",
      "channels": ["vevisk"],
      "allowFrom": ["streamername"],
      "commandPrefix": "!"
    }
  }
}
```

5. **Start the gateway.** Talk to the bot in chat with the prefix, e.g. `!help`.

**Important:** Add access control (`allowFrom` or `modsBypass`) to prevent unauthorized users from triggering the bot. `commandPrefix` (default `!`) acts as mention gating for public chat.

---

## What it is

- **Owned by the gateway** — deterministic routing; replies go back to Twitch.
- **Session key:** `agent:<agentId>:twitch:<accountName>` (when multi-account is used).
- `username` = bot's account; `channels` = chat rooms to join.

---

## Credentials

Use [twitchapps.com/tmi](https://twitchapps.com/tmi) or [Twitch Token Generator](https://www.twitchtokengenerator.com/):
- Connect with your bot account
- Copy the OAuth token (must start with `oauth:`)
- No manual app registration needed for IRC. Tokens may expire; regenerate when needed.

For automatic token refresh: create your own Twitch app and use OAuth flow. The current connector does not support auto-refresh; you must regenerate tokens manually.

---

## Access control

### Command prefix (mention gating)

By default, **public chat** messages must start with `commandPrefix` (default `!`). Normal chat lines are ignored. Whispers do not require the prefix.

```
!help
!summarize latest stream clips
```

### DM policy

| `dmPolicy` | Behavior |
|------------|----------|
| `pairing` (default) | Unknown users get a code. Approve: `hyperclaw pairing approve twitch <CODE>`. |
| `allowlist` | Only usernames in `allowFrom` can trigger. |
| `open` | All users accepted. |
| `none` | All inbound ignored. |

### Allowlist (recommended)

```json
{
  "channels": {
    "twitch": {
      "allowFrom": ["streamername", "trustedmod"]
    }
  }
}
```

**Prefer user IDs** when possible (usernames can change). Current implementation matches usernames; user ID support is planned.

Find your Twitch user ID: [streamweasels.com/tools](https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/)

### Moderator bypass

When `modsBypass: true` (default), moderators and the broadcaster bypass allowlist checks.

```json
{
  "channels": {
    "twitch": {
      "modsBypass": true
    }
  }
}
```

### Disable prefix requirement

To respond to all messages without a prefix (use with caution):

```json
{
  "channels": {
    "twitch": {
      "commandPrefix": ""
    }
  }
}
```

---

## Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable channel |
| `username` | string | required | Bot Twitch username (lowercase) |
| `oauthToken` | string | required | OAuth token (`oauth:...`) |
| `channels` | string[] | required | Channel names to join |
| `commandPrefix` | string | `!` | Required prefix for public chat |
| `whispers` | boolean | true | Enable whisper (DM) handling |
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `none` |
| `allowFrom` | string[] | [] | Allowlisted usernames |
| `modsBypass` | boolean | true | Mods + broadcaster bypass allowlist |

**Env:** `TWITCH_BOT_USERNAME`, `TWITCH_OAUTH_TOKEN`, `TWITCH_CHANNELS` (comma-separated)

---

## Example configs

### Minimal

```json
{
  "channels": {
    "twitch": {
      "username": "hyperclaw",
      "oauthToken": "oauth:...",
      "channels": ["vevisk"]
    }
  }
}
```

### With allowlist

```json
{
  "channels": {
    "twitch": {
      "username": "hyperclaw",
      "oauthToken": "oauth:...",
      "channels": ["vevisk"],
      "dmPolicy": "allowlist",
      "allowFrom": ["streamername"]
    }
  }
}
```

### Multi-channel

```json
{
  "channels": {
    "twitch": {
      "username": "hyperclaw",
      "oauthToken": "oauth:...",
      "channels": ["vevisk", "secondchannel"],
      "commandPrefix": "!",
      "whispers": true
    }
  }
}
```

---

## Troubleshooting

### Bot doesn't respond

- Check message starts with `commandPrefix` (e.g. `!`).
- Verify bot joined the channel in `channels`.
- If `dmPolicy` is `pairing` or `allowlist`, ensure sender is approved or in `allowFrom`.

### Authentication fails

- Token must be in `oauth:...` format.
- Regenerate if expired or revoked.
- Token must belong to the account in `username`.

### Token refresh

- Tokens from twitchapps.com/tmi cannot be auto-refreshed. Regenerate when expired.
- For long-running bots, consider your own Twitch app with OAuth flow (connector would need refresh support).

---

## Safety & limits

- **Never commit tokens** — use environment variables.
- **Use allowlist** for access control.
- **Scope tokens minimally** — IRC needs chat access only.
- **500 characters** per message (auto-chunked at word boundaries).
- Markdown is stripped before chunking.
- Twitch rate limits apply.

---

## Related

- [Groups](group-messages.md) — group policy (Twitch is channel-based)
- [Configuration](configuration.md)

---

<div align="center">

[← Nostr](nostr.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Nextcloud Talk →](nextcloud-talk.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>