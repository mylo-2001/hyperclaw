# WhatsApp — HyperClaw

WhatsApp is production-ready via **WhatsApp Web (Baileys)**. No Meta Business API needed. The gateway owns the linked session.

**Status:** Baileys recommended for most users. Cloud API available for business use.

---

## Two options

| Option | Channel ID | Requires | Best for |
|--------|------------|----------|----------|
| **Baileys** (WhatsApp Web) | `whatsapp-baileys` | QR scan, no Meta account | Personal, small teams |
| **Cloud API** | `whatsapp` | Meta Business, webhook | Business, high volume |

---

## WhatsApp (Baileys) — Quick setup

### 1. Configure access policy

```json
{
  "gateway": { "enabledChannels": ["whatsapp-baileys"] },
  "channels": {
    "whatsapp-baileys": {
      "dmPolicy": "pairing",
      "allowFrom": [],
      "groupPolicy": "allowlist",
      "groupAllowFrom": []
    }
  }
}
```

### 2. Add channel and start gateway

```bash
hyperclaw channels add whatsapp-baileys
hyperclaw gateway
```

On first run, a **QR code** appears in the terminal. Scan it with your phone:

- WhatsApp → **Linked Devices** → **Link a device**
- Scan the QR code

Auth is saved in `~/.hyperclaw/baileys-auth`. No QR needed on subsequent runs.

### 3. Approve first pairing (if using pairing mode)

```bash
hyperclaw pairing list whatsapp-baileys
hyperclaw pairing approve whatsapp-baileys <CODE>
```

Pairing codes expire after 1 hour. Pending requests are capped.

**Tip:** Use a dedicated number when possible. Personal-number setups work too.

---

## WhatsApp (Cloud API) — Quick setup

### 1. Meta setup

1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → Business.
2. Add product: **WhatsApp** → Get started.
3. Copy **Phone Number ID** and **Access Token** from API Setup.
4. Set webhook URL: `https://<your-host>/webhook/whatsapp`.
5. Subscribe to `messages`.

### 2. Config

```json
{
  "gateway": { "enabledChannels": ["whatsapp"] },
  "channels": {
    "whatsapp": {
      "phoneNumberId": "<PHONE_NUMBER_ID>",
      "accessToken": "<ACCESS_TOKEN>",
      "verifyToken": "hyperclaw-verify",
      "dmPolicy": "pairing",
      "allowFrom": []
    }
  }
}
```

Env fallback: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`.

### 3. Start gateway and approve pairing

```bash
hyperclaw gateway
hyperclaw pairing approve whatsapp <CODE>
```

---

## Access control

### DM policy

| `dmPolicy` | Behavior |
|------------|----------|
| `pairing` (default) | Unknown senders get a 6-digit code. Approve with `hyperclaw pairing approve <channel> <CODE>`. |
| `allowlist` | Only numbers in `allowFrom` can DM. |
| `open` | Public DMs (use with caution). Requires `allowFrom: ["*"]` for Cloud API. |
| `disabled` | Ignore inbound DMs. |

`allowFrom` accepts E.164-style numbers (e.g. `+15551234567`). Normalized internally.

### Group policy (Baileys)

| Setting | Description |
|---------|-------------|
| `groupPolicy` | `allowlist` \| `open` \| `disabled` |
| `groupAllowFrom` | Group JIDs or phone numbers. Empty = all groups (when policy allows). |

**MVP:** Baileys connector currently focuses on DMs. Group support is planned.

---

## Runtime model

- **Gateway owns** the WhatsApp socket and reconnect loop.
- **Outbound sends** require an active listener for the target account.
- **Status and broadcast** chats (@status, @broadcast) are ignored.
- **Sessions:** DMs use `session.dmScope`; groups use isolated keys when supported.

---

## Configuration reference

### Baileys (`whatsapp-baileys`)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `disabled` |
| `allowFrom` | string[] | [] | E.164 numbers for allowlist |
| `groupPolicy` | string | `allowlist` | `allowlist` \| `open` \| `disabled` |
| `groupAllowFrom` | string[] | [] | Group allowlist (planned) |

**Auth:** Stored in `~/.hyperclaw/baileys-auth`. Delete to re-link.

### Cloud API (`whatsapp`)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `phoneNumberId` | string | required | From Meta API Setup |
| `accessToken` | string | required | Temporary or system user token |
| `verifyToken` | string | `hyperclaw-verify` | Webhook verification |
| `dmPolicy` | string | `pairing` | Same as Baileys |
| `allowFrom` | string[] | [] | E.164 numbers |

**Env:** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`

---

## Feature reference

| Feature | Baileys | Cloud API |
|---------|---------|-----------|
| DMs | ✅ | ✅ |
| Groups | ⏳ Planned | ✅ (via API) |
| Pairing | ✅ | ✅ |
| Allowlist | ✅ | ✅ |
| Voice notes | ✅ | ✅ |
| Media | ✅ | ✅ |
| Webhook | N/A (long-poll) | ✅ |

---

## Troubleshooting

### Not linked (QR required)

- Ensure `@whiskeysockets/baileys` is installed: `npm install @whiskeysockets/baileys`
- Start the gateway; QR appears in terminal.
- Scan with WhatsApp → Linked Devices → Link a device.
- Check `~/.hyperclaw/baileys-auth` exists after success.

### Linked but disconnected / reconnect loop

- Restart gateway. Baileys auto-reconnects.
- If session is corrupted, remove `~/.hyperclaw/baileys-auth` and scan QR again.

### No active listener when sending

- Gateway must be running. Outbound sends require the socket.

### Group messages ignored

- Baileys MVP: group support is planned. Cloud API: ensure webhook subscribes to group events.

**More help:** [Channel troubleshooting](troubleshooting.md#channels)

---

## Related

- [Pairing](security.md#pairing)
- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)
