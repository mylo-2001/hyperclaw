# Broadcast Groups

**Status:** Experimental — Added in 2026.1.9

Broadcast Groups enable multiple agents to process and respond to the same message simultaneously. This allows you to create specialized agent teams that work together in a single WhatsApp group or DM — all using one phone number.

> **Current scope:** WhatsApp only (web channel). Telegram, Discord, and Slack are planned.

Broadcast groups are evaluated **after** channel allowlists and group activation rules. In WhatsApp groups, this means broadcasts happen when HyperClaw would normally reply (e.g., on mention, depending on your group settings).

---

## Use Cases

### 1. Specialized Agent Teams

```
Group: "Development Team"
Agents:
  - CodeReviewer   (reviews code snippets)
  - DocumentationBot (generates docs)
  - SecurityAuditor  (checks for vulnerabilities)
  - TestGenerator    (suggests test cases)
```

Each agent processes the same message and provides its specialized perspective.

### 2. Multi-Language Support

```
Group: "International Support"
Agents:
  - Agent_EN  (responds in English)
  - Agent_DE  (responds in German)
  - Agent_ES  (responds in Spanish)
```

### 3. Quality Assurance Workflows

```
Group: "Customer Support"
Agents:
  - SupportAgent (provides answer)
  - QAAgent      (reviews quality, only responds if issues found)
```

### 4. Task Automation

```
Group: "Project Management"
Agents:
  - TaskTracker      (updates task database)
  - TimeLogger       (logs time spent)
  - ReportGenerator  (creates summaries)
```

---

## Configuration

Add a top-level `broadcast` section (next to `bindings`). Keys are WhatsApp peer IDs:

- **Group chats:** group JID (e.g. `120363403215116621@g.us`)
- **DMs:** E.164 phone number (e.g. `+15551234567`)

```jsonc
{
  "broadcast": {
    "120363403215116621@g.us": ["alfred", "baerbel", "assistant3"]
  }
}
```

Result: When HyperClaw would reply in this chat, it will run all three agents.

---

## Processing Strategy

### Parallel (Default)

All agents process simultaneously:

```jsonc
{
  "broadcast": {
    "strategy": "parallel",
    "120363403215116621@g.us": ["alfred", "baerbel"]
  }
}
```

### Sequential

Agents process in order (one waits for the previous to finish):

```jsonc
{
  "broadcast": {
    "strategy": "sequential",
    "120363403215116621@g.us": ["alfred", "baerbel"]
  }
}
```

---

## Complete Example

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "code-reviewer",
        "name": "Code Reviewer",
        "workspace": "/path/to/code-reviewer",
        "sandbox": { "mode": "all" }
      },
      {
        "id": "security-auditor",
        "name": "Security Auditor",
        "workspace": "/path/to/security-auditor",
        "sandbox": { "mode": "all" }
      },
      {
        "id": "docs-generator",
        "name": "Documentation Generator",
        "workspace": "/path/to/docs-generator",
        "sandbox": { "mode": "all" }
      }
    ]
  },
  "broadcast": {
    "strategy": "parallel",
    "120363403215116621@g.us": ["code-reviewer", "security-auditor", "docs-generator"],
    "120363424282127706@g.us": ["support-en", "support-de"],
    "+15555550123": ["assistant", "logger"]
  }
}
```

---

## How It Works

### Message Flow

1. Incoming message arrives in a WhatsApp group
2. **Broadcast check:** System checks if peer ID is in `broadcast`
3. **If in broadcast list:**
   - All listed agents process the message
   - Each agent has its own session key and isolated context
   - Agents process in parallel (default) or sequentially
4. **If not in broadcast list:**
   - Normal routing applies (first matching `bindings` rule, then default agent)

> Broadcast groups do **not** bypass channel allowlists or group activation rules. They only change which agents run when a message is eligible for processing.

### Session Isolation

Each agent in a broadcast group maintains completely separate:

| Item | Description |
|------|-------------|
| Session keys | `agent:alfred:whatsapp:group:120363...` vs `agent:baerbel:whatsapp:group:120363...` |
| Conversation history | Agent doesn't see other agents' messages |
| Workspace | Separate sandboxes if configured |
| Tool access | Different allow/deny lists |
| Memory/context | Separate IDENTITY.md, SOUL.md, etc. |

> **Shared:** Group context buffer (recent group messages) is shared per peer, so all broadcast agents see the same context when triggered.

### Example: Isolated Sessions

In group `120363403215116621@g.us` with agents `["alfred", "baerbel"]`:

**Alfred's context:**
- Session: `agent:alfred:whatsapp:group:120363403215116621@g.us`
- History: `[user message, alfred's previous responses]`
- Workspace: `~/openclaw-alfred/`
- Tools: read, write, exec

**Bärbel's context:**
- Session: `agent:baerbel:whatsapp:group:120363403215116621@g.us`
- History: `[user message, baerbel's previous responses]`
- Workspace: `~/openclaw-baerbel/`
- Tools: read only

---

## Best Practices

### 1. Keep Agents Focused

Design each agent with a single, clear responsibility:
```jsonc
{ "broadcast": { "DEV_GROUP": ["formatter", "linter", "tester"] } }
```
✅ **Good:** Each agent has one job  
❌ **Bad:** One generic "dev-helper" agent

### 2. Use Descriptive Names

```jsonc
{
  "agents": {
    "list": [
      { "id": "security-scanner", "name": "Security Scanner" },
      { "id": "code-formatter",   "name": "Code Formatter" },
      { "id": "test-generator",   "name": "Test Generator" }
    ]
  }
}
```

### 3. Configure Different Tool Access

```jsonc
{
  "agents": {
    "list": [
      { "id": "reviewer", "tools": { "allow": ["read", "exec"] } },
      { "id": "fixer",    "tools": { "allow": ["read", "write", "edit", "exec"] } }
    ]
  }
}
```

### 4. Monitor Performance

With many agents, consider:
- Using `"strategy": "parallel"` (default) for speed
- Limiting broadcast groups to 5-10 agents
- Using faster models for simpler agents

### 5. Handle Failures Gracefully

Agents fail independently. One agent's error doesn't block others:
```
Message → [Agent A ✓, Agent B ✗ error, Agent C ✓]
Result: Agent A and C respond, Agent B logs error
```

---

## Compatibility

| Provider | Status |
|----------|--------|
| WhatsApp | Implemented |
| Telegram | Planned |
| Discord  | Planned |
| Slack    | Planned |

---

## Routing Interaction

Broadcast groups work alongside existing routing:

```jsonc
{
  "bindings": [
    {
      "match": { "channel": "whatsapp", "peer": { "kind": "group", "id": "GROUP_A" } },
      "agentId": "alfred"
    }
  ],
  "broadcast": {
    "GROUP_B": ["agent1", "agent2"]
  }
}
```

- **GROUP_A:** Only `alfred` responds (normal routing via `bindings`)
- **GROUP_B:** `agent1` AND `agent2` respond (broadcast)
- **Precedence:** `broadcast` takes priority over `bindings`

---

## Troubleshooting

**Agents Not Responding**
- Check that agent IDs exist in `agents.list`
- Verify peer ID format is correct (e.g., `120363403215116621@g.us`)
- Agents are not in deny lists
- Check logs: `tail -f ~/.hyperclaw/logs/gateway.log | grep broadcast`

**Only One Agent Responding**
- Cause: Peer ID might be in `bindings` but not `broadcast`
- Fix: Add to `broadcast` config or remove from `bindings`

**Performance Issues with Many Agents**
- Reduce number of agents per group
- Use lighter models
- Check sandbox startup time

---

## API Reference

```typescript
interface HyperClawConfig {
  broadcast?: {
    strategy?: "parallel" | "sequential";
    [peerId: string]: string[];
  };
}
```

### Fields

| Field | Description |
|-------|-------------|
| `strategy` | `"parallel"` (default) or `"sequential"` |
| `[peerId]` | WhatsApp group JID, E.164 DM number, or other peer ID → array of agent IDs |

### Limitations

- No hard agent limit, but 10+ agents may be slow
- Agents don't see each other's responses (by design)
- Parallel responses may arrive in any order
- All agents count toward WhatsApp rate limits
