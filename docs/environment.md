# Environment Variables — HyperClaw
---

<div align="center">

[← Configuration](configuration.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Security →](security.md)

</div>

---

HyperClaw loads environment variables from multiple sources. **Rule:** existing values are never overridden.

---

## Precedence (highest → lowest)

1. **Process environment** — What the gateway/CLI already has from the parent shell, daemon, or system.
2. **`.env` in current working directory** — Loaded when present (dotenv default; does not override).
3. **`~/.hyperclaw/.env`** — Global fallback (does not override).
4. **Config inline** — `provider.apiKey`, `channels.*.token`, etc. in `hyperclaw.json`; config usually takes precedence over env fallbacks when both are set.

---

## Path-related env vars

| Variable | Purpose |
|----------|---------|
| `HYPERCLAW_HOME` | Override base directory for path resolution. When set, `~/.hyperclaw` becomes `$HYPERCLAW_HOME/.hyperclaw`. Useful for service user isolation. |
| `HYPERCLAW_STATE_DIR` | Override state directory directly (default `~/.hyperclaw`). |
| `HYPERCLAW_CONFIG_PATH` | Override config file path (default `~/.hyperclaw/hyperclaw.json`). |

Precedence: `HYPERCLAW_CONFIG_PATH` > `HYPERCLAW_STATE_DIR` > `HYPERCLAW_HOME` > `$HOME`.

---

## Provider and channel env fallbacks

When config keys are unset, HyperClaw falls back to process env:

| Config key | Env fallback |
|------------|--------------|
| `provider.apiKey` (OpenRouter) | `OPENROUTER_API_KEY` |
| `provider.apiKey` (Anthropic) | `ANTHROPIC_API_KEY` |
| `provider.apiKey` (OpenAI) | `OPENAI_API_KEY` |
| `gateway.authToken` | `HYPERCLAW_GATEWAY_TOKEN` |
| `channels.telegram.botToken` | `TELEGRAM_BOT_TOKEN` |
| `channels.discord.token` | `DISCORD_BOT_TOKEN` |
| `channels.twitch.*` | `TWITCH_BOT_USERNAME`, `TWITCH_OAUTH_TOKEN`, `TWITCH_CHANNELS` |
| Port | `PORT` or `HYPERCLAW_PORT` |

See [env.example](../env.example) and [.env.example](../.env.example) for the full list.

---

## HYPERCLAW_HOME

When set, `HYPERCLAW_HOME` replaces the system home for internal path resolution. Enables full filesystem isolation for headless service accounts.

Example (macOS LaunchDaemon):

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>HYPERCLAW_HOME</key>
  <string>/Users/kira</string>
</dict>
```

Tilde paths (e.g. `~/svc`) are expanded using `$HOME` before use.

---

## .env files

- **Local:** `.env` in the project or CWD (when running `hyperclaw gateway` from a folder).
- **Global:** `~/.hyperclaw/.env` (or `$HYPERCLAW_STATE_DIR/.env`).
- **Daemon:** systemd/launchd load `~/.hyperclaw/.env` via `EnvironmentFile` when configured.

Copy `env.example` or `.env.example` and fill in values. **Never commit `.env` to git.**

---

## Config inline (optional)

You can put values directly in config. Config typically wins over env when both are set:

```json
{
  "provider": { "apiKey": "sk-..." },
  "gateway": { "authToken": "${HYPERCLAW_GATEWAY_TOKEN}" }
}
```

Use `${VAR}` for substitution where supported.

---

## Related

- [Configuration](configuration.md)
- [API Keys](API-KEYS-README.md)
- [Troubleshooting](troubleshooting.md)

---

<div align="center">

[← Configuration](configuration.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Security →](security.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>