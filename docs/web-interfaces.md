# Web Interfaces — HyperClaw

The Gateway serves web UIs from the same port as the WebSocket (default `18789`).

---

## Overview

| Interface | URL | Description |
|-----------|-----|-------------|
| Dashboard | `http://<host>:18789/dashboard` | Status, quick links |
| Chat | `http://<host>:18789/chat` | Web chat via WebSocket |
| Root | `http://<host>:18789/` | Redirects to `/dashboard` |

All interfaces are on the same HTTP server. When `gateway.authToken` is set, API calls require `Authorization: Bearer <token>`; the static chat and dashboard may need the token for WebSocket/REST.

---

## Quick open (local)

1. Start the Gateway: `hyperclaw daemon start` or `hyperclaw gateway start`
2. Open in a browser:
   - Dashboard: http://127.0.0.1:18789/dashboard
   - Chat: http://127.0.0.1:18789/chat

---

## CLI Dashboard (terminal)

`hyperclaw dashboard` launches a **terminal** dashboard, not the browser UI:

```bash
hyperclaw dashboard           # One-shot status view
hyperclaw dashboard --live    # Live mode with updates (Ctrl+C to exit)
```

Shows: Gateway status, model, channels, skills, recent activity.

---

## Web Dashboard

Static HTML at `/dashboard`:

- Gateway status (from `/api/status`)
- Links to `/chat` and `/api/status`

When auth is required, the dashboard itself is unauthenticated; `/api/status` is public.

---

## Web Chat

Static HTML at `/chat`:

- Connects to Gateway WebSocket
- Uses `chat:message` → `chat:chunk` / `chat:response`
- Fallback to `POST /api/chat` if WebSocket is unavailable
- Markdown rendering for assistant replies

**Auth:** When `gateway.authToken` is set, the WebSocket receives `connect.challenge`. The static chat must send `auth` with the token. For token-based auth, use the React web app (`apps/web`) or provide the token in the UI if supported.

---

## apps/web (React UI)

A full React app with:

- **Chat** — Gateway chat via WebSocket/API
- **Dashboard** — Status, cost summary
- **Canvas** — AI-generated UI components
- **Hub** — Skills management
- **Memory** — Memory rules
- **Settings** — Config

### Run

```bash
cd apps/web && npm run dev
```

The app uses `http://localhost:18789` as the gateway base URL. Configure via env or app settings if the Gateway runs elsewhere.

---

## Tailscale access

### Serve (recommended)

Keep the Gateway on loopback and proxy via Tailscale:

```bash
tailscale serve https / http://127.0.0.1:18789
```

Then open: `https://<magicdns>/dashboard` or `https://<magicdns>/chat`

See [Tailscale](tailscale.md).

### Tailnet bind + token

```json
{
  "gateway": {
    "bind": "tailnet",
    "port": 18789,
    "authToken": "your-token"
  }
}
```

Open: `http://<tailscale-ip>:18789/dashboard` and paste the token when prompted.

### Funnel (public)

⚠️ Funnel exposes the gateway publicly. Always set `authToken` or password.

```bash
tailscale funnel 443
tailscale serve https / http://127.0.0.1:18789
```

---

## Security notes

- Default bind is `127.0.0.1` — web UIs are local-only unless you use Tailscale or change `gateway.bind`.
- When exposing beyond loopback, set `gateway.authToken` (or `HYPERCLAW_GATEWAY_TOKEN`).
- Plain HTTP on non-loopback: browsers may block WebCrypto in non-secure contexts. Prefer HTTPS (Tailscale Serve).
- Do not expose the dashboard/chat UI publicly without auth.

---

## If you see "unauthorized" or disconnect

1. Confirm the Gateway is reachable: `hyperclaw status`
2. Get the token: `hyperclaw config show` (or `gateway.authToken` in `hyperclaw.json`)
3. Paste the token in the UI settings (when the UI supports it)
4. For remote access: use SSH tunnel `ssh -N -L 18789:127.0.0.1:18789 user@host` then open http://127.0.0.1:18789/chat

---

## Webhooks

When hooks are enabled, the Gateway exposes webhook endpoints on the same HTTP server. See [Configuration](configuration.md) and [Architecture](architecture.md) for hook paths and payloads.

---

## Terminal alternatives

HyperClaw has **no** `hyperclaw tui` command. For terminal-based use:

- **`hyperclaw dashboard`** — Terminal status dashboard (gateway, channels, skills)
- **`hyperclaw agent`** — Run the agent interactively in the CLI
- **`hyperclaw agent --message "..."`** — One-shot agent run

---

## Device pairing

iOS, Android, and macOS apps connect to the Gateway as *devices*. New devices require one-time approval.

### CLI workflow

```bash
hyperclaw devices list              # List pending and paired devices
hyperclaw devices pair              # Create pairing request (prints setup code)
hyperclaw devices approve <requestId>   # Approve a pending device
hyperclaw devices reject <requestId>    # Reject a pending device
hyperclaw devices unpair <deviceId>     # Revoke a paired device
```

### First connection

When a new browser or device connects, the Gateway may require pairing. Local connections (127.0.0.1) are often auto-approved; remote connections (LAN, Tailnet) need explicit approval.

State: `~/.hyperclaw/devices/paired.json`, `pending.json`

See [Mobile Nodes](mobile-nodes.md) and [Connect Tab Protocol](connect-tab-protocol.md).

---

## Implementation notes (vs OpenClaw)

| Feature | HyperClaw |
|---------|-----------|
| **Dashboard** | `hyperclaw dashboard` = CLI terminal dashboard, **not** a browser launcher |
| **Control UI** | No Vite+Lit Control UI. Uses static `dashboard.html` and `chat.html` served by the Gateway |
| **TUI** | No `hyperclaw tui`. Use `hyperclaw dashboard` or `hyperclaw agent` for terminal |
| **URLs** | All UIs on root (`/`, `/dashboard`, `/chat`). No `controlUi.basePath` config |
| **Device pairing** | Supported via `hyperclaw devices list/approve/reject` |

---

## Related

- [Gateway API](api/gateway-api.md)
- [Mobile Nodes](mobile-nodes.md)
- [Connect Tab Protocol](connect-tab-protocol.md)
- [Tailscale](tailscale.md)
- [macOS Remote Control](macos-remote-control.md)
