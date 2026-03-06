# Device Commands — pc-access tools

Device tools available to the agent when `pcAccess.enabled = true`.

## Supported

| Tool | Description | Platform |
|------|-------------|----------|
| `camera_capture` | Photo from webcam | macOS (imagesnap/ffmpeg), Linux (ffmpeg) |
| `screen_record` | Screen recording (duration in sec) | macOS (screencapture -V) |
| `contacts_list` | List contacts | macOS (Contacts.app) |
| `calendar_events` | Upcoming calendar events | macOS (icalBuddy or Calendar.app) |
| `photos_recent` | Recent photos | macOS (Photos Library + mdfind) |
| `app_updates` | Check updates (brew, mas) | macOS/Linux |
| `screenshot` | Screen snapshot | macOS, Linux |
| `clipboard` | Read/write clipboard | macOS, Linux, Windows |
| `open` | Open app/URL/file | All |
| `notify` | Desktop notification | macOS, Linux |

## Prerequisites

- **Camera:** `brew install imagesnap` or `ffmpeg`
- **Calendar (rich output):** `brew install ical-buddy`
- **App updates (Mac App Store):** `brew install mas`

## SMS

SMS send/receive is done via the **SMS channel** (Twilio). The agent sends messages via the channel, not via a pc-access tool.
