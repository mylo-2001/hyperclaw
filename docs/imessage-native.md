# iMessage native (imsg CLI)

iMessage χωρίς BlueBubbles — απευθείας μέσω **imsg** CLI στο macOS.

## Απαιτήσεις

- macOS 14+
- **imsg** εγκατεστημένο: [github.com/steipete/imsg](https://github.com/steipete/imsg) — `git clone ... && make build`
- Full Disk Access για Terminal/Node (για ανάγνωση Messages DB)
- Automation: το Node/Terminal να μπορεί να ελέγχει το Messages.app

## Ρύθμιση

1. Πρόσθεσε το channel `imessage-native` στα enabled channels:

```bash
hyperclaw channels add imessage-native
```

2. Στο `hyperclaw.json` ή από UI, ενεργοποίησε το channel. Δεν χρειάζεται token — το imsg τρέχει τοπικά.

3. (Προαιρετικό) `IMSG_PATH` αν το imsg δεν είναι στο PATH.

## Σύγκριση με BlueBubbles

| | BlueBubbles (imessage) | imessage-native |
|--|------------------------|------------------|
| Εγκατάσταση | BlueBubbles server στο Mac | Μόνο imsg binary |
| Δίκτυο | Απαιτείται πρόσβαση στο Mac (HTTP/WS) | Τοπικό, καμία υπηρεσία |
| Άδειες | Messages.app μέσω server | Full Disk + Automation |

## Pairing

Όπως και στα άλλα channels: το πρώτο μήνυμα από νέο αριθμό θα λάβει pairing code. Εκτέλεσε `hyperclaw pairing approve imessage-native <CODE>` για να εγκριθεί.
