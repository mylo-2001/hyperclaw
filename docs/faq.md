# FAQ — HyperClaw

Frequently asked questions.

---

## Environment variables

### How does HyperClaw load environment variables?

HyperClaw reads from the parent process (shell, systemd, launchd) and optionally from:

- `.env` in the current working directory
- `~/.hyperclaw/.env` (global fallback)

Neither `.env` file overrides existing env vars. See [Environment](environment.md).

### I started the Gateway via the service and my env vars disappeared. What now?

Services (systemd/launchd) typically don't inherit your shell env. Fix:

- Put the missing keys in `~/.hyperclaw/.env` so they load when the daemon starts.
- Or set them in the daemon plist/systemd unit's `Environment` / `EnvironmentFile`.

---

## Sessions and chats

### How do I start a fresh conversation?

Send `/new` or `/reset` as a standalone message in chat.

### Do sessions reset automatically?

Yes. Sessions expire after `session.idleMinutes` (default varies). The next message starts a new session id. Config example:

```json
{ "session": { "idleMinutes": 240 } }
```

### Why did context get truncated mid-task?

Session context is limited by the model window. Long chats or large tool outputs can trigger truncation. What helps:

- Ask the bot to summarize and write to a file.
- Use `/new` when switching topics.
- Keep important context in the workspace.

---

## Models

### What is the default model?

Whatever you set as `provider.model` or `agents.defaults.model.primary` in config. Format: `provider/model` (e.g. `anthropic/claude-sonnet-4`).

### How do I switch models without wiping config?

- In chat: `/model <alias>` (e.g. `/model sonnet`, `/model opus`)
- CLI: `hyperclaw config set-key provider.model=provider/model`
- Edit `~/.hyperclaw/hyperclaw.json` → `provider.model`

### "No API key found for provider"

The provider (e.g. Anthropic, OpenAI) requires credentials. Fix:

- Put the key in `~/.hyperclaw/.env`:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
- Or set in config: `provider.apiKey`
- Restart the gateway.

### "Model is not allowed"

You selected a model that isn't in the configured allowlist. Add it to `agents.defaults.models` or remove the allowlist.

---

## Gateway

### What port does the Gateway use?

Default `18789`. Controlled by `gateway.port` in config. Override with `HYPERCLAW_PORT` or `PORT`.

### Why does `gateway status` say "Runtime running" but RPC probe failed?

"Running" = daemon thinks it's up. RPC probe = CLI actually connecting. Check:

- `hyperclaw status`
- `hyperclaw logs --follow`
- Last error in logs.

### "Another gateway instance is already listening"

Something else is bound to the port. Stop it or run on a different port: `hyperclaw gateway --port 19001`.

### The Control UI says "unauthorized" or keeps reconnecting

Gateway auth is enabled but the UI doesn't have the token. Fix:

- Run `hyperclaw dashboard` — it prints the URL and tries to open it.
- Get token: `hyperclaw doctor --generate-gateway-token` (or check config `gateway.authToken`).
- Put the same token in the Control UI settings.

---

## Logging and debugging

### Where are logs?

- File: `~/.hyperclaw/logs/gateway.log`, `gateway.err`
- CLI: `hyperclaw logs --follow`
- systemd: `journalctl --user -u hyperclaw -f`
- launchd: `~/.hyperclaw/logs/gateway.log`

### How do I restart the Gateway?

- Service: `hyperclaw daemon restart` or `hyperclaw gateway restart`
- Manual: `Ctrl+C` then `hyperclaw gateway start`

### I closed my terminal on Windows. How do I restart HyperClaw?

- WSL2: `wsl` → `hyperclaw daemon restart`
- Native: Open PowerShell → `hyperclaw daemon restart`

### Gateway is up but replies never arrive. What to check?

1. `hyperclaw status`
2. `hyperclaw config show` — verify provider API key
3. `hyperclaw logs --follow` — look for auth/rate-limit errors
4. Channel pairing/allowlist — `hyperclaw pairing list <channel>`

---

## Media and attachments

### My skill generated an image/PDF but nothing was sent

Outbound attachments need to be explicitly referenced. The agent must include the file path in its reply or use the appropriate tool to send media. Check that the channel supports outbound media.

---

## Security and access control

### Is it safe to expose HyperClaw to inbound DMs?

Treat inbound DMs as untrusted. Default pairing mode requires approval. For public DMs you must explicitly opt in (`dmPolicy: "open"`, allowlist `*`).

### Should my bot have its own email / GitHub / phone?

Yes. Separate accounts reduce blast radius if something goes wrong.

### I ran /start in Telegram but didn't get a pairing code

Pairing codes are sent when an unknown sender messages the bot and pairing is enabled. Check pending: `hyperclaw pairing list telegram`. To approve immediately, add your ID to allowlist or set `dmPolicy: "open"` for that account.

---

## Chat commands and aborting

### How do I stop / cancel a running task?

Send as a standalone message (no slash):

- `stop`, `stop action`, `abort`, `esc`, `wait`, `exit`, `interrupt`
- Or `please stop`, `stop don't do anything`

### Why does it feel like the bot ignores rapid-fire messages?

Queue mode controls how new messages interact with an in-flight run. Use `/queue` to change modes (collect, followup, steer, etc.).

---

## Reset and maintenance

### How do I completely reset HyperClaw but keep it installed?

```bash
hyperclaw reset --scope full --yes
hyperclaw onboard
```

### I'm getting "context too large" errors. How do I reset or compact?

- Compact (summarize older turns): `/compact`
- Fresh session: `/new` or `/reset`

---

## Related

- [Troubleshooting](troubleshooting.md)
- [Environment](environment.md)
- [Configuration](configuration.md)
