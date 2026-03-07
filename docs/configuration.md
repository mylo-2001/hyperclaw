# Configuration — HyperClaw

Full config reference. File: `~/.hyperclaw/hyperclaw.json`.

---

## Structure

```json
{
  "provider": { ... },
  "gateway": { ... },
  "identity": { ... },
  "channels": { ... },
  "agents": { ... },
  "pcAccess": { ... }
}
```

---

## provider

| Key | Type | Description |
|-----|------|-------------|
| `providerId` | string | `openrouter` \| `anthropic` \| `openai` \| `google` \| `xai` \| `cloudflare` \| `litellm` \| `local` |
| `modelId` | string | e.g. `anthropic/claude-sonnet-4`, `gpt-4o` |
| `apiKey` | string | API key (or from env) |
| `authType` | string | `api_key` (default) \| `oauth` — use OAuth token file instead of apiKey |
| `oauthTokenPath` | string | Path to JSON with `access_token`, `refresh_token`, `expires_at`, `token_url` (default: `~/.hyperclaw/oauth-<providerId>.json`) |
| `baseUrl` | string | Optional: custom API base |

---

## gateway

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `port` | number | 18789 | WebSocket/HTTP port |
| `bind` | string | `127.0.0.1` | `127.0.0.1` \| `0.0.0.0` |
| `authToken` | string | — | Optional shared token |
| `tailscaleExposure` | string | `off` | `off` \| `serve` \| `funnel` |
| `runtime` | string | `node` | `node` \| `bun` \| `deno` |
| `enabledChannels` | string[] | [] | Channel IDs |
| `hooks` | boolean | true | Enable hooks |

---

## identity

| Key | Type | Description |
|-----|------|-------------|
| `agentName` | string | Assistant name |
| `personality` | string | System prompt / SOUL |

---

## channels

Per-channel config, keyed by channel ID:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "…",
      "allowFrom": ["*"],
      "groups": { "*": { "requireMention": true } },
      "dmPolicy": "pairing"
    },
    "discord": { ... },
    "twitch": {
      "enabled": true,
      "username": "openclaw",
      "oauthToken": "oauth:abc123...",
      "channels": ["vevisk"],
      "dmPolicy": "pairing"
    }
  }
}
```

| Key | Description |
|-----|-------------|
| `enabled` | Enable channel |
| `botToken` / `token` | Bot token |
| `allowFrom` | Array of allowed user IDs or `["*"]` |
| `groups` | Group allowlist |
| `dmPolicy` | `pairing` \| `allowlist` \| `open` \| `disabled` |
| `webhookUrl` | Inbound webhook URL |
| `webhookSecret` | Webhook secret |

### Twitch-specific fields

| Key | Description |
|-----|-------------|
| `channels.twitch.username` | Bot Twitch username |
| `channels.twitch.oauthToken` | Twitch IRC OAuth token (`oauth:...`) |
| `channels.twitch.channels` | Array of channel names to join |
| `channels.twitch.commandPrefix` | Prefix required in public chat (default: `!`) |
| `channels.twitch.whispers` | Enable whisper handling |
| `channels.twitch.modsBypass` | Let moderators and broadcaster bypass allowlist |

---

## agents

| Key | Type | Description |
|-----|------|-------------|
| `defaults.workspace` | string | Workspace root path |
| `defaults.sandbox.mode` | string | `main` \| `non-main` |
| `list[].groupChat` | object | Per-agent group chat: `mentionPatterns`, `historyLimit`. See [Group Messages](group-messages.md). |

---

## talkMode

| Key | Type | Description |
|-----|------|-------------|
| `apiKey` | string | ElevenLabs API key (or `ELEVENLABS_API_KEY` env) |
| `voiceId` | string | Optional voice ID (default: Rachel) |
| `modelId` | string | Optional model (default: eleven_multilingual_v2) |

Enable per-session with WebSocket `talk:enable`. Responses are synthesized to audio and sent as `chat:audio`.

---

## tools

| Key | Type | Description |
|-----|------|-------------|
| `profile` | string | `full` \| `messaging` \| `coding` \| `minimal` — base tool allowlist |
| `allow` | string[] | Explicit allow (supports `group:fs`, `group:runtime`, etc.) |
| `deny` | string[] | Explicit deny (always wins) |
| `byProvider` | object | Per-provider override: `{ "anthropic": { profile: "minimal" } }` |

Tool groups: `group:fs`, `group:runtime`, `group:sessions`, `group:memory`, `group:ui`, `group:messaging`, `group:pc`, `group:vision`, `group:extraction`.

| Key (elevated) | Type | Description |
|----------------|------|-------------|
| `tools.elevated.enabled` | boolean | Allow `/elevated` escape hatch for run_shell in sandboxed sessions |
| `tools.elevated.allowFrom` | string[] | Sources that can enable elevated (e.g. `["web", "*"]`) |
| `tools.dockerSandbox.enabled` | boolean | Run run_shell inside Docker (alpine) when true |

---

## pcAccess

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable host tools |
| `level` | string | `full` \| `read-only` \| `sandboxed` |

---

## mcp

MCP (Model Context Protocol) — load tools from external servers.

```json
{
  "mcp": {
    "servers": [
      { "name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] },
      { "name": "remote", "url": "https://mcp.example.com/sse" }
    ]
  }
}
```

---

## heartbeat

| Key | Type | Description |
|-----|------|-------------|
| `heartbeat.morningBriefing.enabled` | boolean | Enable morning briefing (hook: morning-briefing) |
| `heartbeat.morningBriefing.cron` | string | Cron for briefing (default: 0 8 * * * = 8am daily) |

Enable with: `hyperclaw hooks enable morning-briefing`

---

## memoryIntegration

| Key | Type | Description |
|-----|------|-------------|
| `vaultDir` | string | Path to Obsidian vault (or folder Raycast/Hazel index) |
| `dailyNotes` | boolean | Write `YYYY-MM-DD.md` daily notes under `HyperClaw/` |
| `syncOnAppend` | boolean | Sync `MEMORY.md` to vault on each append (default: true) |

Enables auto-sync of MEMORY.md to Obsidian, searchable notes via Raycast, and Hazel file rules. See `docs/memory-integration.md`.

---

## Environment

For full env precedence, path vars, and fallbacks, see [Environment](environment.md).

### Path overrides

| Variable | Overrides |
|----------|-----------|
| `HYPERCLAW_HOME` | Base directory |
| `HYPERCLAW_STATE_DIR` | State directory |
| `HYPERCLAW_CONFIG_PATH` | Config file path |
| `OPENROUTER_API_KEY` | provider.apiKey (OpenRouter) |
| `ANTHROPIC_API_KEY` | provider.apiKey (Anthropic) |
| `OPENAI_API_KEY` | provider.apiKey (OpenAI) |
| `TWITCH_BOT_USERNAME` | channels.twitch.username |
| `TWITCH_OAUTH_TOKEN` | channels.twitch.oauthToken |
| `TWITCH_CHANNELS` | channels.twitch.channels (comma-separated) |

---

## Custom API keys (auth add)

For services not supported built-in, use `hyperclaw auth add`:

```bash
hyperclaw auth add <service_id>              # Prompts for API key interactively
hyperclaw auth add tavily --key tvly-xxx    # With --key
hyperclaw auth add my-api --key sk-xxx --base-url https://api.example.com
hyperclaw auth remove <service_id>          # Remove
```

Saves to `~/.hyperclaw/credentials/<service_id>.json` and to `.env` as `<SERVICE_ID>_API_KEY`. Skills and the agent read from `process.env.<SERVICE_ID>_API_KEY` without custom skills.

---

## CLI commands

```bash
hyperclaw config show          # Show config (masked)
hyperclaw config set-key KEY=value
hyperclaw config schema        # Schema
hyperclaw auth add <service_id>   # Add custom API key
hyperclaw auth oauth google    # Full OAuth flow (browser)
hyperclaw auth oauth-set <provider>  # Manual token save
hyperclaw secrets credentials     # List credentials
hyperclaw menu-bar             # Launch macOS menu bar app (from repo)
```

---

## Nix

Install via Nix:

```bash
# With flake
nix build .#
# or nix profile install .#

# Without flake (default.nix)
nix-env -i -f default.nix
```

To compute `npmDepsHash`: run `./scripts/nix-update-hash.sh` (on Linux/macOS) or `nix build .# 2>&1` and replace the hash shown in the error.
