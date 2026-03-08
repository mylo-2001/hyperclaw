# Integrations (Built-in Agent Tools)
---

<div align="center">

[← Zalo](zalo.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [MCP →](mcp.md)

</div>

---

The agent has built-in tools for common integrations. No extra npm packages needed — just set the required environment variables.

---

## Core Tools

### Weather

Free, no API key needed. Uses [Open-Meteo](https://open-meteo.com/).

```
"What's the weather in Athens?"
"5-day forecast for London"
"Is it going to rain in Berlin this weekend?"
```

Actions: `forecast` (location, days 1-7)

---

### Image Generation

```bash
OPENAI_API_KEY=sk-...          # DALL-E 3 (default)
STABILITY_API_KEY=sk-...       # Stability AI (fallback)
```

```
"Generate an image of a space lobster"
"Create a realistic photo of a sunset over the ocean"
```

Actions: `generate` (prompt, size, provider)

---

### GIF Search

```bash
GIPHY_API_KEY=...    # Giphy (preferred)
TENOR_API_KEY=...    # Tenor (fallback)
```

```
"Find a GIF of a dancing cat"
"Send a celebration GIF"
```

Actions: `search` (query, limit)

---

### Spotify

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REFRESH_TOKEN=...    # Get via OAuth flow
```

```
"Play some Daft Punk on Spotify"
"What's playing on Spotify?"
"Skip to the next song"
"Set volume to 60"
```

Actions: `play`, `pause`, `next`, `previous`, `search`, `current`, `volume`

**Getting a refresh token:**
1. Create an app at [developer.spotify.com](https://developer.spotify.com)
2. Add `http://localhost:8888/callback` as redirect URI
3. Run the OAuth flow and save the refresh token

---

### Home Assistant

```bash
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-access-token
```

```
"Turn on the living room lights"
"What's the temperature in the bedroom?"
"Set the thermostat to 22 degrees"
"Toggle the kitchen fan"
```

Actions: `list_entities`, `get_state`, `turn_on`, `turn_off`, `toggle`, `call_service`

---

### GitHub

```bash
GITHUB_TOKEN=ghp_...
```

```
"List my open GitHub issues"
"Show pull requests for myrepo"
"Create an issue: Bug in login flow"
"Search code for TODO comments"
```

Actions: `list_repos`, `list_issues`, `list_prs`, `create_issue`, `get_file`, `search_code`

---

## Productivity Tools

### Apple Notes (macOS only)

Built-in — no API key. Requires Accessibility permissions in System Settings.

```
"Create a note titled Meeting Notes with today's agenda"
"List my recent notes"
"Search notes for project ideas"
```

Actions: `create`, `list`, `search`

---

### Apple Reminders (macOS only)

Built-in — no API key. Requires Accessibility permissions in System Settings.

```
"Add 'Buy milk' to my Reminders"
"List my pending reminders"
"Show all my reminder lists"
```

Actions: `add`, `list`, `list_lists`

---

### Things 3 (macOS only)

Built-in — requires [Things 3](https://culturedcode.com/things/) to be installed.

```
"Add a task in Things 3: Finish the report by Friday"
"Add 'Call dentist' to my Work project in Things 3"
```

Actions: `add` (title, notes, deadline, list, tags)

---

### Obsidian

```bash
OBSIDIAN_API_KEY=...      # From Local REST API plugin settings
OBSIDIAN_PORT=27123       # Optional, default: 27123
```

Install the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin in Obsidian first.

```
"Search my Obsidian vault for meeting notes"
"Read the note at Projects/HyperClaw.md"
"Create a new note: Daily/2025-03-07.md"
```

Actions: `search`, `read`, `create`

---

### Bear Notes (macOS only)

Built-in — requires [Bear](https://bear.app/) to be installed.

```
"Create a Bear note titled 'Project Ideas'"
"Search Bear for React"
```

Actions: `create`, `search`

---

### Trello

```bash
TRELLO_API_KEY=...    # From trello.com/app-key
TRELLO_TOKEN=...      # From trello.com/app-key (authorize)
```

```
"List my Trello boards"
"Show cards in the 'In Progress' list"
"Add a card: Fix login bug to the Backlog"
"Move card abc123 to Done"
```

Actions: `list_boards`, `list_lists`, `list_cards`, `add_card`, `move_card`

---

## Music & Audio

### Sonos

```bash
SONOS_IP=192.168.1.x    # Your Sonos speaker's local IP
```

```
"Play music on Sonos"
"Pause Sonos"
"Next track on Sonos"
"Set Sonos volume to 40"
"What's playing on Sonos?"
```

Actions: `play`, `pause`, `next`, `previous`, `volume`, `info`

Uses direct UPnP/SOAP on port 1400 — no cloud account needed.

---

### Music Search (Shazam-style)

Free — no API key. Uses [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/).

```
"Search for songs by Daft Punk"
"Find the album Random Access Memories"
"Search for artist The Weeknd"
```

Actions: `search` (query, type: musicTrack/album/musicArtist, limit)

> Note: This searches a music catalog — it does not identify songs from audio. For audio recognition you would need a third-party Shazam API key.

---

## Smart Home

### Philips Hue

```bash
HUE_BRIDGE_IP=192.168.1.x    # Your Hue bridge local IP
HUE_USERNAME=...              # Bridge username (see setup below)
```

**Getting your bridge username:**
```bash
# 1. Press the bridge button
# 2. POST to http://{bridge-ip}/api with body {"devicetype":"hyperclaw"}
# 3. Copy the "username" from the response
```

```
"List my Hue lights"
"Turn on light 3"
"Turn off all lights"
"Set bedroom light to 50% brightness"
"Change the living room light to blue"
```

Actions: `list_lights`, `turn_on`, `turn_off`, `brightness` (0-254), `color` (hue 0-65535)

Use `lightId: "all"` to affect all lights at once.

---

### 8Sleep

```bash
EIGHTSLEEP_EMAIL=...
EIGHTSLEEP_PASSWORD=...
```

```
"What's my 8Sleep temperature?"
"Set my 8Sleep to level 20 on the left side"
"Set 8Sleep right side to -10"
```

Actions: `get_status`, `set_temperature` (level -100 to 100, side: left/right/solo)

> Uses the unofficial 8Sleep client API. May break if 8Sleep changes their API.

---

## Security

### 1Password

```bash
OP_SERVICE_ACCOUNT_TOKEN=ops_...    # From 1password.com/developer
```

Also requires the [`op` CLI](https://developer.1password.com/docs/cli/get-started/) to be installed:

```bash
# macOS
brew install 1password-cli

# Linux
# Download from https://developer.1password.com/docs/cli/get-started/
```

```
"Get my GitHub password from 1Password"
"List all items in my Work vault"
"Get the API key for Stripe from 1Password"
```

Actions: `get_item` (item, vault, fields), `list_items` (vault)

Default fields returned: `username`, `password`. Specify others with `fields: "url,notes"`.

---

## Messaging

### iMessage (macOS only)

Built-in — no API key. Requires:
- Full Disk Access for Terminal/your shell in System Settings → Privacy
- Accessibility permissions

```
"Send an iMessage to +30 210 1234567: I'll be late"
"List my recent iMessage conversations"
```

Actions: `send` (to, message), `list_conversations` (limit)

> This uses the legacy AppleScript bridge to Messages.app. For a more reliable iMessage integration, use the [BlueBubbles](docs/imessage-native.md) channel instead.

---

## Environment Variables Summary

| Variable | Tool | Required |
|----------|------|----------|
| `OPENAI_API_KEY` | Image Gen (DALL-E 3) | Optional |
| `STABILITY_API_KEY` | Image Gen (Stability AI) | Optional |
| `GIPHY_API_KEY` | GIF Search | Optional |
| `TENOR_API_KEY` | GIF Search | Optional |
| `SPOTIFY_CLIENT_ID` | Spotify | Required |
| `SPOTIFY_CLIENT_SECRET` | Spotify | Required |
| `SPOTIFY_REFRESH_TOKEN` | Spotify | Required |
| `HA_URL` | Home Assistant | Required |
| `HA_TOKEN` | Home Assistant | Required |
| `GITHUB_TOKEN` | GitHub | Required |
| `OBSIDIAN_API_KEY` | Obsidian | Required |
| `OBSIDIAN_PORT` | Obsidian | Optional (default: 27123) |
| `TRELLO_API_KEY` | Trello | Required |
| `TRELLO_TOKEN` | Trello | Required |
| `SONOS_IP` | Sonos | Required |
| `HUE_BRIDGE_IP` | Philips Hue | Required |
| `HUE_USERNAME` | Philips Hue | Required |
| `EIGHTSLEEP_EMAIL` | 8Sleep | Required |
| `EIGHTSLEEP_PASSWORD` | 8Sleep | Required |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password | Required |

Add them to `~/.hyperclaw/.env` or your shell profile.

---

<div align="center">

[← Zalo](zalo.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [MCP →](mcp.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>