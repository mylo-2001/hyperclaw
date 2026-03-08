# Memory Integration — Obsidian, Raycast, Hazel
---

<div align="center">

[← Canvas (a2ui)](canvas-a2ui.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Sessions →](session-management.md)

</div>

---

Sync HyperClaw MEMORY.md with an Obsidian vault, Raycast search, and Hazel.

## Enable

During **onboard** (`hyperclaw onboard`), you are optionally asked for a vault path. Or set it manually in `~/.hyperclaw/hyperclaw.json`:

```json
{
  "memoryIntegration": {
    "vaultDir": "/Users/you/Documents/ObsidianVault",
    "dailyNotes": true,
    "syncOnAppend": true
  }
}
```

## What happens

1. **MEMORY.md sync** — `~/.hyperclaw/MEMORY.md` is copied to the vault as `HyperClaw-MEMORY.md` (updateable, editable).
2. **Daily notes** — Files `HyperClaw/YYYY-MM-DD.md` are created with session summaries and new facts.
3. **Searchable** — Raycast indexes folders like `Documents`; if the vault is there, notes are searchable.
4. **Hazel** — You can set rules on `vaultDir` (e.g. move, tag) when new files are added.

## Obsidian

- Set `vaultDir` to your Obsidian vault path.
- Daily notes appear as `HyperClaw/2025-03-03.md`.
- `HyperClaw-MEMORY.md` can be linked from other notes.

## Raycast

- If the vault is in an indexed folder (e.g. `~/Documents`), notes appear in Raycast search.
- You can create an extension that runs `hyperclaw memory search <query>` for targeted search.

## Hazel

- Create a rule on `vaultDir` for `HyperClaw/*.md` files.
- E.g. "Run script" when a new file is added — for sync, backup, etc.

---

<div align="center">

[← Canvas (a2ui)](canvas-a2ui.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Sessions →](session-management.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>