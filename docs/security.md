# Security — HyperClaw

Βασικά security practices για το HyperClaw.

---

## DM Policy (Direct Messages)

Το HyperClaw συνδέεται με πραγματικά messaging channels. Τα inbound DMs είναι **untrusted input**.

### Πολιτικές (ανά channel)

| Policy | Περιγραφή |
|--------|-----------|
| `pairing` | Άγνωστοι λαμβάνουν pairing code· approve με `hyperclaw pairing approve <channel> <code>` |
| `allowlist` | Μόνο users από allowlist |
| `open` | Όλοι μπορούν να στέλνουν (με προσοχή) |
| `disabled` | DMs απενεργοποιημένα |

### Προτείνεται

- **Default:** `pairing` για Telegram, Discord, Slack, WhatsApp, Signal
- Για public bots: `open` + `allowFrom: ["*"]` μόνο αν ξέρεις τι κάνεις
- Τρέξε `hyperclaw doctor` για έλεγχο risky DM policies

---

## API Keys

- Μην committεις `.env` ή config με keys
- Χρησιμοποίησε `hyperclaw config set-key` ή env vars
- Credentials αποθηκεύονται με 0o600 permissions στο `~/.hyperclaw/credentials/`

---

## Gateway Exposure

- **Default bind:** `127.0.0.1` — μόνο localhost
- Για remote access: Tailscale Serve/Funnel ή SSH tunnel
- Αν ανοίξεις σε `0.0.0.0`: χρησιμοποίησε `authToken`

---

## Sandbox (non-main sessions)

Για group/channel sessions που δεν εμπιστεύεσαι:

- Ρύθμισε `agents.defaults.sandbox.mode: "non-main"`
- Τότε τα non-main sessions τρέχουν σε sandbox (π.χ. Docker) με περιορισμένα tools

---

## PC Access

Το `pcAccess` δίνει στο agent πρόσβαση στο host (bash, read, write).

- `full`: πλήρης πρόσβαση
- `read-only`: μόνο ανάγνωση
- `sandboxed`: περιορισμένα

Ρυθμίζεται στο config ή κατά το onboard.
