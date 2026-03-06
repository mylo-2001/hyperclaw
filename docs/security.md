# Security — HyperClaw

Core security practices for HyperClaw.

---

## DM Policy (Direct Messages)

HyperClaw connects to real messaging channels. Inbound DMs are **untrusted input**.

### Policies (per channel)

| Policy | Description |
|--------|-------------|
| `pairing` | Unknown senders receive a pairing code — approve with `hyperclaw pairing approve <channel> <code>` |
| `allowlist` | Only users in the allowlist |
| `open` | Anyone can send (use with caution) |
| `disabled` | DMs disabled |

### Recommended

- **Default:** `pairing` for Telegram, Discord, Slack, WhatsApp, Signal
- For public bots: `open` + `allowFrom: ["*"]` only if you know what you're doing
- Run `hyperclaw doctor` to check for risky DM policies

---

## API Keys

- Do not commit `.env` or config files with keys
- Use `hyperclaw config set-key` or env vars
- Credentials are stored with 0o600 permissions in `~/.hyperclaw/credentials/`

---

## Gateway Exposure

- **Default bind:** `127.0.0.1` — localhost only
- For remote access: Tailscale Serve/Funnel or SSH tunnel
- If you open to `0.0.0.0`: always use `authToken`

---

## Sandbox (non-main sessions)

For group/channel sessions you do not trust:

- Set `agents.defaults.sandbox.mode: "non-main"`
- Non-main sessions then run in a sandbox (e.g. Docker) with restricted tools

---

## PC Access

`pcAccess` gives the agent access to the host (bash, file read/write).

- `full`: full access
- `read-only`: read only
- `sandboxed`: restricted

Configured in config or during onboard.
