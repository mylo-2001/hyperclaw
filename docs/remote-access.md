# Remote Access
---

<div align="center">

[← Deployment](deployment.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Tailscale →](tailscale.md)

</div>

---

HyperClaw supports “remote over SSH” by keeping a single Gateway (the master) on a dedicated host and connecting clients to it via SSH tunneling or Tailscale.

---

## The Core Idea

The Gateway WebSocket binds to loopback on your configured port (default 18789).

- **For remote use**: Forward that port over SSH (or use a tailnet/VPN).
- **Operators** (CLI, desktop app): SSH tunneling is the universal fallback.
- **Nodes** (iOS/Android, Connect tab): Connect to the Gateway WebSocket via LAN, tailnet, or SSH tunnel.

---

## Common Setups

### 1) Always-on Gateway (VPS or home server)

Run the Gateway on a persistent host and reach it via Tailscale or SSH.

- **Best UX**: Keep `gateway.bind: "127.0.0.1"` and use [Tailscale Serve](tailscale.md) for the Control UI / WebSocket.
- **Fallback**: Keep loopback + SSH tunnel from any machine that needs access.

Ideal when your laptop sleeps often but you want the agent always-on.

### 2) Home desktop runs Gateway, laptop is remote control

The laptop does **not** run the agent. It connects remotely:

- Use SSH port forwarding: `ssh -N -L 18789:127.0.0.1:18789 user@home-desktop`
- Set `gateway.mode: "remote"` and `gateway.remote.url` in config (see below).
- The macOS app (if available) can use “Remote over SSH” mode to manage the tunnel.

### 3) Laptop runs Gateway, remote from other machines

Keep the Gateway local but expose it safely:

- SSH tunnel to the laptop from other machines, or
- Tailscale Serve the Control UI and keep the Gateway loopback-only.

---

## Command Flow (What Runs Where)

One gateway service owns state + channels. Nodes are peripherals.

**Example (Telegram → node):**

1. Telegram message arrives at the Gateway.
2. Gateway runs the agent and decides whether to call a node tool.
3. Gateway calls the node over the Gateway WebSocket (`node.*` RPC).
4. Node returns the result; Gateway replies back out to Telegram.

**Notes:**

- Nodes do **not** run the gateway service.
- Only one gateway should run per host unless you intentionally run isolated profiles.

---

## SSH Tunnel (CLI + Tools)

Create a local tunnel to the remote Gateway:

```bash
ssh -N -L 18789:127.0.0.1:18789 user@host
```

With the tunnel up:

- `hyperclaw health` and `hyperclaw status --deep` reach the remote gateway via `http://127.0.0.1:18789`.
- The CLI uses the forwarded port by default when `gateway.mode` is `"remote"` or when no local gateway is running.

Replace `18789` with your configured `gateway.port` if different.

See [Remote Gateway Setup](remote-gateway-setup.md) for step-by-step SSH config and auto-start.

---

## CLI Remote Defaults

Persist a remote target so CLI commands use it by default:

```json
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "http://127.0.0.1:18789",
      "token": "your-token"
    }
  }
}
```

When the gateway is loopback-only, keep the URL at `http://127.0.0.1:18789` and open the SSH tunnel first.

**Note:** When using `--url` explicitly, the CLI does not fall back to config or environment credentials. Include `--token` or `--password` explicitly if auth is required.

---

## Credential Precedence

Gateway calls use this resolution order:

| Source | Token | Password |
|--------|-------|----------|
| Explicit (`--token`, `--password`) | Always wins | Always wins |
| Env | `HYPERCLAW_GATEWAY_TOKEN` | `HYPERCLAW_GATEWAY_PASSWORD` |
| Config (local) | `gateway.authToken` → `gateway.remote.token` | — |
| Config (remote mode) | `gateway.remote.token` | `gateway.remote.password` |

---

## Chat UI over SSH

WebChat connects directly to the Gateway WebSocket. Forward port 18789 over SSH, then connect clients to `ws://127.0.0.1:18789` (or `http://127.0.0.1:18789` for HTTP endpoints).

---

## Security Rules

- **Keep the Gateway loopback-only** unless you need a non-loopback bind.
- **Loopback + SSH/Tailscale** is the safest default (no public exposure).
- Non-loopback binds (LAN/tailnet/custom) must use auth tokens or passwords.
- `gateway.remote.token` / `gateway.remote.password` are **client** credential sources; they do not configure server auth by themselves.

---

## Related

- [Remote Gateway Setup](remote-gateway-setup.md) — Step-by-step SSH config
- [Tailscale](tailscale.md) — Serve/Funnel for HTTPS and tailnet access
- [macOS Remote Control](macos-remote-control.md) — App + tunnel flow

---

<div align="center">

[← Deployment](deployment.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Tailscale →](tailscale.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>