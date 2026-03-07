# Multiple Gateways

Most setups should use **one Gateway** because a single Gateway can handle multiple messaging connections and agents. If you need stronger isolation or redundancy (e.g., a rescue bot), run separate Gateways with isolated profiles/ports.

---

## Isolation Checklist (Required)

All four must be unique per instance. Sharing any of these causes config races and port conflicts:

| Setting | Purpose |
|---------|---------|
| `HYPERCLAW_CONFIG_PATH` | Per-instance config file |
| `HYPERCLAW_STATE_DIR` | Per-instance sessions, creds, caches |
| `agents.defaults.workspace` | Per-instance workspace root |
| `gateway.port` (or `--port`) | Unique base port per instance |

> Derived ports (browser/canvas) must not overlap. Leave at least **20 ports** between base ports so derived browser/canvas/CDP ports never collide.

---

## Recommended: Profiles (`--profile`)

Profiles auto-scope `HYPERCLAW_STATE_DIR` + `HYPERCLAW_CONFIG_PATH` and suffix service names:

```bash
# Main
hyperclaw --profile main setup
hyperclaw --profile main gateway --port 18789

# Rescue
hyperclaw --profile rescue setup
hyperclaw --profile rescue gateway --port 19001
```

**Per-profile services:**
```bash
hyperclaw --profile main gateway install
hyperclaw --profile rescue gateway install
```

When `--profile <name>` is used, HyperClaw automatically sets:
- `HYPERCLAW_STATE_DIR=~/.hyperclaw-<name>`
- `HYPERCLAW_CONFIG_PATH=~/.hyperclaw-<name>/hyperclaw.json`

(Explicit env vars take precedence over `--profile`.)

---

## Rescue-Bot Guide

Run a second Gateway on the same host with its own:
- profile/config
- state dir
- workspace
- base port (plus derived ports)

This keeps the rescue bot isolated from the main bot so it can debug or apply config changes if the primary bot is down.

> **Port spacing:** Leave at least 20 ports between base ports so derived browser/canvas/CDP ports never collide.

### How to Install (Rescue Bot)

```bash
# Main bot (existing or fresh)
# Runs on port 18789 + derived ports
hyperclaw onboard
hyperclaw gateway install

# Rescue bot (isolated profile + ports)
hyperclaw --profile rescue onboard
# Notes:
#   - workspace name is postfixed with -rescue by default
#   - Use a port at least 20 away from main (e.g. 19001 or 19789)
#   - Rest of onboarding is the same as normal

# Install service (if not done automatically during onboarding)
hyperclaw --profile rescue gateway install
```

---

## Port Mapping (Derived Ports)

Base port = `gateway.port` (or `HYPERCLAW_GATEWAY_PORT` / `--port`).

| Service | Derived Port |
|---------|-------------|
| WebSocket / HTTP gateway | `base` |
| Browser control service | `base + 2` (loopback only) |
| Canvas host | Same port as `gateway.port` (HTTP) |
| Browser profile CDP ports | `browser.controlPort + 9` through `+ 108` (auto-allocated) |

> If you override any of these in config or env, you must keep them unique per instance.

---

## Browser/CDP Notes (Common Footgun)

- Do **not** pin `browser.cdpUrl` to the same values on multiple instances.
- Each instance needs its own browser control port and CDP range (derived from its gateway port).
- If you need explicit CDP ports, set `browser.profiles.<name>.cdpPort` per instance.
- Remote Chrome: use `browser.profiles.<name>.cdpUrl` (per profile, per instance).

---

## Manual Env Example

```bash
# Main
HYPERCLAW_CONFIG_PATH=~/.hyperclaw/main.json \
HYPERCLAW_STATE_DIR=~/.hyperclaw-main \
hyperclaw gateway --port 18789

# Rescue
HYPERCLAW_CONFIG_PATH=~/.hyperclaw/rescue.json \
HYPERCLAW_STATE_DIR=~/.hyperclaw-rescue \
hyperclaw gateway --port 19001
```

---

## Quick Checks

```bash
hyperclaw --profile main status
hyperclaw --profile rescue status
hyperclaw --profile rescue browser status
```

---

## See Also

- [Gateway Lock](./gateway-lock.md)
- [Troubleshooting](./troubleshooting.md)
