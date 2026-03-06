# macOS remote control — Gateway via SSH

Έλεγχος του HyperClaw gateway από το macOS app (ή άλλο client) μέσω SSH.

## Τρόποι

### 1. SSH port forwarding

Στο Mac από το οποίο τρέχει το HyperClaw daemon, ανοίξτε tunnel προς το host όπου τρέχει το gateway:

```bash
ssh -L 18789:127.0.0.1:18789 user@remote-host
```

Στη συνέχεια στο macOS app ορίστε gateway URL: `http://127.0.0.1:18789`. Όλες οι κλήσεις (status, chat, WebSocket) περνούν μέσω του tunnel.

### 2. CLI μέσω SSH

Για status, restart κ.λπ. από το macOS app (ή script):

```bash
ssh user@remote-host "hyperclaw gateway status"
ssh user@remote-host "hyperclaw daemon restart"
```

Ρύθμισε SSH keys ώστε να μην ζητάει password.

### 3. API με auth

Αν το gateway έχει `gateway.authToken`:

- `GET /api/status` — χωρίς auth
- `POST /api/remote/restart` — απαιτεί `Authorization: Bearer <token>`· επιστρέφει οδηγίες για restart μέσω SSH

## Παράδειγμα (macOS app)

1. Ο χρήστης δίνει remote host (user@host).
2. Το app κάνει `ssh -L 18789:127.0.0.1:18789 user@host -N` στο background.
3. Συνδέεται στο WebSocket/HTTP στο `http://127.0.0.1:18789`.
4. Για restart: είτε `ssh user@host "hyperclaw daemon restart"` είτε εμφάνιση οδηγιών από `POST /api/remote/restart`.
