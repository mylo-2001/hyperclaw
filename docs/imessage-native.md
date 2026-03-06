# iMessage native (imsg CLI)

iMessage without BlueBubbles — directly via the **imsg** CLI on macOS.

## Requirements

- macOS 14+
- **imsg** installed: [github.com/steipete/imsg](https://github.com/steipete/imsg) — `git clone ... && make build`
- Full Disk Access for Terminal/Node (to read Messages DB)
- Automation: Node/Terminal must be able to control Messages.app

## Setup

1. Add the `imessage-native` channel to enabled channels:

```bash
hyperclaw channels add imessage-native
```

2. In `hyperclaw.json` or from UI, enable the channel. No token needed — imsg runs locally.

3. (Optional) Set `IMSG_PATH` if imsg is not in PATH.

## Comparison with BlueBubbles

| | BlueBubbles (imessage) | imessage-native |
|--|------------------------|-----------------|
| Setup | BlueBubbles server on Mac | imsg binary only |
| Network | Requires access to Mac (HTTP/WS) | Local, no service |
| Permissions | Messages.app via server | Full Disk + Automation |

## Pairing

Same as other channels: the first message from a new number will receive a pairing code. Run `hyperclaw pairing approve imessage-native <CODE>` to approve.
