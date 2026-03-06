# Plugin Registry & Community Skills

HyperClaw includes a complete skill marketplace flow:

- Bundled skill hub via `hyperclaw hub`
- Remote/community registry via ClawHub-compatible APIs
- Install/search/list commands via `hyperclaw skill ...`
- SDK exports for plugin authors via `src/sdk/index.ts`

## User commands

```bash
hyperclaw hub
hyperclaw hub --marketplace
hyperclaw skill search calendar
hyperclaw skill install github
hyperclaw skill list
```

## Registry behavior

- Bundled skills are listed from `src/plugins/hub.ts`
- Remote skills are resolved through `src/skills/clawhub.ts`
- Installed community skills are persisted under `~/.hyperclaw/workspace/skills/<skillId>/SKILL.md`
- Risky bundled skills can be blocked or force-installed, with scan output in the hub UI

## Community authoring

Plugin and skill authors can target the SDK in `src/sdk/index.ts`, which exposes:

- plugin lifecycle hooks
- tool registration
- gateway messaging
- canvas APIs
- memory APIs
- secrets and config APIs

## Status

This is a working registry/community surface, not a placeholder. The repo already ships the command surface, registry client, persistence path, bundled catalog, and SDK contract needed for a usable community ecosystem.
