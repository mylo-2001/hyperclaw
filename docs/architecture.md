# Architecture — HyperClaw

A brief overview of the HyperClaw architecture.

---

## High-level

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (hyperclaw)                          │
│  init | onboard | gateway | channels | doctor | config | ...    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Gateway (Node)                             │
│  • HTTP + WebSocket (port 18789)                                │
│  • Sessions, auth, routing                                      │
│  • /api/status, /api/chat, /webhook/:channel                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Inference      │ │  Channels       │ │  Extensions     │
│  (Anthropic,    │ │  (Telegram,     │ │  (connectors,   │
│   OpenRouter…)  │ │   Discord…)     │ │   skills)       │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Components

### CLI (`src/cli/`)
- `run-main.ts` — entry point, Commander routing
- `onboard.ts` — setup wizard
- `config.ts`, `gateway.ts`, `channels.ts` — helpers

### Gateway (`src/gateway/`)
- `server.ts` — HTTP + WebSocket server, sessions, chat handler
- `manager.ts` — status, port check, Tailscale

### Agent (`packages/core/src/agent/`)
- `engine.ts` — unified entry point: context, tools, inference, memory
- `inference.ts` — LLM calls (OpenRouter/Anthropic), tool loop
- `runner.ts` — CLI agent loop (wraps engine)
- `pc-access.ts` — host tools (bash, read, write)
- `memory-auto.ts` — auto memory extraction

### Channels (`src/channels/`, `extensions/`)
- Registry with channel metadata
- Connectors: Telegram, Discord, WhatsApp, etc. (stubs or full)
- Pairing store for DM policy

### Config & Secrets
- Config: `~/.hyperclaw/hyperclaw.json`
- Secrets: env vars or credentials store

---

## Data flow

1. **Inbound message** → Channel connector → Gateway → Agent
2. **Agent** → Inference engine → Provider API
3. **Response** → Gateway → Channel → User

---

## Protocol (WebSocket)

- `connect.ok` — session established
- `chat:message` → `chat:response`
- `ping` → `pong`
- `gateway:status`, `config:get`

---

## Paths

| Path | Purpose |
|------|---------|
| `~/.hyperclaw/` | Home dir |
| `~/.hyperclaw/hyperclaw.json` | Main config |
| `~/.hyperclaw/credentials/` | Channel creds |
| `~/.hyperclaw/logs/` | Logs |
| `~/.hyperclaw/gateway.pid` | Daemon PID |
