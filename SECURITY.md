<a name="top"></a>

# Security Policy

<div align="center">

[🏠 Main README](README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>

---


## Supported Versions

| Version | Supported |
|---------|-----------|
| 4.x     | ✅ Yes    |
| 3.x     | ⚠️ Critical only |
| < 3.0   | ❌ No     |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Report by emailing: **securityhyperclaw.ai@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce (exact code path, file, function, line range)
- Tested HyperClaw version / commit
- Potential impact and trust boundary crossed
- Suggested fix (if any)

We will respond within **48 hours** and aim to patch critical issues within **7 days**.  
You will be credited in the advisory (unless you prefer anonymity).

---

## Scope / Deployment model

HyperClaw uses a **personal assistant** security model: one trusted operator boundary per gateway.

- Supported: one user/trust boundary per gateway (prefer one OS user/host/VPS per boundary)
- **Not supported** as a security boundary: one shared gateway used by mutually untrusted or adversarial users

---

## Quick security audit

```bash
hyperclaw security audit           # standard check (~30 checkIds)
hyperclaw security audit --deep    # + live gateway probe
hyperclaw security audit --fix     # auto-repair safe findings
hyperclaw security audit --json    # machine-readable output
```

---

## Hardened baseline (copy/paste)

```json
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token", "token": "replace-with-long-random-token" },
    "reload": { "mode": "hybrid" },
    "trustedProxies": []
  },
  "session": { "dmScope": "per-channel-peer" },
  "tools": {
    "profile": "messaging",
    "deny": ["group:automation", "group:runtime", "group:fs", "sessions_spawn", "sessions_send"],
    "fs": { "workspaceOnly": true },
    "exec": { "security": "deny", "ask": "always" },
    "elevated": { "enabled": false }
  },
  "channels": {
    "telegram": { "dmPolicy": "pairing", "groups": { "*": { "requireMention": true } } }
  }
}
```

---

## Incident Response (quick summary)

**Contain:** stop the gateway (`hyperclaw stop`), set `bind: "loopback"`, disable risky DM policies.  
**Rotate:** regenerate gateway auth token, rotate any leaked provider API keys.  
**Audit:** review logs (`hyperclaw logs --tail 200`), session transcripts (`~/.hyperclaw/agents/*/sessions/*.jsonl`), re-run `hyperclaw security audit --deep`.

Full incident response guide: [`docs/security.md`](./docs/security.md#incident-response)

---

## Security Architecture

### Gateway
- Default bind: `127.0.0.1` (local only)
- Auth token required for all WebSocket/HTTP connections
- Token stored in `hyperclaw.json` (mode `0600`)
- `trustedProxies` for X-Forwarded-For trust when behind a reverse proxy
- Config hot-reload via file watcher (`gateway.reload.mode: "hybrid"`)
- Config RPC (`/api/v1/config/apply`, `/api/v1/config/patch`) — rate-limited to 3 req/60 s

### Credentials
- `~/.hyperclaw/credentials/<provider>.json` (mode `0600`)
- `~/.hyperclaw/credentials/` directory (mode `0700`)
- Never committed to git (`.gitignore` covers `credentials/` and `.env`)

### DM Policies
- Default: `pairing` — unknown senders get a 6-char code
- `session.dmScope: "per-channel-peer"` for shared inboxes
- `hyperclaw security audit --deep` checks DM policies

### Browser control
- Uses dedicated `hyperclaw` browser profile by default
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork: false` for strict mode
- Never point the agent at your personal daily-driver browser profile

### Skills/Plugins
- `hyperclaw hub --scan <id>` before installing
- Dangerous skills flagged in security audit
- Skills run in the same Node.js process — review code before installing

---

## Not vulnerabilities by design

The following are **closed as no-action** unless a real boundary bypass is shown:

- Prompt-injection-only chains without a policy/auth/sandbox bypass
- `sessions.list` / `chat.history` operator read-path access in a shared-gateway setup
- Localhost-only deployment findings (HSTS on loopback-only gateway)
- `sessionKey` treated as a user auth boundary (it is a routing key)
- Normal operator read-path access to session metadata

---

## Full security documentation

See [`docs/security.md`](./docs/security.md) for:
- Complete threat model table
- Per-agent access profiles
- Sandboxing configuration
- Browser SSRF policy
- Logs & transcript redaction
- Credential storage map
- detect-secrets CI scanning
- Researcher preflight checklist

---

<div align="center">

[🏠 Main README](README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>
