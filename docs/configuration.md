# Configuration — HyperClaw

Full config reference. Αρχείο: `~/.hyperclaw/hyperclaw.json`.

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
| `apiKey` | string | API key (ή από env) |
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
    "discord": { ... }
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

---

## agents

| Key | Type | Description |
|-----|------|-------------|
| `defaults.workspace` | string | Workspace root path |
| `defaults.sandbox.mode` | string | `main` \| `non-main` |

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

## Environment overrides

| Variable | Overrides |
|----------|-----------|
| `HYPERCLAW_HOME` | Base directory |
| `HYPERCLAW_STATE_DIR` | State directory |
| `HYPERCLAW_CONFIG_PATH` | Config file path |
| `OPENROUTER_API_KEY` | provider.apiKey (OpenRouter) |
| `ANTHROPIC_API_KEY` | provider.apiKey (Anthropic) |
| `OPENAI_API_KEY` | provider.apiKey (OpenAI) |

---

## Custom API keys (auth add)

Για υπηρεσίες που δεν υποστηρίζονται built-in, χρησιμοποίησε `hyperclaw auth add`:

```bash
hyperclaw auth add <service_id>              # Ζητάει το API key interactively
hyperclaw auth add tavily --key tvly-xxx    # Με --key
hyperclaw auth add my-api --key sk-xxx --base-url https://api.example.com
hyperclaw auth remove <service_id>          # Αφαίρεση
```

Αποθηκεύει σε `~/.hyperclaw/credentials/<service_id>.json` και στο `.env` ως `<SERVICE_ID>_API_KEY`. Τα skills και το agent διαβάζουν από `process.env.<SERVICE_ID>_API_KEY` χωρίς custom skills.

---

## CLI commands

```bash
hyperclaw config show          # Show config (masked)
hyperclaw config set-key KEY=value
hyperclaw config schema        # Schema
hyperclaw auth add <service_id>   # Προσθήκη custom API key
hyperclaw auth oauth google    # Full OAuth flow (browser)
hyperclaw auth oauth-set <provider>  # Manual token save
hyperclaw secrets credentials     # Λίστα credentials
hyperclaw menu-bar             # Launch macOS menu bar app (from repo)
```

---

## Nix

Εγκατάσταση μέσω Nix:

```bash
# Με flake
nix build .#
# ή nix profile install .#

# Χωρίς flake (default.nix)
nix-env -i -f default.nix
```

Για να υπολογίσεις το `npmDepsHash`: τρέξε `./scripts/nix-update-hash.sh` (σε Linux/macOS) ή `nix build .# 2>&1` και αντικατέστησε το hash στο σφάλμα.
