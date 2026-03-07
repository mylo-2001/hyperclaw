# Configuration and Operations

HyperClaw configuration and operational tooling: Doctor, Health, Status, Heartbeat, Logging.

---

## Doctor

`hyperclaw doctor` is the repair and health-check tool. It finds misconfigurations, risky DM policies, and offers actionable repairs.

### Quick start

```bash
hyperclaw doctor
```

### Headless / automation

| Flag | Description |
|------|-------------|
| `--yes` | Accept defaults without prompting |
| `--fix` | Apply recommended repairs |
| `--repair` | Same as `--fix` |
| `--repair --force` | Apply aggressive repairs (e.g. overwrite supervisor configs) |
| `--non-interactive` | Skip prompts; only run safe migrations |
| `--deep` | Scan system services for extra gateway installs |

```bash
hyperclaw doctor --yes
hyperclaw doctor --repair
hyperclaw doctor --repair --force
hyperclaw doctor --non-interactive
hyperclaw doctor --deep
```

### What it does

- **Config**: Verifies config file exists and is readable
- **Gateway token**: Checks for auth token; can generate one
- **DM policies**: Warns on `open` policy; flags empty allowlist
- **Provider API key**: Ensures AI provider key is set
- **AGENTS.md**: Checks workspace memory files
- **Gateway running**: Verifies gateway port is reachable
- **Config permissions**: Warns if config is group/world readable; can chmod 600
- **State directory**: Ensures `~/.hyperclaw` exists
- **Auth store**: Fixes unsafe auth file permissions

---

## Health Checks

Short guide to verify connectivity without guessing.

### Quick checks

```bash
hyperclaw status              # Local summary: gateway, provider, channels
hyperclaw status --all        # Full local diagnosis
hyperclaw status --deep       # Probe the running gateway
hyperclaw health --json       # Gateway health snapshot as JSON
```

### Health command

```bash
hyperclaw health
hyperclaw health --json
hyperclaw health --timeout 5000
```

- Exits 0 when gateway is reachable
- Exits 1 when gateway is unreachable, times out, or returns invalid response
- `--json` outputs raw JSON for scripting

---

## Status

```bash
hyperclaw status
hyperclaw status --all
hyperclaw status --deep
```

- **Default**: Gateway reachability, provider, channel count
- **--all**: Config loaded, channels list
- **--deep**: Same plus gateway probe (sessions, uptime)

---

## Heartbeat

Heartbeat runs periodic agent turns in the main session. Enable via hooks (e.g. morning-briefing) or configure in `hyperclaw.json`:

```json
{
  "heartbeat": {
    "morningBriefing": { "enabled": true, "cron": "0 8 * * *" }
  }
}
```

See `hooks/morning-briefing` and `hooks/gateway-health` for built-in heartbeat-style automation. Full OpenClaw-style `agents.defaults.heartbeat` (every, target, activeHours) is planned.

---

## Logging

- **CLI logs**: `hyperclaw logs --follow`
- **Gateway log**: `~/.hyperclaw/gateway.log` (when run via daemon)
- **Config**: `logging.level`, `logging.file` in config

---

## Remote Access

When the gateway runs on a remote host, use SSH tunneling or Tailscale:

```bash
ssh -N -L 18789:127.0.0.1:18789 user@host
```

Config for remote mode:

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

See [Remote Access](remote-access.md) and [Remote Gateway Setup](remote-gateway-setup.md) for full guides.

---

## When something fails

| Symptom | Action |
|---------|--------|
| Gateway unreachable | `hyperclaw daemon start` or `hyperclaw gateway start` |
| Remote unreachable | Start SSH tunnel first; see [remote-gateway-setup](remote-gateway-setup.md) |
| Config errors | `hyperclaw doctor --fix` |
| Empty allowlist | `hyperclaw pairing approve <channel> <CODE>` |
| Port in use | Change `gateway.port` in config |

---

## Related

- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)
- [Remote Access](remote-access.md)
- [Discord Setup](discord-setup.md)
