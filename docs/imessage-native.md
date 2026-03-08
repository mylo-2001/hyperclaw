# iMessage native (imsg CLI) — Legacy
---

<div align="center">

[← BlueBubbles](bluebubbles.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Line →](line.md)

</div>

---

> **For new iMessage deployments, use [BlueBubbles](bluebubbles.md) instead.**
> The `imessage-native` integration is legacy and may be removed in a future release.

**Status:** legacy external CLI integration. Gateway spawns `imsg rpc` and communicates over JSON-RPC on stdio (no separate daemon/port).

---

## Requirements

- macOS 14+
- **imsg** installed: [github.com/steipete/imsg](https://github.com/steipete/imsg)
  ```bash
  brew install steipete/tap/imsg
  imsg rpc --help
  ```
- Full Disk Access granted to the process running HyperClaw/imsg (Messages DB access)
- Automation permission to control Messages.app

> **Permission note:** permissions are granted per process context. If running headless (LaunchAgent/SSH), trigger prompts once interactively in that same context:
> ```bash
> imsg chats --limit 1
> # or
> imsg send <handle> "test"
> ```

---

## Quick setup

```bash
# 1. Install and verify imsg
brew install steipete/tap/imsg
imsg rpc --help

# 2. Enable the channel
hyperclaw channels add imessage-native

# 3. Start gateway
hyperclaw gateway

# 4. Approve first DM pairing (default dmPolicy)
hyperclaw pairing list imessage-native
hyperclaw pairing approve imessage-native <CODE>
```

> Pairing requests expire after **1 hour**.

---

## Configuration reference

```jsonc
{
  "channels": {
    "imessage-native": {
      "enabled": true,
      // Optional: path to imsg binary if not in PATH (or set IMSG_PATH env var)
      "cliPath": "/usr/local/bin/imsg",
      // Optional: path to Messages SQLite DB (default: ~/Library/Messages/chat.db)
      "dbPath": "/Users/<you>/Library/Messages/chat.db",

      // DM policy: "pairing" | "allowlist" | "open" | "disabled"
      "dmPolicy": "pairing",
      "allowFrom": []
    }
  }
}
```

### dmPolicy

| Value | Behaviour |
|-------|-----------|
| `pairing` (default) | First DM receives a 6-character code; runs `hyperclaw pairing approve` to allow |
| `allowlist` | Only handles listed in `allowFrom` are accepted |
| `open` | All DMs accepted (requires `allowFrom` to include `"*"` for safety) |
| `disabled` | All DMs ignored |

---

## Comparison with BlueBubbles

|  | BlueBubbles (`imessage`) | imsg CLI (`imessage-native`) |
|--|--------------------------|------------------------------|
| Setup | BlueBubbles server on Mac | `imsg` binary only |
| Architecture | HTTP/WebSocket server | JSON-RPC on stdio (spawned process) |
| Permissions | Messages.app via server | Full Disk Access + Automation |
| Status | **Recommended** | **Legacy** |

---

## Troubleshooting

**`imsg rpc` not found or unsupported**
- Run `imsg rpc --help`. If the subcommand is missing, update imsg: `brew upgrade steipete/tap/imsg`.
- Set `cliPath` in config or `IMSG_PATH` env var to the full binary path.

**DMs are ignored**
- Check `dmPolicy`. If `pairing`, a code was sent — run `hyperclaw pairing list imessage-native`.

**macOS permission prompts were missed**
- Run `imsg chats --limit 1` in the same process context as the gateway to re-trigger system prompts.

**Pairing code expired**
- Codes expire after 1 hour. Send a new message to receive a fresh code.

---

<div align="center">

[← BlueBubbles](bluebubbles.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Line →](line.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>