# Voice — Talk Mode & Voice Wake

## Talk Mode (ElevenLabs TTS)

Φωνητικές απαντήσεις αντί για μόνο κείμενο.

1. Δημιουργία λογαριασμού στο [elevenlabs.io](https://elevenlabs.io)
2. API key στο config ή `ELEVENLABS_API_KEY`
3. WebSocket: στείλε `talk:enable` για να ενεργοποιήσεις Talk Mode
4. Οι απαντήσεις έρχονται και ως `chat:audio` (base64 MP3)

Config (`hyperclaw.json`):

```json
{
  "talkMode": {
    "apiKey": "…",
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "modelId": "eleven_multilingual_v2"
  }
}
```

REST: `POST /api/v1/tts` με body `{ "text": "…" }` επιστρέφει `{ "format": "mp3", "data": "base64…" }`.

---

## Voice Wake — PTT & Always-on

- **Push-to-talk:** Πάτα Start, μίλα, πάτα Stop
- **Always-on (continuous):** Μείνε σε λειτουργία continuous — μετά κάθε προφορά ξαναξεκινά η ακρόαση αυτόματα

Υποστηρίζεται στο macOS menu bar (Voice Wake window) και σε iOS/Android (Voice tab).

### Wake word

Το wake word ορίζεται στο wizard (`hyperclaw init` / `hyperclaw onboard`) ή στο config:

```json
{
  "identity": {
    "agentName": "Hyper",
    "wakeWord": "Hey Hyper"
  }
}
```

Το `hyperclaw voice` χρησιμοποιεί το wake word από το config αν δεν περαστεί `-w` / `--wake-word`. Εναλλακτικά: χρήση [Porcupine](https://picovoice.ai/docs/porcupine/) (Picovoice) για πραγματική wake-word ακρόαση.
