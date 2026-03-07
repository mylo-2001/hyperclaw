# Matrix

Matrix is an open, decentralized messaging protocol. HyperClaw connects as a Matrix user on any homeserver — you need a Matrix account for the bot. Once connected, you can DM the bot directly or invite it to rooms. Beeper is a valid client option but requires E2EE to be enabled.

**Status:** supported. Direct messages, rooms, threads, media, reactions, polls (send + poll-start as text), location, and E2EE (with crypto support).

---

## Setup

```bash
hyperclaw channels add matrix
```

1. **Create a Matrix account** on any homeserver:
   - Browse hosting: https://matrix.org/ecosystem/hosting/
   - Or self-host.

2. **Get an access token** — preferred method via the login API:

```bash
curl --request POST \
  --url https://matrix.example.org/_matrix/client/v3/login \
  --header 'Content-Type: application/json' \
  --data '{
    "type": "m.login.password",
    "identifier": { "type": "m.id.user", "user": "your-user-name" },
    "password": "your-password"
  }'
```

   Replace `matrix.example.org` with your homeserver URL.

   **Alternative:** set `channels.matrix.userId` + `channels.matrix.password` — HyperClaw calls the login API, caches the access token in `~/.hyperclaw/credentials/matrix/<account>.json`, and reuses it on next start.

3. **Configure credentials** (env or config — config takes precedence):
   - `MATRIX_HOMESERVER`, `MATRIX_ACCESS_TOKEN`
   - Or `MATRIX_USER_ID` + `MATRIX_PASSWORD`

4. **Restart the gateway** (or finish onboarding).

5. **DM the bot or invite it to a room** from any Matrix client (Element, Beeper, etc.).
   - Beeper requires E2EE → set `channels.matrix.encryption: true` and verify the device.

---

## Configuration

### Minimal (access token, userId auto-fetched)

```jsonc
{
  "channels": {
    "matrix": {
      "enabled": true,
      "homeserver": "https://matrix.example.org",
      "accessToken": "syt_***",
      "dm": { "policy": "pairing" }
    }
  }
}
```

### E2EE enabled

```jsonc
{
  "channels": {
    "matrix": {
      "enabled": true,
      "homeserver": "https://matrix.example.org",
      "accessToken": "syt_***",
      "encryption": true,
      "dm": { "policy": "pairing" }
    }
  }
}
```

### Full reference

| Field | Default | Description |
|-------|---------|-------------|
| `homeserver` | — | Homeserver URL (required) |
| `accessToken` | — | Access token (`syt_...`). userId auto-fetched via `/whoami` |
| `userId` | — | Full Matrix ID (`@bot:example.org`). Required only for password login |
| `password` | — | Password login — token cached; takes over on next start |
| `deviceName` | — | Device display name shown in Matrix clients |
| `encryption` | `false` | Enable E2EE (requires `@matrix-org/matrix-sdk-crypto-nodejs`) |
| `initialSyncLimit` | — | Initial sync limit |
| `threadReplies` | `inbound` | `off` / `inbound` / `always` |
| `replyToMode` | `off` | `off` / `first` / `all` |
| `textChunkLimit` | `16000` | Outbound text chunk size (chars) |
| `chunkMode` | `length` | `length` / `newline` (split on paragraph boundaries first) |
| `mediaMaxMb` | `10` | Inbound/outbound media cap (MB) |
| `autoJoin` | `always` | `always` / `allowlist` / `off` |
| `autoJoinAllowlist` | `[]` | Room IDs/aliases allowed for auto-join when `autoJoin: allowlist` |
| `dm.policy` | `pairing` | DM access policy (see below) |
| `dm.allowFrom` | `[]` | DM allowlist (full Matrix user IDs; `"*"` for open) |
| `groupPolicy` | `allowlist` | Room access policy |
| `groupAllowFrom` | `[]` | Allowlisted senders for all rooms (full Matrix user IDs) |
| `groups` | `{}` | Per-room config (room ID or alias → `{ allow, requireMention, allowFrom }`) |
| `rooms` | — | Legacy alias for `groups` |
| `accounts` | — | Multi-account map (see below) |
| `actions` | — | Per-action tool gating |

---

## Encryption (E2EE)

Enable with `channels.matrix.encryption: true`:

- If the crypto module loads, encrypted rooms are decrypted automatically.
- Outbound media is encrypted when sending to encrypted rooms.
- On first connection, HyperClaw requests device verification from your other sessions.
- Verify the device in another Matrix client (Element, etc.) to enable key sharing.

If you see missing crypto module errors:

```bash
pnpm rebuild @matrix-org/matrix-sdk-crypto-nodejs
# or
node node_modules/@matrix-org/matrix-sdk-crypto-nodejs/download-lib.js
```

**Crypto state** is stored per account + access token:
```
~/.hyperclaw/matrix/accounts/<account>/<homeserver>__<user>/<token-hash>/crypto/
```

Sync state lives alongside it in `bot-storage.json`. If the access token (device) changes, a new store is created and the bot must be re-verified.

---

## Multi-account

```jsonc
{
  "channels": {
    "matrix": {
      "enabled": true,
      "dm": { "policy": "pairing" },
      "accounts": {
        "assistant": {
          "name": "Main assistant",
          "homeserver": "https://matrix.example.org",
          "accessToken": "syt_assistant_***",
          "encryption": true
        },
        "alerts": {
          "name": "Alerts bot",
          "homeserver": "https://matrix.example.org",
          "accessToken": "syt_alerts_***",
          "dm": { "policy": "allowlist", "allowFrom": ["@admin:example.org"] }
        }
      }
    }
  }
}
```

**Notes:**
- Account startup is serialized to avoid race conditions.
- Env variables (`MATRIX_HOMESERVER`, `MATRIX_ACCESS_TOKEN`, etc.) apply to the default account only.
- Base channel settings apply to all accounts unless overridden per account.
- Crypto state is stored separately per account + access token.

---

## Access control

### DM policy

```jsonc
{ "channels": { "matrix": { "dm": { "policy": "pairing" } } } }
```

| Value | Behaviour |
|-------|-----------|
| `pairing` (default) | Unknown senders get a pairing code and are ignored until approved |
| `allowlist` | Only `dm.allowFrom` user IDs accepted |
| `open` | All DMs accepted (add `"*"` to `dm.allowFrom`) |
| `disabled` | All DMs ignored |

```bash
hyperclaw pairing list matrix
hyperclaw pairing approve matrix <CODE>
```

> Use full `@user:server` Matrix IDs in `allowFrom`. Display names and bare localparts are ambiguous and ignored.

### Rooms (groups)

Default: `groupPolicy: "allowlist"` — mention-gated.

```jsonc
{
  "channels": {
    "matrix": {
      "groupPolicy": "allowlist",
      "groups": {
        "!roomId:example.org": { "allow": true },
        "#alias:example.org": { "allow": true, "requireMention": false },
        "!restricted:example.org": { "allow": true, "allowFrom": ["@owner:example.org"] }
      },
      "groupAllowFrom": ["@owner:example.org"]
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `groups.<id>.allow` | `true` to allow this room |
| `groups.<id>.requireMention` | `false` = auto-reply without mention; default `true` |
| `groups.<id>.allowFrom` | Per-room sender allowlist (full Matrix user IDs) |
| `groupAllowFrom` | Global sender allowlist across all rooms |
| `groups."*"` | Default settings for all rooms |

- `autoJoin: always` (default) — bot auto-joins all invites.
- `autoJoin: allowlist` — only joins rooms in `autoJoinAllowlist`.
- `autoJoin: off` — never auto-joins.
- Set `groupPolicy: "disabled"` to block all room messages.

> **Legacy key:** `channels.matrix.rooms` is accepted as an alias for `groups`.

---

## Threads

| Setting | Values | Default |
|---------|--------|---------|
| `threadReplies` | `off` / `inbound` / `always` | `inbound` |
| `replyToMode` | `off` / `first` / `all` | `off` |

`threadReplies: inbound` — bot replies in-thread when the user message is part of a thread.

---

## Capabilities

| Feature | Status |
|---------|--------|
| Direct messages | Supported |
| Rooms | Supported |
| Threads | Supported |
| Media | Supported |
| E2EE | Supported (crypto module required) |
| Reactions | Supported (send/read via tools) |
| Polls | Send supported; inbound poll starts converted to text |
| Location | Supported (geo URI; altitude ignored) |

---

## Troubleshooting

```bash
hyperclaw status
hyperclaw gateway status
hyperclaw logs --follow
hyperclaw doctor
hyperclaw channels status --probe
hyperclaw pairing list matrix
```

| Symptom | Likely cause |
|---------|-------------|
| Room messages ignored | Room not in `groups` map, or blocked by `groupPolicy` |
| DMs ignored | Sender pending pairing approval (`dm.policy: pairing`) |
| Encrypted rooms fail | Crypto module missing or device not verified |
| Bot not joining rooms | `autoJoin: off` or room not in `autoJoinAllowlist` |
