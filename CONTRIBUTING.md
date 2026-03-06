# Contributing to HyperClaw

Thanks for your interest! 🦅

## Quick Start

```bash
git clone https://github.com/yourusername/hyperclaw
cd hyperclaw
npm install
npm run dev -- status    # test it works
```

## Project Structure

See `AGENTS.md` for a full source map. Key directories:

```
src/cli/         — CLI entry point (run-main.ts) and wizard
src/gateway/     — WebSocket gateway server (server.ts; manager.ts migrated to packages/gateway)
src/channels/    — Channel registry and pairing
src/hooks/       — Hook loader (6 builtin hooks)
src/secrets/     — Credential storage and secrets management
src/security/    — Security audit
src/canvas/      — Live UI renderer
src/sdk/         — Plugin SDK (public API)
packages/core/   — Core agent engine (inference, tools, memory, skills)
packages/gateway/— Gateway manager (fully migrated from src/gateway/manager.ts)
packages/shared/ — Shared types, path resolution (HyperClawConfig, getHyperClawDir, etc.)
apps/web/        — React web UI
apps/ios/        — iOS SwiftUI app (Chat, Connect, Voice, Canvas tabs)
apps/android/    — Android Kotlin + Compose app
extensions/      — Channel and feature extensions
```

## Code Conventions

- TypeScript strict mode always on
- No `any` except when unavoidable (add a comment)
- `chalk` for all terminal colors — use `src/terminal/palette.ts`
- Secrets → `CredentialsStore`, never hardcoded or in config
- File permissions → always `0600` for sensitive files, `0700` for dirs
- Port `18789` everywhere (not 1515 or 9000)
- Config file: `hyperclaw.json` (not `config.json`)

## Adding a Channel

1. Add definition to `src/channels/registry.ts`
2. Create stub in `extensions/<channelId>/index.ts`
3. Add to the channels table in `README.md`
4. Test with `hyperclaw channels add`

## Adding a Hook

1. Add to `src/hooks/loader.ts` in the `BUILTIN_HOOKS` array
2. Implement handler in the `execute()` method
3. Add entry to `TOOLS.md` template in `workspace-templates/`

## Adding a CLI Command

1. Add handler in appropriate `src/commands/*.ts` file
2. Register in `src/cli/run-main.ts`
3. Update README.md command reference table

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Run `npm run build:tsc` before submitting
- Update README.md if you add commands or change behavior
- See `.github/PULL_REQUEST_TEMPLATE.md` for the full checklist

## Security Issues

See `SECURITY.md` — please report via email, not GitHub issues.
