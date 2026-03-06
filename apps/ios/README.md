# HyperClaw iOS App

Native SwiftUI app for HyperClaw. **Status: Available** — paired iOS node with chat, voice, canvas, token auth, and session restore.

## Requirements

- macOS Ventura or later
- Xcode 15+
- `xcodegen` (`brew install xcodegen`)

## Build

```bash
cd apps/ios

# Generate Xcode project
xcodegen generate

# Open in Xcode
open HyperClaw.xcodeproj

# Build for simulator (no Apple Developer account required)
xcodebuild -project HyperClaw.xcodeproj \
           -scheme HyperClaw \
           -destination 'platform=iOS Simulator,name=iPhone 15' \
           -configuration Debug \
           build
```

## Features

| Feature | Status |
|---------|--------|
| **Chat** | ✅ Full chat UI with message bubbles, scroll-to-bottom, timestamps |
| **Connect** | ✅ Bonjour/mDNS auto-discovery of `_hyperclaw._tcp` on local network |
| **Voice** | ✅ Speech recognition (SFSpeechRecognizer) → sends transcribed text to agent; push-to-talk and continuous/always-on mode |
| **Canvas** | ✅ WKWebView embedding of gateway `/dashboard#canvas` for AI-generated UI components |
| **Settings** | ✅ Gateway URL, auth token, agent name, reconnect |
| **Auto-connect** | ✅ Discovers Bonjour gateways on launch; falls back to configured URL |
| **Pairing** | ✅ Gateway token auth + `node_register` as iOS mobile node |
| **Session restore** | ✅ Restores transcript after reconnect |

## Architecture

- `GatewayConnection` — WebSocket (URLSessionWebSocketTask) to gateway, handles auth, node registration, heartbeat, and transcript restore
- `GatewayDiscovery` — NWBrowser scanning for `_hyperclaw._tcp` Bonjour services
- `VoiceWake` — AVAudioEngine + SFSpeechRecognizer, supports continuous recognition mode
- `ContentView` — TabView: Connect / Chat / Voice / Canvas

## Gateway URL

On device, connect to your Mac's local IP:

```
ws://192.168.x.x:18789
```

Find it with: `ipconfig getifaddr en0`

On simulator, `ws://localhost:18789` works directly.

## Message Protocol

Sends: `{ "type": "chat:message", "content": "<text>", "source": "ios" }`

Receives: Any JSON with a `"content"` string field is shown as an assistant message.

## Release

See [docs/RELEASE.md](docs/RELEASE.md) for the release checklist and signing flow.
