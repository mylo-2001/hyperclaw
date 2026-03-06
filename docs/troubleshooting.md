# Troubleshooting — HyperClaw

Common issues and solutions.

---

## Gateway won't start

### "Gateway not running"
- Run `hyperclaw daemon start` or `hyperclaw gateway start`
- Check port: default `18789`. If in use, change in `~/.hyperclaw/hyperclaw.json` → `gateway.port`
- Run `hyperclaw doctor` for a health check

### "Address already in use"
- Another process is listening on the same port:
  - Windows: `netstat -ano | findstr :18789`
  - Linux/macOS: `lsof -i :18789`
- Stop the process or change the port

### Daemon stops immediately
- Check logs: `~/.hyperclaw/logs/gateway.log`, `gateway.err`
- If config is missing: run `hyperclaw onboard`
- Check API key: `hyperclaw config show` — `provider.apiKey` or env `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` must be set

---

## API / Model errors

### "No API key configured"
- Set key: `hyperclaw config set-key provider.apiKey=sk-xxx`
- Or env: `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`
- See `.env.example` for all variables

### "Model not found" / 404
- Check that the model ID is correct (e.g. `anthropic/claude-sonnet-4`)
- OpenRouter: use IDs from https://openrouter.ai/models

### Rate limits / 429
- Wait a moment and try again
- Switch model or provider if it persists

---

## Channels

### Channel not receiving/sending messages
- Check config: `channels.<channel>.enabled === true`
- For Telegram/Discord: correct bot token
- For WhatsApp: `hyperclaw channels login` — link device
- DM policy: if `pairing`, approve with `hyperclaw pairing approve <channel> <code>`

### Webhook 404
- Gateway must be running
- URL: `http://localhost:18789/webhook/<channelId>`
- Check that the channel has a valid `webhookUrl` in config

---

## Config & paths

### Where is config stored?
- Config: `~/.hyperclaw/hyperclaw.json`
- Credentials: `~/.hyperclaw/credentials/`
- Logs: `~/.hyperclaw/logs/`
- Override with `HYPERCLAW_HOME` or `HYPERCLAW_CONFIG_PATH`

### Config not loading
- Check JSON syntax: `cat ~/.hyperclaw/hyperclaw.json | jq .`
- If corrupted: backup and run `hyperclaw onboard` again

---

## Systemd / LaunchAgent

### Linux: service not running
- User service: `systemctl --user status hyperclaw`
- Lingering: `loginctl enable-linger $USER` to run without login
- `journalctl --user -u hyperclaw -f` for logs

### macOS: LaunchAgent not starting
- `launchctl list | grep hyperclaw`
- Plist: `~/Library/LaunchAgents/ai.hyperclaw.gateway.plist`
- Load: `launchctl load ~/Library/LaunchAgents/ai.hyperclaw.gateway.plist`
- Stdout/stderr: `~/.hyperclaw/logs/gateway.log`, `gateway.err`

---

## General

### `hyperclaw doctor`
Always run for diagnostics:
```bash
hyperclaw doctor
hyperclaw doctor --fix   # auto-repair where possible
```

### Debug mode
- `hyperclaw gateway start` — runs in foreground with output
- Set `verbose: true` in config for extra logs
