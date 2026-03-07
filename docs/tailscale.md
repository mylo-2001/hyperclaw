# Tailscale Serve / Funnel — HyperClaw

Expose the gateway to your tailnet (or the public internet) via Tailscale for secure remote access without open ports.

---

## Modes

| Mode | Description |
|------|-------------|
| **serve** | Tailnet-only — gateway reachable only by devices on your tailnet |
| **funnel** | Public HTTPS — gateway reachable from the internet (use with auth) |
| **off** | Default — no Tailscale automation |

---

## Auth

- **Token (default)** when `gateway.authToken` or `HYPERCLAW_GATEWAY_TOKEN` is set
- **Password** shared secret via `HYPERCLAW_GATEWAY_PASSWORD` or config

When using **Funnel**, always enable password or token auth to avoid public exposure.

---

## Tailscale Serve (Tailnet-Only)

Gateway reachable only by devices on your tailnet.

1. Install [Tailscale](https://tailscale.com/download)
2. Connect: `tailscale login`
3. Serve:
   ```bash
   tailscale serve https / http://127.0.0.1:18789
   ```
4. The gateway is available at your Tailscale hostname (e.g. `https://your-machine.tailnet-name.ts.net`)

### Config

```json
{
  "gateway": {
    "bind": "127.0.0.1",
    "port": 18789,
    "authToken": "your-token",
    "tailscaleExposure": "serve"
  }
}
```

---

## Tailscale Funnel (Public)

⚠️ **Warning:** Funnel opens access to everyone. Always use `authToken` or password.

```bash
tailscale funnel 443
tailscale serve https / http://127.0.0.1:18789
```

### Config (password recommended for Funnel)

```json
{
  "gateway": {
    "bind": "127.0.0.1",
    "port": 18789,
    "authToken": "your-secret-token",
    "tailscaleExposure": "funnel"
  }
}
```

Prefer `HYPERCLAW_GATEWAY_TOKEN` over committing a token to disk.

---

## Direct Tailnet Bind (No Serve/Funnel)

Bind the gateway directly to your Tailnet IP for tailnet-only access without HTTPS:

```json
{
  "gateway": {
    "bind": "tailnet",
    "port": 18789,
    "authToken": "your-token"
  }
}
```

Connect from another Tailnet device:

- Control UI: `http://<tailnet-ip>:18789/`
- WebSocket: `ws://<tailnet-ip>:18789`

Note: `http://127.0.0.1:18789` will not work in this mode.

---

## Gateway Settings

In `hyperclaw.json`:

```json
{
  "gateway": {
    "port": 18789,
    "bind": "127.0.0.1",
    "authToken": "your-secret-token",
    "tailscaleExposure": "off"
  }
}
```

| Setting | Values | Description |
|---------|--------|-------------|
| `bind` | `127.0.0.1` | Loopback only (default for Serve/Funnel) |
| `bind` | `tailnet` | Listen on Tailnet IP directly |
| `tailscaleExposure` | `off` \| `serve` \| `funnel` | Tailscale exposure mode |

---

## Prerequisites and Limits

- **Serve** requires Tailscale CLI installed and logged in; HTTPS enabled for your tailnet
- **Funnel** requires Tailscale v1.38.3+, MagicDNS, HTTPS enabled, funnel node attribute
- Funnel only supports ports 443, 8443, and 10000 over TLS

---

## Learn More

- [Tailscale Serve overview](https://tailscale.com/kb/1312/serve)
- [tailscale serve command](https://tailscale.com/kb/1242/tailscale-serve)
- [Tailscale Funnel overview](https://tailscale.com/kb/1223/tailscale-funnel)
- [tailscale funnel command](https://tailscale.com/kb/1311/tailscale-funnel)
