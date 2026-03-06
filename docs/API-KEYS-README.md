# API Keys — Full Guide

This README describes how HyperClaw manages API keys **for any application** (not just bug bounty). Read it to understand the flow.

---

## Contents

1. [Overview](#overview)
2. [How the Wizard collects API keys](#how-the-wizard-collects-api-keys)
3. [Where keys are stored](#where-keys-are-stored)
4. [Ways to add keys](#ways-to-add-keys)
5. [Skills & requiresKeys](#skills--requireskeys)
6. [How tools read keys](#how-tools-read-keys)
7. [Paths & formats](#paths--formats)

---

## Overview

HyperClaw supports API keys for:

| Category | Examples |
|----------|---------|
| **AI Providers** | Anthropic, OpenAI, OpenRouter, Google, xAI |
| **Skills** | Tavily, DeepL, GitHub, OpenWeather, Home Assistant |
| **Channels** | Telegram, Discord, Slack (bot tokens) |
| **Bug bounty / Custom** | HackerOne, Bugcrowd, Synack, **any app with an API key** |
| **Talk Mode** | ElevenLabs |
| **Gateway** | authToken for remote access |

All keys are stored securely (file mode 0o600) and can be added via:

- **Wizard (onboard)** — interactive during setup
- **CLI** — `hyperclaw auth add`, `hyperclaw config set-service-key`, `hyperclaw secrets set`
- **Env vars** — for CI/CD or advanced use

---

## How the Wizard collects API keys

`HyperClawWizard` (`src/cli/onboard.ts`) collects keys in several steps:

### 1. AI Provider (`selectProvidersAndModels`)

- Choose provider(s) (Anthropic, OpenAI, OpenRouter, etc.)
- If `authType === 'api_key'`: `inquirer.prompt` with `type: 'password'`, `mask: '●'`
- If custom: `baseUrl`, `apiKey`, `modelId`
- Saves to: `provider.apiKey` in config

### 2. Service API Keys (`configureServiceApiKeys`)

```
🔑 Service API Keys — any app with an API key

Stored securely in config. How they work:
  • Wizard: add keys here
  • Config: ~/.hyperclaw/hyperclaw.json → skills.apiKeys
  • Env: HACKERONE_*, BUGCROWD_*, SYNACK_*, or CUSTOM_ID_API_KEY
  • Tools: built-in tools read them automatically for research
```

**Known services (checkbox):**

| ID | Name | Hint |
|----|------|------|
| `hackerone` | HackerOne | username:token (Basic auth) |
| `bugcrowd` | Bugcrowd | Token from Bugcrowd API Credentials |
| `synack` | Synack | API token from Synack |
| `__custom__` | Other (custom) | Any app with an API key |

- If custom selected: `customId` (e.g. my-app, ads-power) + `customKey`
- Saves to: `skills.apiKeys[customId]` in config

### 3. Talk Mode (`configureTalkMode`)

- ElevenLabs API key
- Saves to: `talkMode.apiKey`

### 4. Channels (`selectChannels`)

- Bot tokens (Telegram, Discord, etc.)
- Saves to: `channelConfigs[channelId].token`

### 5. Gateway Auth Token (`configureGateway`)

- `authToken` — blank = auto-generate
- Saves to: `gateway.authToken`

---

## Where keys are stored

| Source | Storage location |
|--------|-----------------|
| Wizard → provider | `~/.hyperclaw/hyperclaw.json` → `provider.apiKey` |
| Wizard → service keys (HackerOne, Bugcrowd, custom) | `~/.hyperclaw/hyperclaw.json` → `skills.apiKeys` |
| Wizard → talk mode | `~/.hyperclaw/hyperclaw.json` → `talkMode.apiKey` |
| Wizard → channels | `~/.hyperclaw/hyperclaw.json` → `channelConfigs[ch].token` |
| Wizard → gateway | `~/.hyperclaw/hyperclaw.json` → `gateway.authToken` |
| `hyperclaw auth add` | `~/.hyperclaw/credentials/<service_id>.json` + `~/.hyperclaw/.env` |
| `hyperclaw config set-service-key` | `~/.hyperclaw/hyperclaw.json` → `skills.apiKeys` |
| `hyperclaw secrets set KEY=val` | `~/.hyperclaw/.env` |

New keys are merged with existing ones without overwriting.

---

## Ways to add keys

### 1. `hyperclaw auth add <service_id>`

For **any** service (skills, providers, custom apps):

```bash
hyperclaw auth add <service_id>              # Prompts for key interactively
hyperclaw auth add tavily --key tvly-xxx     # With --key flag
hyperclaw auth add my-api --key sk-xxx --base-url https://api.example.com
hyperclaw auth remove <service_id>           # Remove
```

- Saves to `~/.hyperclaw/credentials/<service_id>.json` (mode 0o600)
- Writes `<SERVICE_ID>_API_KEY=...` to `.env`
- If the service is known (api-keys-guide.ts), shows setup steps

### 2. `hyperclaw config set-service-key <serviceId> [apiKey]`

For service keys (HackerOne, Bugcrowd, Synack, custom):

```bash
hyperclaw config set-service-key hackerone
hyperclaw config set-service-key my-app sk-xxx
```

- Saves to `skills.apiKeys` in config
- Tools read from config or env

### 3. `hyperclaw secrets set KEY=value`

For env vars (all known secrets):

```bash
hyperclaw secrets set TAVILY_API_KEY=tvly-xxx
hyperclaw secrets apply   # Write to ~/.bashrc, ~/.zshrc
hyperclaw secrets reload  # Reload in running gateway
```

### 4. `hyperclaw config set-key KEY=value`

For provider keys (AuthStore).

---

## Skills & requiresKeys

Skills declare what they need via `requiresKeys` (`src/plugins/hub.ts`):

| Skill | requiresKeys |
|-------|-------------|
| web-search | `TAVILY_API_KEY` |
| calendar | `GOOGLE_CALENDAR_CREDS` |
| github | `GITHUB_TOKEN` |
| home-assistant | `HA_URL`, `HA_TOKEN` |
| translator | `DEEPL_API_KEY` |
| weather | `OPENWEATHER_API_KEY` |
| db-reader | `DATABASE_URL` |

Check: `hyperclaw secrets audit [--required-by web-search,github]`

---

## How tools read keys

1. **Provider key**: `config.provider.apiKey` or `process.env.ANTHROPIC_API_KEY` etc.
2. **Skill keys**: `process.env.TAVILY_API_KEY` etc. (from credentials store → .env or auth add)
3. **Service keys (bug bounty / custom)**: `config.skills.apiKeys[serviceId]` or `process.env.HACKERONE_API_KEY` etc.
4. **Talk mode**: `config.talkMode.apiKey` or `ELEVENLABS_API_KEY`

Priority: env var > config (depends on component).

---

## Paths & formats

### Config: `~/.hyperclaw/hyperclaw.json`

```json
{
  "provider": { "providerId": "anthropic", "apiKey": "sk-ant-...", "modelId": "claude-3-5-sonnet" },
  "gateway": { "port": 18789, "authToken": "...", "bind": "127.0.0.1" },
  "skills": {
    "installed": ["web-search", "github"],
    "apiKeys": {
      "hackerone": "user:token",
      "bugcrowd": "token",
      "my-custom-app": "sk-xxx"
    }
  },
  "talkMode": { "apiKey": "...", "voiceId": "21m00Tcm4TlvDq8ikWAM" },
  "channelConfigs": {
    "telegram": { "token": "..." }
  }
}
```

### Credentials: `~/.hyperclaw/credentials/<service_id>.json`

```json
{
  "providerId": "tavily",
  "apiKey": "tvly-xxx",
  "baseUrl": "https://api.tavily.com",
  "updatedAt": "2025-03-03T..."
}
```

### Env: `~/.hyperclaw/.env`

```
TAVILY_API_KEY=tvly-xxx
HACKERONE_API_KEY=user:token
MY_APP_API_KEY=sk-xxx
```

---

For more: `docs/security.md`, `docs/configuration.md`, `src/infra/api-keys-guide.ts`.
