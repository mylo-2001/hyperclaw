# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 4.x     | ✅ Yes    |
| 3.x     | ⚠️ Critical only |
| < 3.0   | ❌ No     |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Report security issues by emailing: **securityhyperclaw.ai@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within **48 hours** and aim to patch critical issues within **7 days**.

## Security Architecture

### Gateway

- Default bind: `127.0.0.1` (local only)
- Auth token required for all WebSocket connections
- Token stored in `hyperclaw.json` (mode `0600`)
- Tailscale integration for secure remote access (recommended over port forwarding)

### Credentials

- Stored in `~/.hyperclaw/credentials/<provider>.json` (mode `0600`)
- Directory: `~/.hyperclaw/credentials/` (mode `0700`)
- Never committed to git (`.gitignore` covers `credentials/` and `.env`)
- `hyperclaw security audit` checks for exposure

### DM Policies

- Default: `allowlist` (only explicitly approved contacts can send DMs)
- `pairing` mode: contact must enter a 6-char code from `hyperclaw pairing list`
- `open`: NOT recommended — any user on the channel can send commands to your agent
- `hyperclaw security audit --deep` checks DM policies

### Prompt Injection

- DM guard hook blocks messages matching injection patterns
- `dm-guard` hook enabled by default
- Allowlist + pairing reduces attack surface

### Skills/Plugins

- `hyperclaw hub --scan <id>` before installing
- Dangerous skills are flagged in `hyperclaw security audit --deep`
- Skills run in the same Node.js process — review code before installing

## Security Checklist

Run `hyperclaw security audit --deep` and fix all CRITICAL and HIGH findings before exposing your gateway.

```
hyperclaw security audit --deep
hyperclaw secrets audit
hyperclaw doctor
```
