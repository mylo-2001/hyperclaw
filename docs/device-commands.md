# Device Commands — pc-access tools

Εργαλεία συσκευής που δίνει το HyperClaw στον agent όταν `pcAccess.enabled = true`.

## Υποστηριζόμενα

| Εργαλείο | Περιγραφή | Πλατφόρμα |
|----------|-----------|-----------|
| `camera_capture` | Φωτογραφία από webcam | macOS (imagesnap/ffmpeg), Linux (ffmpeg) |
| `screen_record` | Εγγραφή οθόνης (duration σε sec) | macOS (screencapture -V) |
| `contacts_list` | Λίστα επαφών | macOS (Contacts.app) |
| `calendar_events` | Προσεχείς εκδηλώσεις ημερολογίου | macOS (icalBuddy ή Calendar.app) |
| `photos_recent` | Πρόσφατες φωτογραφίες | macOS (Photos Library + mdfind) |
| `app_updates` | Έλεγχος ενημερώσεων (brew, mas) | macOS/Linux |
| `screenshot` | Στιγμιότυπο οθόνης | macOS, Linux |
| `clipboard` | Ανάγνωση/εγγραφή clipboard | macOS, Linux, Windows |
| `open` | Άνοιγμα app/URL/file | Όλες |
| `notify` | Desktop notification | macOS, Linux |

## Προαπαιτούμενα

- **Camera:** `brew install imagesnap` ή `ffmpeg`
- **Calendar (πλούσια έξοδος):** `brew install ical-buddy`
- **App updates (Mac App Store):** `brew install mas`

## SMS

Το SMS send/receive γίνεται μέσω του **SMS channel** (Twilio). Ο agent στέλνει μηνύματα μέσω του channel, όχι μέσω pc-access tool.
