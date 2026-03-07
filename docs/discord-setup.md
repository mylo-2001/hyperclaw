# Discord — HyperClaw

Discord is ready for DMs and guild channels via the official Discord Gateway. Supports pairing, guild allowlist, and mention behavior.

**Status:** Ready for DMs and guild channels. Pairing via `hyperclaw pairing approve discord <CODE>`.

---

## Quick setup

### 1. Create a Discord application and bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Name it (e.g. "HyperClaw").
2. Click **Bot** in the sidebar. Set the username to your bot’s display name.

### 2. Enable privileged intents

On the Bot page, scroll to **Privileged Gateway Intents** and enable:

- **Message Content Intent** (required for reading message content)
- **Server Members Intent** (recommended; for role-based routing)
- Presence Intent (optional)

### 3. Copy your bot token

Still on the Bot page, click **Reset Token** (this creates your first token). Copy and save it — this is your Bot Token.

### 4. Generate invite URL and add the bot to your server

1. Click **OAuth2** → **URL Generator**.
2. Scopes: enable **bot** and **applications.commands**.
3. Bot Permissions: enable **View Channels**, **Send Messages**, **Read Message History**, **Embed Links**, **Attach Files**.
4. Copy the generated URL, open it in your browser, select your server, and connect.

### 5. Enable Developer Mode and copy IDs

In Discord app:

1. **User Settings** (gear) → **Advanced** → enable **Developer Mode**.
2. Right‑click your server icon → **Copy Server ID**.
3. Right‑click your avatar → **Copy User ID**.

Save Server ID and User ID — you’ll use them for guild allowlist and allowFrom.

### 6. Allow DMs from server members

Right‑click your server → **Privacy Settings** → enable **Direct Messages**.

This lets the bot DM you for pairing.

### 7. Configure HyperClaw

```json
{
  "gateway": { "enabledChannels": ["discord"] },
  "channels": {
    "discord": {
      "token": "YOUR_BOT_TOKEN",
      "dmPolicy": "pairing",
      "allowFrom": [],
      "listenGuildIds": [],
      "requireMentionInGuild": true
    }
  }
}
```

**Env fallback:** `DISCORD_BOT_TOKEN` (used when `channels.discord.token` is not set).

### 8. Start gateway and pair

```bash
hyperclaw gateway
```

DM your bot in Discord. It will respond with a pairing code. Then:

```bash
hyperclaw pairing approve discord <CODE>
```

Pairing codes expire after 1 hour.

---

## DM policy

| `channels.discord.dmPolicy` | Behavior |
|----------------------------|----------|
| `pairing` (default) | Unknown senders get a pairing code. Approve with `hyperclaw pairing approve discord <CODE>`. |
| `allowlist` | Only Discord user IDs in `allowFrom` can DM. |
| `open` | Accept all DMs (use with caution). |
| `none` | Ignore DMs. |

---

## Guild channels

### Guild allowlist

To respond in guild (server) channels, add your server ID to the allowlist:

```json
{
  "channels": {
    "discord": {
      "listenGuildIds": ["123456789012345678"]
    }
  }
}
```

Empty `listenGuildIds` = listen in all guilds where the bot is present.

### Mention behavior

| `requireMentionInGuild` | Behavior |
|-------------------------|----------|
| `true` (default) | Bot responds only when @mentioned or when replying to a bot message. |
| `false` | Bot responds to every message in allowed guild channels. Use only for private servers. |

Example for a private server:

```json
{
  "channels": {
    "discord": {
      "listenGuildIds": ["123456789012345678"],
      "requireMentionInGuild": false
    }
  }
}
```

---

## Configuration reference

### Primary fields

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `token` | string | required | Bot token from Developer Portal |
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `none` |
| `allowFrom` | string[] | [] | DM allowlist (Discord user IDs) |
| `listenGuildIds` | string[] | [] | Guild IDs to listen in. Empty = all. |
| `requireMentionInGuild` | boolean | true | Require @mention in guild channels |
| `commandPrefix` | string | `!` | Prefix for legacy commands |

### Env vars

| Var | Description |
|-----|-------------|
| `DISCORD_BOT_TOKEN` | Bot token (fallback when token not in config) |

---

## Example configs

### Pairing + guild workspace

```json
{
  "gateway": { "enabledChannels": ["discord"] },
  "channels": {
    "discord": {
      "token": "${DISCORD_BOT_TOKEN}",
      "dmPolicy": "pairing",
      "listenGuildIds": ["YOUR_SERVER_ID"],
      "requireMentionInGuild": false
    }
  }
}
```

### Allowlist (one-owner)

```json
{
  "channels": {
    "discord": {
      "token": "YOUR_BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": ["YOUR_DISCORD_USER_ID"]
    }
  }
}
```

---

## Feature reference

| Feature | Status |
|---------|--------|
| DMs | ✅ |
| Guild channels | ✅ |
| Pairing | ✅ |
| Allowlist | ✅ |
| Guild allowlist | ✅ |
| Mention gating | ✅ |
| Slash commands | ✅ `/help`, `/status` |
| Voice channels | ⚠️ Planned |

---

## Troubleshooting

### Bot does not respond in guild channels

- Add your Server ID to `listenGuildIds` (or leave it empty to listen in all guilds).
- If `requireMentionInGuild` is true (default), the bot must be @mentioned.
- Ensure the bot has **View Channels**, **Send Messages**, and **Read Message History**.

### DM pairing fails

- Verify `channels.discord.dmPolicy` is `pairing`.
- Check that **Direct Messages** is enabled in server Privacy Settings.
- Confirm the code hasn’t expired (1 hour). Run `hyperclaw pairing list discord` to see pending codes.

### Bot sees no messages

- Enable **Message Content Intent** in the Developer Portal.
- Verify the token is correct and not revoked.
- Restart the gateway after config changes.

**More help:** See [Troubleshooting](troubleshooting.md#channels).

---

## Related

- [Pairing](security.md#pairing) — DM approval flow  
- [Configuration](configuration.md) — Full config reference  
- [Troubleshooting](troubleshooting.md) — Common issues  
