# Mobile & Desktop Apps — HyperClaw

Comparison of native mobile/desktop app support between OpenClaw and HyperClaw.

## Overview

| Feature | OpenClaw | HyperClaw |
|---------|----------|-----------|
| **iOS** | Native app (Canvas, camera, screen recording, location, voice) | ✅ Native app (Connect, Chat, Voice, Canvas, token auth, session restore) |
| **Android** | Native app (Connect tab, device commands, motion, SMS, contacts, calendar) | ✅ Native app (Connect, Chat, Voice, Canvas, device commands) |
| **macOS** | Menu bar app for iOS/Android nodes | ✅ Electron menu bar app (production) |
| **Hosting** | Managed hosting option | ✅ Dockerfile, fly.toml, render.yaml |

## HyperClaw Status

- **Self-hosted focus** — Run on your own devices; no managed cloud
- **CLI + gateway** — Full control via terminal and WebSocket gateway
- **Web dashboard** — `apps/web` provides a web UI
- **Native apps** — iOS and Android implemented with release checklists; macOS Electron menu bar app (production)

## Native Apps (Implemented)

| App | Location | Description |
|-----|----------|-------------|
| **iOS** | [apps/ios/](../apps/ios/README.md) | Native app: Canvas, voice, pairing, token auth, session restore |
| **Android** | [apps/android/](../apps/android/README.md) | Native app: Connect, Chat, Voice, Canvas, device commands, release checklist |
| **macOS Menu Bar** | [apps/macos/](../apps/macos/README.md) | Production Electron app: Connect, Chat, Devices, Voice, Settings |

> ⚠️ `apps/macos-menubar` (Tauri) is deprecated — use `apps/macos` (Electron).

## Future Direction

| Item | Location | Description |
|------|----------|-------------|
| **Managed Hosting** | [docs/managed-hosting.md](managed-hosting.md) | Future — cloud-hosted gateway option (not productized) |

See [architecture](architecture.md) for the current system design.
