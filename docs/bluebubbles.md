# BlueBubbles (iMessage) — HyperClaw

**Status:** Bundled. Talks to the BlueBubbles macOS server over HTTP + WebSocket. Recommended for iMessage integration.

---

## Overview

- Runs on macOS via the BlueBubbles helper app ([bluebubbles.app](https://bluebubbles.app)).
- HyperClaw talks to it through the REST API (`GET /api/v1/server/info`, `POST /message/text`) and WebSocket for inbound messages.
- Incoming messages arrive via WebSocket; outgoing replies are REST calls.
- Pairing/allowlist works like other channels (`hyperclaw pairing approve bluebubbles <CODE>`).

---

## Quick start

1. **Install BlueBubbles server** on your Mac ([bluebubbles.app/install](https://bluebubbles.app/install)).
2. In BlueBubbles config, enable the web API and set a password.
3. **Configure** (onboard wizard or manually):

```json
{
  "gateway": { "enabledChannels": ["imessage"] },
  "channels": {
    "imessage": {
      "enabled": true,
      "serverUrl": "http://192.168.1.100:1234",
      "password": "your-password"
    }
  }
}
```

4. Start the gateway. Pair first contact: `hyperclaw pairing approve bluebubbles <CODE>`.

**Channel IDs:** Use `imessage` or `bluebubbles` — both use the same connector.

---

## Security

- **Always set a password** on the BlueBubbles server.
- The connector sends the password in the WebSocket URL and API requests.
- Keep the server URL and password secret.
- Use HTTPS if exposing the server outside your LAN.

---

## Keeping Messages.app alive (VM / headless)

On some macOS setups, Messages.app can go idle (incoming events stop until the app is foregrounded). Poke Messages periodically:

### 1. Save the AppleScript

Save as `~/Scripts/poke-messages.scpt`:

```
try
  tell application "Messages"
    if not running then launch
    set _chatCount to (count of chats)
  end tell
on error
end try
```

### 2. Install a LaunchAgent

Save as `~/Library/LaunchAgents/com.user.poke-messages.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.user.poke-messages</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>/usr/bin/osascript "$HOME/Scripts/poke-messages.scpt"</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>StandardOutPath</key>
    <string>/tmp/poke-messages.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/poke-messages.err</string>
  </dict>
</plist>
```

Load it:

```bash
launchctl unload ~/Library/LaunchAgents/com.user.poke-messages.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.user.poke-messages.plist
```

First run may trigger Automation prompts; approve in the same user session.

---

## Access control

### DMs

| `channels.imessage.dmPolicy` | Behavior |
|-----------------------------|----------|
| `pairing` (default) | Unknown senders get a code. Approve: `hyperclaw pairing approve bluebubbles <CODE>`. |
| `allowlist` | Only addresses in `allowFrom` can DM. |
| `open` | Public DMs (use with caution). |
| `disabled` | Ignore inbound DMs. |

`allowFrom` accepts handles, emails, E.164 numbers.

### Groups

| Setting | Description |
|---------|-------------|
| `groupPolicy` | `open` \| `allowlist` \| `disabled` |
| `groupAllowFrom` | Sender allowlist for groups. |
| `groups` | Per-group `requireMention`, etc. |

**Note:** Group support in the connector is MVP; full policy/mention gating is planned.

---

## Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable channel |
| `serverUrl` | string | required | BlueBubbles REST API base (e.g. `http://192.168.1.100:1234`) |
| `password` | string | required | API password |
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `disabled` |
| `allowFrom` | string[] | [] | DM allowlist |

**Env:** `BLUEBUBBLES_SERVER_URL`, `BLUEBUBBLES_PASSWORD`

---

## Mention gating (groups, planned)

When group support is complete, mention gating will use `agents.list[].groupChat.mentionPatterns` and per-group `requireMention`:

```json
{
  "channels": {
    "imessage": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["+15555550123"],
      "groups": {
        "*": { "requireMention": true },
        "iMessage;-;chat123": { "requireMention": false }
      }
    }
  },
  "agents": {
    "list": [{ "id": "main", "groupChat": { "mentionPatterns": ["@hyperclaw", "+15555550123"], "historyLimit": 50 } }]
  }
}
```

---

## Typing and read receipts

- Typing indicators: Planned.
- Read receipts: `channels.imessage.sendReadReceipts` (planned).

---

## Advanced actions (planned)

BlueBubbles supports edit, unsend, tapbacks, reply threading, message effects, group management. These will be exposed as channel actions when the connector is extended.

---

## Addressing / delivery

- **chat_guid:** `iMessage;-;+15555550123` (preferred for stable routing)
- **Direct handles:** `+15555550123`, `user@example.com`

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Not receiving messages | Verify BlueBubbles server is running and Web API is enabled. Check server URL and password. |
| Pairing code expired | Codes expire after 1 hour. Run `hyperclaw pairing list bluebubbles` and approve promptly. |
| Messages.app idle | Use the LaunchAgent to poke Messages every 5 minutes (see above). |
| Connection drops | Connector auto-reconnects WebSocket. Restart gateway if needed. |

---

## Related

- [iMessage native (imsg)](imessage-native.md) — legacy alternative
- [Groups](group-messages.md) — group policy, mention gating
- [Pairing](security.md#pairing)
