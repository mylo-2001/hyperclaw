# Gateway Protocol — HyperClaw

The Gateway WebSocket is the control plane for HyperClaw. All clients (CLI, web UI, macOS app, iOS/Android nodes) connect over WebSocket.

---

## Transport

- **Protocol:** WebSocket, text frames, JSON payloads
- **Default URL:** `ws://127.0.0.1:18789` (same port as HTTP)
- **Auth:** Bearer token when `gateway.authToken` (or `HYPERCLAW_GATEWAY_TOKEN`) is set

---

## Handshake

### With auth enabled

1. **Client** opens WebSocket to the Gateway.
2. **Gateway → Client:** `connect.challenge`
   ```json
   { "type": "connect.challenge", "sessionId": "abc123" }
   ```
3. **Client → Gateway:** `auth` with token
   ```json
   { "type": "auth", "token": "<gateway_token>" }
   ```
4. **Gateway → Client:** `auth.ok` or `connect.ok`
   ```json
   { "type": "auth.ok", "sessionId": "abc123" }
   ```
   Or if no auth was required:
   ```json
   { "type": "connect.ok", "sessionId": "abc123", "version": "5.0.1", "heartbeatInterval": 30000 }
   ```

If token is invalid, the Gateway closes the socket with code `4001` (Unauthorized).

### Without auth

When no auth token is configured, the Gateway sends `connect.ok` immediately after connection.

---

## Message framing

Messages are JSON objects with a `type` field. No `req`/`res` id pattern — responses use the same `type` for replies (e.g. `ping` → `pong`).

| Direction | `type` | Description |
|-----------|--------|-------------|
| G→C | `connect.challenge` | Auth required; send `auth` with token |
| G→C | `connect.ok` | Session established (no auth) |
| G→C | `auth.ok` | Auth succeeded |
| G→C | `presence:join` | Another session connected |
| G→C | `presence:leave` | Session disconnected |
| C→G | `auth` | Respond to challenge with token |
| C→G | `ping` | Keepalive |
| G→C | `pong` | Keepalive reply |
| C→G | `chat:message` | Send user message |
| G→C | `chat:chunk` | Streaming token |
| G→C | `chat:response` | Complete response |
| C→G | `talk:enable` | Enable Talk Mode |
| C→G | `talk:disable` | Disable Talk Mode |
| G→C | `talk:ok` | Talk mode updated |
| C→G | `elevated:enable` | Request elevated (host) exec |
| C→G | `elevated:disable` | Disable elevated |
| G→C | `elevated:ok` | Elevated mode updated |
| C→G | `gateway:status` | Request status |
| G→C | `gateway:status` | Status reply |
| C→G | `presence:list` | List sessions |
| G→C | `presence:list` | Session list |
| C→G | `config:get` | Get config |
| G→C | `config:data` | Config payload |
| G→C | `error` | Error message |

---

## Chat flow

1. Client sends `chat:message`:
   ```json
   { "type": "chat:message", "content": "Hello" }
   ```
2. Gateway streams tokens via `chat:chunk` (optional)
3. Gateway sends final `chat:response`:
   ```json
   { "type": "chat:response", "content": "Hi there!" }
   ```
4. If Talk Mode is enabled, the Gateway synthesizes audio after the response.

---

## Node registration (mobile nodes)

Mobile apps (iOS/Android) register as *nodes* to receive device commands. Node messages are allowed before auth if they include a valid token.

**Client → Gateway:**
```json
{
  "type": "node_register",
  "nodeId": "iPhone-1",
  "platform": "ios",
  "deviceName": "John's iPhone",
  "capabilities": { "camera": true, "location": true, "screenRecord": true },
  "token": "<gateway_token>"
}
```

**Gateway → Client:**
```json
{
  "type": "node:registered",
  "nodeId": "iPhone-1",
  "sessionId": "...",
  "protocolVersion": 2,
  "heartbeatInterval": 30000,
  "capabilities": ["camera", "location", "screenRecord"]
}
```

Nodes receive `node:command` and reply with `node:command_response`. See [Connect Tab Protocol](../connect-tab-protocol.md).

---

## Session restore

Clients can restore transcript from a previous session:

```json
{ "type": "session:restore", "restoreKey": "telegram:123456" }
```

Gateway responds with `session:restored` and `transcript` when available.

---

## Headers

- **`X-Hyperclaw-Source`** — Optional source identifier (e.g. `macos`, `webchat`). Used for presence and logging.

---

## Related

- [Gateway API](../api/gateway-api.md) — HTTP REST endpoints
- [Connect Tab Protocol](../connect-tab-protocol.md) — Mobile node protocol
- [Architecture](../architecture.md)
