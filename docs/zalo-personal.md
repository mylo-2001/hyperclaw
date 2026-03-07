# Zalo Personal — HyperClaw

**Status:** Experimental. Automates a personal Zalo account via Zalo Web API (cookie-based).

⚠️ **Warning:** Unofficial integration. May result in account suspension/ban. Use at your own risk.

---

## What it is

- Uses Zalo Web (chat.zalo.me) cookie auth — no external zca/zalo-api binary.
- Long-polling to receive inbound messages.
- Sends replies via the Zalo Web API (text; media/link support limited).
- Designed for personal-account use where Zalo Official Account (OA) is not available.

## Naming

Channel ID is **`zalo-personal`** to distinguish from **`zalo`** (Zalo OA / Official Account API).

---

## Quick setup

### 1. Get cookie from Zalo Web

1. Open [chat.zalo.me](https://chat.zalo.me) in a browser.
2. Log in with your Zalo account.
3. Open DevTools (F12) → **Application** → **Cookies** → `chat.zalo.me`.
4. Copy the cookie string (e.g. `zpw_sek=...; zpw_vt2=...` — copy all relevant cookies as one string).

### 2. Configure

```json
{
  "gateway": { "enabledChannels": ["zalo-personal"] },
  "channels": {
    "zalo-personal": {
      "enabled": true,
      "cookie": "${ZALO_PERSONAL_COOKIE}",
      "dmPolicy": "pairing"
    }
  }
}
```

**Env fallback:** `ZALO_PERSONAL_COOKIE=zpw_sek=...; zpw_vt2=...`

### 3. Start gateway and approve pairing

```bash
hyperclaw gateway
hyperclaw pairing list zalo-personal
hyperclaw pairing approve zalo-personal <CODE>
```

---

## Access control (DMs)

| `channels.zalo-personal.dmPolicy` | Behavior |
|----------------------------------|----------|
| `pairing` (default) | Unknown senders get a 6-digit code. Approve with `hyperclaw pairing approve zalo-personal <CODE>`. |
| `allowlist` | Only user IDs in `allowFrom` can DM. |
| `open` | Public inbound DMs (use with caution). |
| `disabled` | Ignore inbound DMs. |

`allowFrom` accepts Zalo user IDs (numeric strings). Use IDs for reliability; names may not resolve.

---

## Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cookie` | string | required | Full cookie string from chat.zalo.me (or env `ZALO_PERSONAL_COOKIE`) |
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `disabled` |
| `allowFrom` | string[] | [] | Allowed sender user IDs |
| `enabled` | boolean | true | Enable/disable channel |

---

## Limits

- **Text:** Outbound messages are chunked to ~2000 characters (Zalo client limits).
- **Groups:** Not supported in current implementation (DMs only).
- **Cookie expiry:** Cookies expire. Re-extract from browser when the channel stops receiving.

---

## Finding user IDs

- Check gateway logs when a message arrives: `from` is the user ID.
- Or use Zalo Web and inspect network requests for conversation IDs.

---

## Troubleshooting

### Login / cookie doesn't stick

- Ensure the cookie string is complete and unexpired.
- Re-extract from browser: clear old cookies, log in again, copy fresh cookies.
- Verify you're logged in at chat.zalo.me and the session is active.

### Not receiving messages

- Cookie may have expired. Re-extract from browser.
- Check gateway logs for Zalo API errors.

### Allowlist / pairing not working

- Use numeric user IDs in `allowFrom`, not names.
- Verify the user ID format matches what the connector receives (check logs).

---

## Security

- **Never commit cookies** — use environment variables.
- **Account risk:** Unofficial API use may violate Zalo ToS. Use a secondary account if possible.

---

## Related

- [Pairing](security.md#pairing)
- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)
