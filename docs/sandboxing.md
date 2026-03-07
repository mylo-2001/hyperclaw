# Sandboxing

HyperClaw supports two complementary sandboxing approaches:

1. **Run the full Gateway in Docker** — container boundary for the whole process
2. **Tool sandbox** — Docker-isolated tool execution while the Gateway runs natively on the host

Both can be combined for maximum isolation.

---

## Quick setup

### 1. Build the sandbox image

```bash
# From the project root
scripts/sandbox-setup.sh
```

Or build manually:

```bash
docker build -f Dockerfile.sandbox -t hyperclaw:sandbox .
```

### 2. Enable sandbox mode in config

```jsonc
// ~/.hyperclaw/hyperclaw.json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "non-main",
        "scope": "agent",
        "workspaceAccess": "none"
      }
    }
  }
}
```

---

## Sandbox modes

| Mode | Behavior |
|------|----------|
| `off` | No sandboxing — all tools run on the gateway host |
| `non-main` _(recommended)_ | Sandbox only non-main sessions (Telegram, Discord, etc.) — CLI stays native |
| `all` | Sandbox every tool call, including CLI sessions |

---

## Scope

Controls container reuse across sessions:

| Scope | Behavior |
|-------|----------|
| `agent` _(default)_ | One container per agent — sessions share it |
| `session` | One container per session — stricter isolation |
| `shared` | All agents share one container — least isolated |

---

## Workspace access

Controls whether the agent's workspace directory is mounted inside the sandbox:

| Value | Behavior |
|-------|----------|
| `none` _(default)_ | Agent workspace is not mounted — tools run in isolated `/sandbox` |
| `ro` | Agent workspace mounted read-only at `/agent` — no writes |
| `rw` | Agent workspace mounted read-write at `/workspace` |

---

## Full config reference

```jsonc
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "non-main",        // off | non-main | all
        "scope": "agent",          // agent | session | shared
        "workspaceAccess": "none", // none | ro | rw

        // Docker image to use (defaults to hyperclaw:sandbox)
        "image": "hyperclaw:sandbox",

        // Resource limits
        "memory": "512m",
        "cpus": "1.0",

        // Network access inside the container
        "network": "none",         // none | bridge | host (avoid host)

        // Dangerous: allow joining the container namespace (off by default)
        "docker": {
          "dangerouslyAllowContainerNamespaceJoin": false
        }
      }
    }
  }
}
```

---

## Per-agent overrides

You can override sandbox settings per agent:

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "personal",
        "sandbox": { "mode": "off" }   // Full access — no sandbox
      },
      {
        "id": "family",
        "sandbox": {
          "mode": "all",
          "scope": "agent",
          "workspaceAccess": "ro"       // Read-only workspace
        }
      },
      {
        "id": "public",
        "sandbox": {
          "mode": "all",
          "scope": "session",
          "workspaceAccess": "none",    // No workspace access
          "network": "none"             // No network from inside sandbox
        }
      }
    ]
  }
}
```

---

## Run the Gateway itself in Docker

For maximum isolation, run the entire Gateway in a container:

```bash
docker run -d \
  --name hyperclaw \
  -p 18789:18789 \
  -v ~/.hyperclaw:/data/hyperclaw \
  hyperclaw:latest
```

Or use Docker Compose (includes sandbox sidecar):

```bash
cp env.example .env   # fill in your API keys
docker compose --profile full up -d
```

---

## Security audit sandbox checks

`hyperclaw security audit` checks your sandbox configuration and flags:

| Check ID | Description |
|----------|-------------|
| `sandbox-configured-off` | Sandbox mode is `off` while `tools.exec.host` is set to `sandbox` |
| `tools.exec.host_sandbox_no_sandbox_defaults` | Exec host is `sandbox` but sandbox defaults are disabled |
| `sandbox.dangerous_network_mode` | Network mode is `host` or `container:*` — removes isolation |
| `elevated-enabled` | `tools.elevated` is on — runs exec on the gateway host, bypasses sandbox |

Run `hyperclaw security audit --fix` to auto-remediate safe findings.

---

## Common combinations

### Personal agent — no sandbox (full PC access)

```jsonc
{
  "agents": {
    "list": [{ "id": "personal", "sandbox": { "mode": "off" } }]
  }
}
```

### Shared/family agent — sandboxed, read-only

```jsonc
{
  "agents": {
    "list": [{
      "id": "family",
      "sandbox": { "mode": "all", "scope": "agent", "workspaceAccess": "ro" },
      "tools": {
        "deny": ["write", "edit", "apply_patch", "exec", "browser"]
      }
    }]
  }
}
```

### Public-facing agent — fully isolated

```jsonc
{
  "agents": {
    "list": [{
      "id": "public",
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "workspaceAccess": "none",
        "network": "none"
      },
      "tools": {
        "allow": ["sessions_list", "sessions_history", "sessions_send"],
        "deny": ["read", "write", "edit", "exec", "browser", "fs", "nodes"]
      }
    }]
  }
}
```

---

## Related

- [Security](./security.md) — full security model and audit guide
- [Configuration](./configuration.md) — full config reference
- [Deployment](./deployment.md) — Docker and production deployment
