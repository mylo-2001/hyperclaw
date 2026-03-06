# Connect Tab πρωτόκολλο — Mobile Nodes

Το πρωτόκολλο Connect tab επιτρέπει στα mobile apps (iOS/Android) να συνδέονται με το HyperClaw gateway ως *mobile nodes* και να λαμβάνουν εντολές (photo, location, κτλ.) από τον AI agent.

## Επισκόπηση

| Συστατικό | Περιγραφή |
|-----------|-----------|
| **Gateway** | WebSocket server (`ws://localhost:18789` ή Tailscale) |
| **Node** | Mobile app session που στέλνει `node:register` |
| **API** | `GET /api/nodes` — λίστα συνδεδεμένων nodes |

## WebSocket messages

### Node → Gateway

- **`node:register`** — Καταχώρηση ως mobile node:
  ```json
  { "type": "node:register", "nodeId": "iPhone-1", "platform": "ios", "deviceName": "My iPhone", "capabilities": { "camera": true, "location": true } }
  ```

### Gateway → Node

- **`node:registered`** — Επιβεβαίωση καταχώρησης:
  ```json
  { "type": "node:registered", "nodeId": "iPhone-1" }
  ```
- **`node:command`** — Εντολή προς το device (από node_command tool):
  ```json
  { "type": "node:command", "id": "cmd-123", "command": "take_photo" }
  ```

### Node → Gateway (response)

- **`node:command:result`** — Αποτέλεσμα εντολής:
  ```json
  { "type": "node:command:result", "id": "cmd-123", "ok": true, "data": { "photoBase64": "..." } }
  ```

## CLI

```bash
# Λίστα συνδεδεμένων nodes
hyperclaw nodes
```

## REST API

```
GET /api/nodes
→ { "nodes": [ { "nodeId", "platform", "capabilities", "deviceName", "connectedAt" } ] }
```

## Ρύθμιση

1. Ξεκίνα το gateway: `hyperclaw daemon start`
2. Άνοιξε το iOS/Android app → Connect tab
3. Σύνδεσε με `ws://<gateway-host>:18789` (ή Tailscale URL)
4. Ο AI agent μπορεί να στείλει εντολές μέσω του `node_command` tool

## Δείτε επίσης

- [mobile-desktop-apps.md](mobile-desktop-apps.md)
- [NodeRegistry](../src/services/nodes-registry.ts)
