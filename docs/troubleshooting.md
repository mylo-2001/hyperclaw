# Troubleshooting — HyperClaw

Συχνά προβλήματα και λύσεις.

---

## Gateway δεν ξεκινά

### "Gateway not running"
- Εκτέλεσε `hyperclaw daemon start` ή `hyperclaw gateway start`
- Έλεγξε port: default `18789`. Αν χρησιμοποιείται, άλλαξε στο `~/.hyperclaw/hyperclaw.json` → `gateway.port`
- `hyperclaw doctor` για health check

### "Address already in use"
- Κάποιο άλλο process ακούει στο ίδιο port:
  - Windows: `netstat -ano | findstr :18789`
  - Linux/macOS: `lsof -i :18789`
- Σταμάτα το process ή άλλαξε port

### Daemon σταματάει αμέσως
- Έλεγξε logs: `~/.hyperclaw/logs/gateway.log`, `gateway.err`
- Αν λείπει config: τρέξε `hyperclaw onboard`
- Έλεγξε API key: `hyperclaw config show` — πρέπει να υπάρχει `provider.apiKey` ή env `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`

---

## API / Model errors

### "No API key configured"
- Ρύθμισε key: `hyperclaw config set-key provider.apiKey=sk-xxx`
- Ή env: `OPENROUTER_API_KEY` ή `ANTHROPIC_API_KEY`
- Δες `.env.example` για όλες τις μεταβλητές

### "Model not found" / 404
- Έλεγξε ότι το model ID είναι σωστό (π.χ. `anthropic/claude-sonnet-4`)
- OpenRouter: χρησιμοποίησε IDs από https://openrouter.ai/models

### Rate limits / 429
- Περίμενε λίγο και ξαναπρόσπαθε
- Άλλαξε model ή provider αν συνεχίζει

---

## Channels

### Channel δεν λαμβάνει/στέλνει μηνύματα
- Έλεγξε config: `channels.<channel>.enabled === true`
- Για Telegram/Discord: σωστό bot token
- Για WhatsApp: `hyperclaw channels login` — link device
- DM policy: αν `pairing`, κάνε approve με `hyperclaw pairing approve <channel> <code>`

### Webhook 404
- Gateway πρέπει να τρέχει
- URL: `http://localhost:18789/webhook/<channelId>`
- Έλεγξε ότι το channel έχει σωστό `webhookUrl` στο config

---

## Config & paths

### Πού αποθηκεύεται το config;
- Config: `~/.hyperclaw/hyperclaw.json`
- Credentials: `~/.hyperclaw/credentials/`
- Logs: `~/.hyperclaw/logs/`
- Override με `HYPERCLAW_HOME` ή `HYPERCLAW_CONFIG_PATH`

### Config δεν φορτώνει
- Έλεγξε syntax JSON: `cat ~/.hyperclaw/hyperclaw.json | jq .`
- Αν είναι corrupted: backup και `hyperclaw onboard` ξανά

---

## Systemd / LaunchAgent

### Linux: service δεν τρέχει
- User service: `systemctl --user status hyperclaw`
- Lingering: `loginctl enable-linger $USER` για να τρέχει χωρίς login
- `journalctl --user -u hyperclaw -f` για logs

### macOS: LaunchAgent δεν ξεκινά
- `launchctl list | grep hyperclaw`
- Plist: `~/Library/LaunchAgents/ai.hyperclaw.gateway.plist`
- Load: `launchctl load ~/Library/LaunchAgents/ai.hyperclaw.gateway.plist`
- Stdout/stderr: `~/.hyperclaw/logs/gateway.log`, `gateway.err`

---

## Γενικά

### `hyperclaw doctor`
Τρέχε πάντα για διάγνωση:
```bash
hyperclaw doctor
hyperclaw doctor --fix   # auto-repair όπου μπορεί
```

### Debug mode
- `hyperclaw gateway start` — τρέχει foreground με output
- Ρύθμισε `verbose: true` στο config για extra logs
