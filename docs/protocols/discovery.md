# Discovery — HyperClaw

How clients discover the HyperClaw Gateway.

---

## Bonjour / mDNS (LAN)

The iOS and Android apps browse for `_hyperclaw._tcp` on the local network to discover Gateways.

- **Service type:** `_hyperclaw._tcp`
- **Scope:** Same LAN only (mDNS does not cross networks)
- **Used by:** iOS app (NWBrowser), Android app

The gateway supports config `gateway.mdnsMode` (`minimal` | `full` | `off`). When enabled, the Gateway advertises its WebSocket endpoint for discovery.

---

## Tailnet (cross-network)

For remote access across networks:

1. Install [Tailscale](https://tailscale.com/download)
2. Both Gateway host and client join the same tailnet
3. Connect to the Gateway via MagicDNS or tailnet IP, e.g. `ws://hostname.tailnet-name.ts.net:18789`

See [Tailscale](../tailscale.md).

---

## Manual / SSH tunnel

When no direct route exists:

```bash
ssh -N -L 18789:127.0.0.1:18789 user@gateway-host
```

Then connect to `ws://127.0.0.1:18789` locally. See [macOS Remote Control](../macos-remote-control.md).

---

## Transport selection

Recommended client behavior:

1. Use a stored Gateway URL if configured
2. If on LAN, browse `_hyperclaw._tcp` and offer discovered Gateways
3. If on tailnet, try Tailscale MagicDNS
4. Fall back to SSH tunnel when needed

---

## Related

- [Gateway Protocol](gateway-protocol.md)
- [Tailscale](../tailscale.md)
- [macOS Remote Control](../macos-remote-control.md)
- [Mobile Nodes](../mobile-nodes.md)
