# Tailscale Serve / Funnel — HyperClaw

Εξαγωγή του gateway στο διαδίκτυο μέσω Tailscale για ασφαλή remote access χωρίς ανοιχτά ports.

---

## Tailscale Serve (στο δίκτυο σου)

1. Εγκατάστησε [Tailscale](https://tailscale.com/download)
2. Σύνδεση: `tailscale login`
3. Serve:
   ```bash
   tailscale serve https / http://127.0.0.1:18789
   ```
4. Το gateway θα είναι διαθέσιμο στο Tailscale hostname σου (π.χ. `https://your-machine.tailnet-name.ts.net`)

---

## Tailscale Funnel (δημόσιο)

⚠️ Προσοχή: Το Funnel ανοίγει πρόσβαση σε όλους. Χρησιμοποίησε `authToken` στο gateway config.

```bash
tailscale funnel 443
tailscale serve https / http://127.0.0.1:18789
```

---

## Ρυθμίσεις gateway

Στο `hyperclaw.json`:
```json
{
  "gateway": {
    "port": 18789,
    "bind": "127.0.0.1",
    "authToken": "your-secret-token"
  }
}
```

Όταν χρησιμοποιείς Tailscale Funnel, πάντα έβαλε `authToken` για προστασία.
