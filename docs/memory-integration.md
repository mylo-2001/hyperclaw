# Memory Integration — Obsidian, Raycast, Hazel

Ενσωμάτωση του HyperClaw MEMORY.md με Obsidian vault, Raycast search και Hazel.

## Ενεργοποίηση

Κατά το **onboard** (`hyperclaw init` ή `hyperclaw onboard`), ρωτάει προαιρετικά για vault path. Εναλλακτικά, ορίζεις manual στο `~/.hyperclaw/hyperclaw.json`:

```json
{
  "memoryIntegration": {
    "vaultDir": "/Users/you/Documents/ObsidianVault",
    "dailyNotes": true,
    "syncOnAppend": true
  }
}
```

## Τι γίνεται

1. **MEMORY.md sync** — Το `~/.hyperclaw/MEMORY.md` αντιγράφεται στο vault ως `HyperClaw-MEMORY.md` (ανανεώσιμο, editable).
2. **Daily notes** — Δημιουργούνται αρχεία `HyperClaw/YYYY-MM-DD.md` με session summaries και νέα facts.
3. **Searchable** — Το Raycast indexει φακέλους όπως `Documents`· αν το vault είναι εκεί, οι σημειώσεις είναι searchable.
4. **Hazel** — Μπορείς να ορίσεις rules στο `vaultDir` (π.χ. move, tag) όταν προστεθούν νέα αρχεία.

## Obsidian

- Βάλε το `vaultDir` στη διαδρομή του Obsidian vault σου.
- Οι daily notes εμφανίζονται ως `HyperClaw/2025-03-03.md`.
- Το `HyperClaw-MEMORY.md` μπορείς να το linkάρεις από άλλες σημειώσεις.

## Raycast

- Αν το vault είναι σε indexed folder (π.χ. `~/Documents`), οι σημειώσεις εμφανίζονται στο Raycast search.
- Μπορείς να δημιουργήσεις extension που τρέχει `hyperclaw memory search <query>` για targeted search.

## Hazel

- Δημιούργησε rule στο `vaultDir` για τα αρχεία `HyperClaw/*.md`.
- Π.χ. "Τρέξε script" όταν προστεθεί νέο αρχείο — για sync, backup κ.λπ.
