# HyperClaw macOS Menu Bar App

Production Electron menu bar app for macOS. Single desktop choice — use this, not `macos-menubar` (Tauri skeleton, deprecated).

## Features

- **Tray** — Menu bar icon, connection status
- **Connect / Pair** — Auth UI: gateway URL + token, test connection
- **Chat** — Persistent conversation (stored locally)
- **Dashboard** — Opens gateway web dashboard
- **Devices** — View connected mobile nodes (iOS/Android)
- **Voice PTT** — Push-to-talk, sends to chat
- **Settings** — Gateway URL, auth token, launch at login, notifications
- **Shell commands** — hyperclaw status, hyperclaw doctor

## Run

```bash
cd apps/macos && npm install && npm start
```

## Build

```bash
cd apps/macos && npm run build
# Output: dist/mac/HyperClaw.app, dist/HyperClaw-5.0.1.dmg
```

## Auto-update

Uses GitHub Releases. Tag a version (`git tag v5.0.1 && git push origin v5.0.1`) to trigger `.github/workflows/macos-release.yml`. The packaged app checks for updates on startup. See [docs/RELEASE.md](docs/RELEASE.md).
