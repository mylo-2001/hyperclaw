# Contributing — HyperClaw
---

<div align="center">

[← FAQ](faq.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; —

</div>

---

## CI Pipeline

CI runs on every push to `main` and every pull request. Workflows use path filtering where applicable to skip jobs when irrelevant paths changed.

### Job overview

| Job | Purpose | When it runs |
|-----|---------|--------------|
| **secrets** | Detect leaked secrets (detect-secrets) | Push to main, all PRs |
| **macos-build** | macOS app test + build | Push to main / PRs when `apps/macos/**` changes |
| **macos-release** | Publish macOS app to GitHub Releases | Push of tag `v*` |

### Secrets scan

- Uses [detect-secrets](https://github.com/Yelp/detect-secrets).
- On push to main: scans all files.
- On PR: scans only changed files.
- Baseline: `.secrets.baseline`. Unreviewed entries fail the job.

### macOS build

- Path filter: `apps/macos/**`.
- Runs `npm test` then `npm run build:mac`.
- Uploads artifacts (dmg, zip).

### macOS release

- Triggered by `git push --tags v*`.
- Builds the macOS app and creates a GitHub Release with appcast for auto-update.

### Runners

| Runner | Jobs |
|--------|------|
| `ubuntu-latest` | secrets |
| `macos-latest` | macos-build, macos-release |

---

## Local equivalents

Run these before opening a PR:

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript type check |
| `npm test` | Vitest tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests |
| `npm run test:e2e` | E2E tests |
| `npm run build` | Build dist |

For macOS app development:

| Command | Purpose |
|---------|---------|
| `npm run macos:build` | Build macOS app |
| `npm run macos:test` | macOS app tests |

---

## Scope logic (future)

A more advanced CI could add:

- **docs-scope:** Skip Node jobs when only `docs/**` changes.
- **changed-scope:** Detect node/macos/android/windows changes.
- **check:** TypeScript + lint + format.
- **build-artifacts:** Single build, shared across jobs.
- **code-analysis:** LOC threshold for PRs.

Scope logic would live in `scripts/ci-changed-scope.mjs` and could be tested with `scripts/ci-changed-scope.test.ts`.

---

<div align="center">

[← FAQ](faq.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; —

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>