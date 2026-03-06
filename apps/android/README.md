# HyperClaw Android App

Native Android app for HyperClaw with Connect, Chat, Voice, and Canvas tabs. **Status: Available** — production build.

## Implemented

- **Connect Tab** — Gateway URL + optional token; auth/pairing with `node_register`; persisted settings
- **Chat Tab** — Message list, send to agent; messages persisted across restarts
- **Voice Tab** — Speech-to-text → send to agent
- **Canvas Tab** — WebView for gateway dashboard / canvas
- **Auth/Pairing** — Gateway token field; node registration with platform, deviceName, capabilities
- **Persistence** — DataStore for gateway URL, token; JSON for chat messages
- **Reconnect** — Auto-reconnect with exponential backoff (1s → 2s → 4s … up to 30s)
- **Node commands** — Location (FusedLocationProvider), notify (local notification)
- **Tests** — Unit tests for ChatMessage; instrumented tests for AppPrefs

## Remaining Hardening

- Background service robustness for long-lived connections
- Keystore-backed token storage for stricter device hardening

## Release

See [docs/RELEASE.md](docs/RELEASE.md) for the Android release checklist and signing notes.
