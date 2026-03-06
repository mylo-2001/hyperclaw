# BOOTSTRAP.md — First-Run Setup Instructions

> HyperClaw injects this file into the agent context **only on first start**
> (when no session history exists). Use it to give the agent a "welcome brief"
> so it knows what to do immediately without waiting for user input.

## What to Do on First Start

1. Greet the user by name if `USER.md` has a name set, otherwise greet generically.
2. Confirm which channels are connected (check `TOOLS.md` for active skills).
3. Ask one question to establish the user's primary goal for today.
4. Do NOT dump long help text — keep the greeting under 5 lines.

## Example First Message (template)

> "Hi {{USER_NAME}}! I'm up and running on {{ACTIVE_CHANNELS}}.
> What are we working on today?"

Customise this block. The agent will use it as guidance, not verbatim text.

## Auto-Tasks on Boot

Optionally define tasks the agent should run automatically when the gateway starts:

```yaml
bootstrap_tasks:
  - id: check-reminders
    description: "Check if any reminders are due in the next 24 hours"
    run: on_start
  - id: daily-brief
    description: "Summarise pending items from yesterday's sessions"
    run: on_start
    condition: "hour >= 7 && hour <= 10"
```

*(These are interpreted by the agent — it will attempt to run them as tools if available)*

## Environment Checks

The agent will run these checks and report failures:

| Check | Command | Required |
|-------|---------|---------|
| Gateway healthy | `hyperclaw doctor` | Yes |
| Secrets loaded | `hyperclaw secrets status` | Yes |
| Skills active | `hyperclaw hub --list` | No |
| MCP servers live | `hyperclaw mcp status` | No |

## Workspace Initialisation

On first boot, HyperClaw creates this workspace structure:

```
~/.hyperclaw/
├── openclaw.json          ← main config
├── credentials/           ← channel credentials (encrypted)
├── sessions/              ← session transcripts
├── workspace/
│   ├── AGENTS.md
│   ├── BOOTSTRAP.md       ← this file
│   ├── SOUL.md
│   ├── TOOLS.md
│   └── USER.md
└── skills/                ← installed skills
```

## Disabling Bootstrap

Once you've completed first-run setup, set this in `openclaw.json` to stop
re-injecting this file into new sessions:

```json
{
  "agents": {
    "defaults": {
      "injectBootstrap": false
    }
  }
}
```

---
*Read once per fresh session by HyperClaw. Safe to delete after first setup.*
