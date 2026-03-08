# Nostr — HyperClaw
---

<div align="center">

[← Tlon / Urbit](tlon.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Twitch →](twitch.md)

</div>

---

Nostr is a decentralized protocol for social networking. This channel enables HyperClaw to receive and respond to encrypted direct messages (DMs) via NIP-04.

**Status:** Extension bundled with core. Add `nostr` to `gateway.enabledChannels` and configure.

---

## Extension

Nostr ships in `extensions/nostr`. It is bundled with the core install. Enable by adding `nostr` to `gateway.enabledChannels` and providing a private key and relays.

---

## Quick setup

1. **Generate a Nostr keypair** (if needed):
   ```bash
   # Using openssl
   openssl rand -hex 32
   # Or use a Nostr client (Damus, Amethyst, iris.to) to create an account and export nsec
   ```

2. **Add to config:**
   ```json
   {
     "gateway": { "enabledChannels": ["nostr"] },
     "channels": {
       "nostr": {
         "privateKeyHex": "${NOSTR_PRIVATE_KEY}",
         "relays": ["wss://relay.damus.io", "wss://nos.lol"]
       }
     }
   }
   ```

3. **Export the key:**
   ```bash
   export NOSTR_PRIVATE_KEY="<64-char-hex>"
   # Or for nsec: convert with nostr-tools (nip19.decode) — connector expects hex
   ```

4. **Restart the Gateway**

---

## Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `privateKeyHex` | string | required | Private key: 64-char hex or use env `NOSTR_PRIVATE_KEY` |
| `relays` | string[] | `['wss://relay.damus.io','wss://nos.lol']` | Relay WebSocket URLs |
| `dmPolicy` | string | `pairing` | `pairing` \| `allowlist` \| `open` \| `none` |
| `allowFrom` | string[] | `[]` | Allowed sender pubkeys (npub or hex) |
| `enabled` | boolean | true | Enable/disable channel |

### Key formats

- **Private key:** 64-char hex. For nsec format, decode first (e.g. `nostr-tools` nip19).
- **Pubkeys (allowFrom):** npub or hex

---

## Access control

### DM policies

- **`pairing`** (default): Unknown senders get a 6-digit pairing code. Approve with:
  `hyperclaw pairing approve nostr <CODE>`
- **`allowlist`**: Only pubkeys in `allowFrom` can DM
- **`open`**: Public inbound DMs (use with caution)
- **`disabled`**: Ignore inbound DMs

### Allowlist example

```json
{
  "channels": {
    "nostr": {
      "privateKeyHex": "${NOSTR_PRIVATE_KEY}",
      "dmPolicy": "allowlist",
      "allowFrom": ["npub1abc...", "npub1xyz..."]
    }
  }
}
```

---

## Relays

Default relays: `relay.damus.io`, `nos.lol`, `relay.nostr.band`.

Custom relays:

```json
{
  "channels": {
    "nostr": {
      "privateKeyHex": "${NOSTR_PRIVATE_KEY}",
      "relays": ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nostr.wine"]
    }
  }
}
```

Or via env: `NOSTR_RELAYS="wss://relay.damus.io,wss://nos.lol"` (comma-separated).

**Tips:**
- Use 2–3 relays for redundancy
- Avoid too many (latency, duplication)
- Local relays work for testing: `ws://localhost:7777`

---

## Protocol support

| NIP | Status | Description |
|-----|--------|-------------|
| NIP-01 | Supported | Basic event format |
| NIP-04 | Supported | Encrypted DMs (kind:4) |
| NIP-17 | Planned | Gift-wrapped DMs |
| NIP-44 | Planned | Versioned encryption |

---

## Testing

### Local relay

```bash
# Start strfry
docker run -p 7777:7777 ghcr.io/hoytech/strfry
```

```json
{
  "channels": {
    "nostr": {
      "privateKeyHex": "${NOSTR_PRIVATE_KEY}",
      "relays": ["ws://localhost:7777"]
    }
  }
}
```

### Manual test

1. Note the bot pubkey (npub) from gateway logs
2. Open a Nostr client (Damus, Amethyst, etc.)
3. DM the bot pubkey
4. Verify the response

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Not receiving messages | Verify private key is valid hex. Ensure relay URLs are reachable (wss:// or ws://). Check `enabled` is not false. Check gateway logs for relay connection errors |
| Not sending responses | Check relay accepts writes. Verify outbound connectivity. Watch for relay rate limits |
| Duplicate responses | Expected with multiple relays. Messages are deduplicated by event ID |

---

## Security

- **Never commit private keys** — use environment variables
- **Consider allowlist** for production bots
- Keep nsec/hex secret

---

## Limitations (MVP)

- Direct messages only (no group chats)
- No media attachments
- NIP-04 only (NIP-17 gift-wrap planned)
- Profile metadata (NIP-01 kind:0) not yet published by connector

---

<div align="center">

[← Tlon / Urbit](tlon.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Twitch →](twitch.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>