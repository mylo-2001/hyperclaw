# Connect Tab Protocol — Mobile Nodes

The Connect tab protocol allows mobile apps (iOS/Android) to connect to the HyperClaw gateway as *mobile nodes* and receive commands (photo, location, etc.) from the AI agent.

## Overview

| Component | Description |
|-----------|-------------|
| **Gateway** | WebSocket server (`ws://localhost:18789` or Tailscale) |
| **Node** | Mobile app session that sends `node_register` |
| **API** | `GET /api/nodes` — list connected nodes |

## WebSocket messages

### Node → Gateway

- **`node_register`** — Register as a mobile node:
  ```json
  { "type": "node_register", "nodeId": "iPhone-1", "platform": "ios", "deviceName": "My iPhone", "capabilities": { "camera": true, "location": true }, "token": "<gateway_token>" }
  ```

### Gateway → Node

- **`node:registered`** — Registration confirmed:
  ```json
  { "type": "node:registered", "nodeId": "iPhone-1" }
  ```
- **`node:command`** — Command to device (from node_command tool):
  ```json
  { "type": "node:command", "id": "cmd-123", "command": "take_photo" }
  ```

### Node → Gateway (response)

- **`node:command_response`** — Command result:
  ```json
  { "type": "node:command_response", "id": "cmd-123", "ok": true, "data": { "photoBase64": "..." } }
  ```

## CLI

```bash
# List connected nodes
hyperclaw nodes
```

## REST API

```
GET /api/nodes
→ { "nodes": [ { "nodeId", "platform", "capabilities", "deviceName", "connectedAt" } ] }
```

## Setup

1. Start the gateway: `hyperclaw daemon start`
2. Open the iOS/Android app → Connect tab
3. Connect to `ws://<gateway-host>:18789` (or Tailscale URL)
4. The AI agent can send commands via the `node_command` tool

## See also

- [Gateway Protocol](protocols/gateway-protocol.md)
- [mobile-nodes.md](mobile-nodes.md)
- [mobile-desktop-apps.md](mobile-desktop-apps.md)
