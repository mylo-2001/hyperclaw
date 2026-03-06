# macOS remote control — Gateway via SSH

Control the HyperClaw gateway from the macOS app (or another client) via SSH.

## Methods

### 1. SSH port forwarding

On the Mac where the HyperClaw daemon is running, open a tunnel to the host where the gateway runs:

```bash
ssh -L 18789:127.0.0.1:18789 user@remote-host
```

Then in the macOS app set the gateway URL to `http://127.0.0.1:18789`. All calls (status, chat, WebSocket) go through the tunnel.

### 2. CLI via SSH

For status, restart, etc. from the macOS app (or a script):

```bash
ssh user@remote-host "hyperclaw gateway status"
ssh user@remote-host "hyperclaw daemon restart"
```

Set up SSH keys so no password is required.

### 3. API with auth

If the gateway has `gateway.authToken`:

- `GET /api/status` — no auth required
- `POST /api/remote/restart` — requires `Authorization: Bearer <token>`; returns instructions for restart via SSH

## Example (macOS app)

1. User provides remote host (user@host).
2. App runs `ssh -L 18789:127.0.0.1:18789 user@host -N` in the background.
3. Connects to WebSocket/HTTP at `http://127.0.0.1:18789`.
4. For restart: either `ssh user@host "hyperclaw daemon restart"` or show instructions from `POST /api/remote/restart`.
