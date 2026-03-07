# Tlon (Urbit Groups) — HyperClaw Setup Guide

> **Status:** supported via plugin. DMs, group mentions, thread replies, rich text formatting, and image uploads are supported. Reactions supported via bundled skill. Polls not yet supported.

Tlon is a decentralized messenger built on Urbit. HyperClaw connects to your Urbit ship and can respond to DMs and group chat messages. Group replies require an `@mention` by default and can be further restricted via allowlists.

---

## Prerequisites

- A running Urbit ship (local or hosted via Tlon.network)
- Your ship name (e.g. `~sampel-palnet`), ship URL, and login code
- HyperClaw installed (`npm install -g hyperclaw@latest`)

---

## Step 1 — Install the plugin

```bash
# From npm registry
hyperclaw plugins install @hyperclaw/extension-tlon

# Or from local checkout
hyperclaw plugins install ./extensions/tlon
```

---

## Step 2 — Gather your ship details

| Detail | Where to find it |
|--------|-----------------|
| Ship name | Displayed in Landscape: `~sampel-palnet` |
| Ship URL | Your hosting URL or `http://localhost:8080` for local |
| Login code | Landscape → Settings → System → Access key (`lidlut-tabwed-...`) |

---

## Step 3 — Minimal config

Add to `~/.hyperclaw/hyperclaw.json`:

```json
{
  "channels": {
    "tlon": {
      "enabled": true,
      "ship": "~sampel-palnet",
      "url": "https://sampel-palnet.tlon.network",
      "code": "lidlut-tabwed-pillex-ridrup",
      "ownerShip": "~your-main-ship"
    }
  }
}
```

Then restart the gateway:

```bash
hyperclaw gateway restart
```

---

## Private / LAN ships

By default, HyperClaw blocks private/internal hostnames and IP ranges (SSRF protection). For local ships:

```json
{
  "channels": {
    "tlon": {
      "url": "http://localhost:8080",
      "allowPrivateNetwork": true
    }
  }
}
```

Applies to: `http://localhost`, `http://192.168.x.x`, `http://my-ship.local`, etc.

> ⚠️ Only enable when you trust your local network — this disables SSRF protection for ship requests.

---

## Group channels

### Auto-discovery (default)

HyperClaw automatically discovers all group channels your ship is in:

```json
{
  "channels": {
    "tlon": {
      "autoDiscoverChannels": true
    }
  }
}
```

### Manually pin channels

```json
{
  "channels": {
    "tlon": {
      "groupChannels": ["chat/~host-ship/general", "chat/~host-ship/support"]
    }
  }
}
```

### Disable auto-discovery

```json
{
  "channels": {
    "tlon": {
      "autoDiscoverChannels": false
    }
  }
}
```

---

## Access control

### DM allowlist

```json
{
  "channels": {
    "tlon": {
      "dmAllowlist": ["~zod", "~nec"],
      "dmPolicy": "allowlist"
    }
  }
}
```

> `ownerShip` is **always** authorized — no need to add it to `dmAllowlist`.  
> Empty `dmAllowlist` with `dmPolicy: "allowlist"` means no DMs allowed.

### DM policy options

| Policy | Behaviour |
|--------|-----------|
| `pairing` (default) | Unknown ships get a 6-char code; approve with `hyperclaw pairing approve tlon <code>` |
| `allowlist` | Only ships in `dmAllowlist` (+ ownerShip) can DM |
| `open` | Any ship can DM |
| `disabled` | Ignore all DMs |

### Group authorization

```json
{
  "channels": {
    "tlon": {
      "defaultAuthorizedShips": ["~zod"],
      "authorization": {
        "channelRules": {
          "chat/~host-ship/general": {
            "mode": "restricted",
            "allowedShips": ["~zod", "~nec"]
          },
          "chat/~host-ship/announcements": {
            "mode": "open"
          }
        }
      }
    }
  }
}
```

---

## Owner and approval system

Set `ownerShip` to receive approval notifications when unauthorized ships try to interact:

```json
{
  "channels": {
    "tlon": {
      "ownerShip": "~your-main-ship"
    }
  }
}
```

**Owner ship is always authorized everywhere:**
- DM invites are auto-accepted
- Channel messages are always allowed
- No need to add to `dmAllowlist` or `defaultAuthorizedShips`

**Owner receives DM notifications for:**
- DM requests from ships not in the allowlist
- Mentions in channels without authorization
- Group invite requests
- New pairing codes

---

## Auto-accept settings

```json
{
  "channels": {
    "tlon": {
      "autoAcceptDmInvites": true,
      "autoAcceptGroupInvites": false
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `autoAcceptDmInvites` | `true` | Auto-accept DM invites from ships in `dmAllowlist` |
| `autoAcceptGroupInvites` | `false` | Auto-accept all group invites |

---

## Delivery targets (for `hyperclaw message send` / cron)

| Target format | Destination |
|---------------|------------|
| `~sampel-palnet` | DM to ship |
| `dm/~sampel-palnet` | DM to ship (explicit) |
| `chat/~host-ship/channel` | Group channel |
| `group:~host-ship/group-name` | Group (resolves to chat nest) |

Example:

```bash
hyperclaw message send tlon "~nec" "Hello from cron!"
hyperclaw message send tlon "chat/~zod/general" "Scheduled update"
```

---

## Mention gating in groups

By default, the bot only responds when explicitly mentioned:

```json
{
  "channels": {
    "tlon": {
      "requireMention": true
    }
  }
}
```

Mention format: `~your-bot-ship` (e.g. `~sampel-palnet, tell me the weather`).

Set `requireMention: false` to respond to all group messages.

---

## Thread replies

If the inbound message is in a thread, HyperClaw replies in-thread automatically. The `threadId` is preserved from the inbound message's `replyTo` field.

---

## Rich text

HyperClaw converts Markdown formatting to Tlon's native verse block format:

| Markdown | Tlon format |
|----------|------------|
| `**bold**` | Bold inline |
| `*italic*` | Italic inline |
| `` `code` `` | Code inline |
| `# Heading` | Header block (h1) |
| `- item` | Listing block |
| `\n\n` | Paragraph break |
| `~ship` | Ship link |

Tlon converts inbound verse blocks back to plain text for the agent.

---

## Images

Image URLs in outbound messages are embedded as Tlon image blocks. Inbound image blocks are transcribed as `[image: <url>]` for the agent.

---

## Bundled skill

The Tlon plugin includes a bundled skill that provides CLI access to Tlon operations:

| Command | Description |
|---------|-------------|
| `/tlon channels list` | List all known channels |
| `/tlon channels post <nest> <msg>` | Post to a channel |
| `/tlon dms send ~ship <msg>` | Send a DM |
| `/tlon react <nest> <postId> <emoji>` | Add reaction |
| `/tlon unreact <nest> <postId> <emoji>` | Remove reaction |
| `/tlon pairing list` | List pending pairing codes |
| `/tlon pairing approve <code>` | Approve a pairing code |
| `/tlon ships` | List approved ships |

> Management commands (`pairing`, `react`) are owner-only by default.

---

## Full config reference

```json
{
  "channels": {
    "tlon": {
      "enabled": true,
      "ship": "~sampel-palnet",
      "url": "https://your-ship-host",
      "code": "lidlut-tabwed-pillex-ridrup",
      "allowPrivateNetwork": false,
      "ownerShip": "~your-main-ship",
      "dmAllowlist": ["~zod", "~nec"],
      "dmPolicy": "pairing",
      "autoAcceptDmInvites": true,
      "autoAcceptGroupInvites": false,
      "autoDiscoverChannels": true,
      "groupChannels": ["chat/~host-ship/general"],
      "defaultAuthorizedShips": ["~zod"],
      "authorization": {
        "channelRules": {
          "chat/~host-ship/general": {
            "mode": "restricted",
            "allowedShips": ["~zod", "~nec"]
          },
          "chat/~host-ship/announcements": {
            "mode": "open"
          }
        }
      },
      "requireMention": true,
      "showModelSignature": false,
      "mediaMaxMb": 20
    }
  }
}
```

### Config field reference

| Field | Default | Description |
|-------|---------|-------------|
| `ship` | required | Bot's Urbit ship name |
| `url` | required | Ship URL |
| `code` | required | Ship login code |
| `allowPrivateNetwork` | `false` | Allow localhost/LAN URLs |
| `ownerShip` | `""` | Owner ship (always authorized, receives notifications) |
| `dmAllowlist` | `[]` | Ships allowed to DM (empty = none) |
| `dmPolicy` | `"pairing"` | Policy for ships not in allowlist |
| `autoAcceptDmInvites` | `true` | Auto-accept DMs from allowlisted ships |
| `autoAcceptGroupInvites` | `false` | Auto-accept all group invites |
| `autoDiscoverChannels` | `true` | Auto-discover group channels |
| `groupChannels` | `[]` | Manually pinned channel nests |
| `defaultAuthorizedShips` | `[]` | Ships authorized for all channels |
| `authorization.channelRules` | `{}` | Per-channel auth rules |
| `requireMention` | `true` | Require @mention in group channels |
| `showModelSignature` | `false` | Append model name to messages |
| `mediaMaxMb` | `20` | Max media size in MB |

---

## Capabilities

| Feature | Status |
|---------|--------|
| Direct messages | ✅ Supported |
| Groups/channels | ✅ Supported (mention-gated by default) |
| Threads | ✅ Supported (auto-replies in thread) |
| Rich text | ✅ Markdown → Tlon verse blocks |
| Images | ✅ Embedded as image blocks |
| Reactions | ✅ Via bundled skill |
| Polls | ❌ Not yet supported |
| Native commands | ✅ Via bundled skill (owner-only) |

---

## Troubleshooting

Run this ladder first:

```bash
hyperclaw status
hyperclaw gateway status
hyperclaw logs --follow
hyperclaw doctor
```

### DMs ignored

- Sender not in `dmAllowlist` and no `ownerShip` configured for approval flow
- Check `dmPolicy` — if `disabled`, all DMs are dropped

### Group messages ignored

- Channel not in `groupChannels` and `autoDiscoverChannels: false`
- Sender not in `defaultAuthorizedShips` or `channelRules`
- Check that `requireMention: true` and the message includes `~your-bot-ship`

### Connection errors

```
Tlon: login failed — check URL and code
```

- Verify the ship URL is reachable from the gateway host
- Enable `allowPrivateNetwork: true` for local ships
- Login codes rotate — get a fresh code from Landscape → Settings → Access key

### SSRF error

```
Tlon: ship URL "http://192.168.x.x:8080" resolves to a private/local address
```

Add `"allowPrivateNetwork": true` to your Tlon config.

### Auth errors (codes rotate)

Urbit login codes expire or rotate. Get a new one from:
- Landscape → System → Access key
- Or: `~your-ship +code` in the dojo

---

## Related docs

- [Security](./security.md)
- [Configuration](./configuration.md)
- [Plugins](./plugin-registry-community.md)
