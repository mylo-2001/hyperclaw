# Multi-Agent Sandbox & Tools

Each agent in a multi-agent setup can have its own:

- **Sandbox configuration** (`agents.list[].sandbox` overrides `agents.defaults.sandbox`)
- **Tool restrictions** (`tools.allow` / `tools.deny`, plus `agents.list[].tools`)

This allows you to run multiple agents with different security profiles:

- Personal assistant with full access
- Family/work agents with restricted tools
- Public-facing agents in sandboxes

> `setupCommand` belongs under `sandbox.docker` (global or per-agent) and runs once when the container is created.
> Auth is per-agent: each agent reads from its own `agentDir` auth store at `~/.hyperclaw/agents/<agentId>/agent/auth-profiles.json`. Credentials are **not** shared between agents.

---

## Configuration Examples

### Example 1: Personal + Restricted Family Agent

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "name": "Personal Assistant",
        "workspace": "~/.hyperclaw/workspace",
        "sandbox": { "mode": "off" }
      },
      {
        "id": "family",
        "name": "Family Bot",
        "workspace": "~/.hyperclaw/workspace-family",
        "sandbox": { "mode": "all", "scope": "agent" },
        "tools": {
          "allow": ["read"],
          "deny": ["exec", "write", "edit", "apply_patch", "process", "browser"]
        }
      }
    ]
  },
  "bindings": [
    {
      "agentId": "family",
      "match": {
        "channel": "whatsapp",
        "accountId": "*",
        "peer": { "kind": "group", "id": "120363424282127706@g.us" }
      }
    }
  ]
}
```

**Result:**
- `main` agent: Runs on host, full tool access
- `family` agent: Runs in Docker (one container per agent), only `read` tool

### Example 2: Work Agent with Shared Sandbox

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "personal",
        "workspace": "~/.hyperclaw/workspace-personal",
        "sandbox": { "mode": "off" }
      },
      {
        "id": "work",
        "workspace": "~/.hyperclaw/workspace-work",
        "sandbox": { "mode": "all", "scope": "shared", "workspaceRoot": "/tmp/work-sandboxes" },
        "tools": {
          "allow": ["read", "write", "apply_patch", "exec"],
          "deny": ["browser", "gateway", "discord"]
        }
      }
    ]
  }
}
```

### Example 2b: Global Coding Profile + Messaging-Only Agent

```jsonc
{
  "tools": { "profile": "coding" },
  "agents": {
    "list": [
      {
        "id": "support",
        "tools": { "profile": "messaging", "allow": ["slack"] }
      }
    ]
  }
}
```

**Result:**
- Default agents get coding tools
- `support` agent is messaging-only (+ Slack tool)

### Example 3: Different Sandbox Modes per Agent

```jsonc
{
  "agents": {
    "defaults": {
      "sandbox": { "mode": "non-main", "scope": "session" }
    },
    "list": [
      {
        "id": "main",
        "workspace": "~/.hyperclaw/workspace",
        "sandbox": { "mode": "off" }
      },
      {
        "id": "public",
        "workspace": "~/.hyperclaw/workspace-public",
        "sandbox": { "mode": "all", "scope": "agent" },
        "tools": { "allow": ["read"], "deny": ["exec", "write", "edit", "apply_patch"] }
      }
    ]
  }
}
```

---

## Configuration Precedence

### Sandbox Config

Agent-specific settings override global defaults:

| Agent-specific | Overrides |
|----------------|-----------|
| `agents.list[].sandbox.mode` | `agents.defaults.sandbox.mode` |
| `agents.list[].sandbox.scope` | `agents.defaults.sandbox.scope` |
| `agents.list[].sandbox.workspaceRoot` | `agents.defaults.sandbox.workspaceRoot` |
| `agents.list[].sandbox.docker.*` | `agents.defaults.sandbox.docker.*` |
| `agents.list[].sandbox.browser.*` | `agents.defaults.sandbox.browser.*` |
| `agents.list[].sandbox.prune.*` | `agents.defaults.sandbox.prune.*` |

### Tool Restriction Filtering Order

1. Tool profile (`tools.profile` or `agents.list[].tools.profile`)
2. Provider tool profile (`tools.byProvider[provider].profile`)
3. Global tool policy (`tools.allow` / `tools.deny`)
4. Provider tool policy (`tools.byProvider[provider].allow/deny`)
5. Agent-specific tool policy (`agents.list[].tools.allow/deny`)
6. Agent provider policy (`agents.list[].tools.byProvider[provider].allow/deny`)
7. Sandbox tool policy (`tools.sandbox.tools` or `agents.list[].tools.sandbox.tools`)
8. Subagent tool policy (`tools.subagents.tools`)

> Each level can **further restrict** tools, but cannot grant back denied tools from earlier levels.

---

## Tool Groups (Shorthands)

| Group | Expands to |
|-------|-----------|
| `group:runtime` | `exec`, `bash`, `process` |
| `group:fs` | `read`, `write`, `edit`, `apply_patch` |
| `group:sessions` | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status` |
| `group:memory` | `memory_search`, `memory_get` |
| `group:ui` | `browser`, `canvas` |
| `group:automation` | `cron`, `gateway` |
| `group:messaging` | `message` |
| `group:nodes` | `nodes` |
| `group:openclaw` | All built-in HyperClaw tools (excludes provider plugins) |

---

## Elevated Mode

`tools.elevated` is the global baseline (sender-based allowlist). `agents.list[].tools.elevated` can further restrict elevated for specific agents (both must allow).

**Mitigation patterns:**
- Deny `exec` for untrusted agents: `agents.list[].tools.deny: ["exec"]`
- Disable elevated globally: `tools.elevated.enabled: false`
- Disable elevated per agent: `agents.list[].tools.elevated.enabled: false`

---

## Tool Restriction Examples

### Read-only Agent

```jsonc
{
  "tools": {
    "allow": ["read"],
    "deny": ["exec", "write", "edit", "apply_patch", "process"]
  }
}
```

### Safe Execution Agent (no file modifications)

```jsonc
{
  "tools": {
    "allow": ["read", "exec", "process"],
    "deny": ["write", "edit", "apply_patch", "browser", "gateway"]
  }
}
```

### Communication-only Agent

```jsonc
{
  "tools": {
    "allow": ["sessions_list", "sessions_send", "sessions_history", "session_status"],
    "deny": ["exec", "write", "edit", "apply_patch", "read", "browser"]
  }
}
```

---

## Common Pitfall: `"non-main"` Mode

`agents.defaults.sandbox.mode: "non-main"` is based on `session.mainKey` (default `"main"`), **not** the agent ID. Group/channel sessions always get their own keys, so they are treated as non-main and will be sandboxed. If you want an agent to never sandbox, set `agents.list[].sandbox.mode: "off"`.

---

## Testing

After configuring multi-agent sandbox and tools:

```bash
# Check agent resolution
hyperclaw agents list --bindings

# Verify sandbox containers
docker ps --filter "name=hyperclaw-sbx-"

# Monitor logs
tail -f ~/.hyperclaw/logs/gateway.log | grep -E "routing|sandbox|tools"
```

---

## Troubleshooting

**Agent not sandboxed despite `mode: "all"`**
- Check if there's a global `agents.defaults.sandbox.mode` that overrides it
- Set `agents.list[].sandbox.mode: "all"` explicitly for this agent

**Tools still available despite deny list**
- Check tool filtering order (global → agent → sandbox → subagent)
- Each level can only further restrict, not grant back
- Verify with logs: `[tools] filtering tools for agent:<agentId>`

**Container not isolated per agent**
- Set `scope: "agent"` in agent-specific sandbox config
- Default `"session"` creates one container per session
