# Tailscale Serve / Funnel — HyperClaw

Expose the gateway to the internet via Tailscale for secure remote access without open ports.

---

## Tailscale Serve (your private network)

1. Install [Tailscale](https://tailscale.com/download)
2. Connect: `tailscale login`
3. Serve:
   ```bash
   tailscale serve https / http://127.0.0.1:18789
   ```
4. The gateway will be available at your Tailscale hostname (e.g. `https://your-machine.tailnet-name.ts.net`)

---

## Tailscale Funnel (public)

⚠️ Warning: Funnel opens access to everyone. Always use `authToken` in gateway config.

```bash
tailscale funnel 443
tailscale serve https / http://127.0.0.1:18789
```

---

## Gateway settings

In `hyperclaw.json`:
```json
{
  "gateway": {
    "port": 18789,
    "bind": "127.0.0.1",
    "authToken": "your-secret-token"
  }
}
```

When using Tailscale Funnel, always set `authToken` for protection.
