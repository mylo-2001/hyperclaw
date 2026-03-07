# Update Notifications

HyperClaw automatically checks for newer versions on npm and notifies you at startup — no extra tools or packages needed.

## What you see

When a newer version is available, this appears right after any command:

```
  ⬆  Update available: 5.0.4 → 5.0.4
     npm install -g hyperclaw@latest
```

The check is **non-blocking** — it runs in the background and never delays startup.

## How it works

There are two check points:

### 1. CLI startup (`hyperclaw <any command>`)

`src/cli/run-main.ts` runs `checkForUpdate()` at the very bottom of the file, after all commands are registered:

```typescript
// src/cli/run-main.ts
function checkForUpdate(): void {
  const { execFile } = require('child_process');
  const { readFileSync } = require('fs');
  try {
    const current: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
    execFile('npm', ['view', 'hyperclaw', 'version', '--json'], { timeout: 5000 },
      (_err, stdout) => {
        const latest: string = JSON.parse(stdout.trim());
        if (isNewer(latest, current)) {
          process.stdout.write(
            chalk.yellow(`\n  ⬆  Update available: ${current} → ${latest}\n`) +
            chalk.gray(`     npm install -g hyperclaw@latest\n\n`)
          );
        }
      }
    );
  } catch { /* silent fail */ }
}

checkForUpdate(); // fires and forgets — never blocks
```

### 2. Banner / gateway start

`src/infra/update-check.ts` is called from the banner (`src/terminal/banner.ts`) when the gateway starts:

```typescript
// src/infra/update-check.ts
export async function checkForUpdates(currentVersion: string) {
  // Hits https://registry.npmjs.org/hyperclaw/latest with 3s timeout
  // Returns { latest, available } or null on any error
}

export function maybeShowUpdateNotice(skipInDaemon = false): void {
  // Fire-and-forget wrapper — silent on any failure
  // Does nothing in daemon mode (skipInDaemon = true)
}
```

```typescript
// src/terminal/banner.ts
const { maybeShowUpdateNotice } = await import('../infra/update-check');
maybeShowUpdateNotice(daemonMode); // skipped in daemon mode
```

## Disabling

Set the environment variable to opt out completely:

```bash
HYPERCLAW_NO_UPDATE_CHECK=1 hyperclaw agent --message "hello"
```

Or add it to your shell profile (`~/.zshrc`, `~/.bashrc`):

```bash
export HYPERCLAW_NO_UPDATE_CHECK=1
```

## Update channels

HyperClaw supports three release channels. Switch with:

```bash
hyperclaw update --channel stable   # default — tagged releases
hyperclaw update --channel beta     # prereleases
hyperclaw update --channel dev      # latest main branch
```

The update notification always compares against the `latest` npm tag (stable channel).

## Source files

| File | Role |
|------|------|
| `src/infra/update-check.ts` | Core logic: npm registry fetch, semver compare, console output |
| `src/cli/run-main.ts` | CLI-level fire-and-forget check (uses `npm view` via child_process) |
| `src/terminal/banner.ts` | Calls `maybeShowUpdateNotice()` after gateway banner |
