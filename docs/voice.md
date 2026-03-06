# Voice — Talk Mode & Voice Wake

## Talk Mode (ElevenLabs TTS)

Voice responses instead of text only.

1. Create an account at [elevenlabs.io](https://elevenlabs.io)
2. Add API key to config or set `ELEVENLABS_API_KEY`
3. WebSocket: send `talk:enable` to activate Talk Mode
4. Responses also arrive as `chat:audio` (base64 MP3)

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

REST: `POST /api/v1/tts` with body `{ "text": "…" }` returns `{ "format": "mp3", "data": "base64…" }`.

---

## Voice Wake — PTT & Always-on

- **Push-to-talk:** Press Start, speak, press Stop
- **Always-on (continuous):** Stay in continuous mode — listening restarts automatically after each utterance

Supported in the macOS menu bar (Voice Wake window) and on iOS/Android (Voice tab).

### Wake word

The wake word is set in the wizard (`hyperclaw onboard`) or in config:

```json
{
  "identity": {
    "agentName": "Hyper",
    "wakeWord": "Hey Hyper"
  }
}
```

`hyperclaw voice` uses the wake word from config if `-w` / `--wake-word` is not passed. Alternative: use [Porcupine](https://picovoice.ai/docs/porcupine/) (Picovoice) for real hardware wake-word detection.
