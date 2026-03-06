# HyperClaw Package Structure

Clear separation of concerns for maintainability and OpenClaw alignment.

## Layout

```
hyperclaw/
├── packages/               # Workspace packages
│   ├── shared/             # @hyperclaw/shared — paths, types
│   ├── core/               # @hyperclaw/core — agent engine, inference, tools, session, memory
│   └── gateway/            # @hyperclaw/gateway — server, manager (re-exports from src/gateway)
├── apps/
│   └── web/                # @hyperclaw/web — React dashboard
├── src/                    # Main app (core logic)
│   ├── cli/                # CLI entry + commands
│   ├── infra/              # Paths, daemon, security, env
│   ├── config/             # Config load/save
│   └── sdk/                # Plugin/Skill SDK
│
├── src/gateway/            # Gateway runtime
│   ├── server.ts           # HTTP + WebSocket server
│   └── manager.ts          # Port, bind, Tailscale
│
├── src/channels/           # Channel layer
│   ├── registry.ts         # Channel definitions
│   ├── runner.ts           # Start connectors, wire to gateway
│   ├── delivery.ts         # Retry, chunking, media
│   ├── rate-limit.ts       # Per-channel rate limiting
│   └── pairing.ts          # DM pairing store
│
├── src/bot/                # HyperClaw Bot (Telegram + Discord)
│   └── hyperclawbot.ts
│
├── src/agent/              # Re-exports from packages/core (implementation in packages/core/src/agent/)
│
├── extensions/             # Channel connectors (one per channel)
│   ├── telegram/
│   ├── discord/
│   ├── instagram/
│   ├── voice-call/
│   ├── chrome-extension/
│   └── ...
│
├── apps/                   # UI surfaces
│   └── web/
│
└── docs/
```

## Boundaries

| Layer | Depends on | Exposes |
|-------|------------|---------|
| **@hyperclaw/core** | @hyperclaw/shared | runAgentEngine, inference, session, memory, skills (packages/core) |
| **gateway** | core | HTTP/WS API |
| **channels** | gateway, extensions | message → gateway → reply |
| **extensions** | channels (emit message) | connector per platform |
| **bot** | gateway API | remote control commands |
