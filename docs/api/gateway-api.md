# Gateway API � HyperClaw

REST and WebSocket API for the HyperClaw Gateway. Default port: `18789`.

---

## Base URL

- Local: `http://127.0.0.1:18789`
- Same hostname for WebSocket: `ws://127.0.0.1:18789`

---

## Authentication

Most endpoints require authentication when `gateway.authToken` (or `HYPERCLAW_GATEWAY_TOKEN`) is set.

**Header:**
```
Authorization: Bearer <token>
```

401 responses include:
```json
{ "error": "Unauthorized", "hint": "Authorization: Bearer <gateway_token_or_developer_key>" }
```

---

## Endpoints

### Health & status

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/check` | No | Health check. Returns `{ ok: true, service: "hyperclaw", version: "5.0.1" }` |
| GET | `/api/status` | No | Gateway status: `{ running, port, channels, model, agentName, sessions, uptime }` |

### Config

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/config/apply` | Yes | Full config replace. Body: full config object. Rate-limited: 3 req/60s per device+IP. |
| POST | `/api/v1/config/patch` | Yes | Shallow merge config. Body: partial config. Same rate limit. |

Headers: `X-Hyperclaw-Device` (optional device id for rate limiting).

### Agent

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/pi` | Yes | PI JSON-RPC handler. Agent invocation via RPC. |
| POST | `/api/chat` | Yes | Send message, get response. Body: `{ message, agentId?, sessionKey? }` > `{ response }` |
| POST | `/api/webhook/inbound` | Yes | Generic inbound webhook. Body: `{ message }` or `{ text }` or `{ prompt }` > agent run |

### Nodes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/nodes` | Yes | List connected mobile nodes. Returns `{ nodes: [{ nodeId, platform, capabilities, deviceName, connectedAt, lastSeenAt }] }` |

### Traces & costs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/traces` | Yes | List traces. Query: `limit` (default 50, max 100) |
| GET | `/api/costs` | Yes | Cost summary. Query: `sessionId` (optional) |

### TTS

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/tts` | Yes | Text-to-speech. Body: `{ text }` > `{ format: "mp3", data: "<base64>" }` |

### Canvas

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/canvas/state` | Yes | Canvas state JSON |
| GET | `/api/canvas/a2ui` | Yes | A2UI NDJSON stream |

### Daemon

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/remote/restart` | Yes | Restart daemon (when running as daemon) |

### Webhooks (channels)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/webhook/:channelId` | No | Webhook verification (channel-specific) |
| POST | `/webhook/:channelId` | No | Inbound webhook from channel (Telegram, Discord, etc.) |

### UI

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Redirects to `/dashboard` |
| GET | `/dashboard` | No | Dashboard HTML |
| GET | `/chat` | No | Chat UI HTML |

---

## WebSocket

See [Gateway Protocol](../protocols/gateway-protocol.md) for the WebSocket control plane (sessions, chat, presence, nodes).

---

## Security

- Keep the Gateway on loopback (`127.0.0.1`) or a private network unless you use Tailscale/VPN.
- Always set `authToken` when exposing beyond loopback.
- See [Security](../security.md) and [Tailscale](../tailscale.md) for remote access.

---

## Related

- [Gateway Protocol](../protocols/gateway-protocol.md)
- [Connect Tab / Mobile Nodes](../protocols/connect-tab-protocol.md)
- [Architecture](../architecture.md)
