<a name="top"></a>

# Roadmap

<div align="center">

[🏠 Main README](README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>

---

> This roadmap outlines what's been built and what's coming next.  
> Items marked 🔄 are actively in development. Items marked 📅 are planned but not yet started.  
> Want to contribute to a planned feature? See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## ✅ Shipped (v5.x)

### Core
- [x] One-command install + interactive onboard wizard (`hyperclaw onboard`)
- [x] Config hot-reload — changes apply without daemon restart
- [x] `hyperclaw dashboard` — TUI with live status, channels, skills, logs
- [x] Daemon management (Windows Task Scheduler / macOS LaunchAgent / Linux systemd)
- [x] Security audit (`hyperclaw security --fix`) with auto-remediation
- [x] DM allowlist / pairing — no strangers by default

### Channels (28+)
- [x] Telegram, Discord, WhatsApp (Meta Cloud API + Baileys)
- [x] Signal, Matrix, Mattermost, Microsoft Teams
- [x] Slack, Twitch, Google Chat
- [x] Nostr, Tlon/Urbit, Zalo, LINE
- [x] Nextcloud Talk, Synology Chat, Feishu/Lark
- [x] iMessage (via BlueBubbles), SMS

### AI Providers (20+)
- [x] OpenAI, Anthropic, Google Gemini
- [x] xAI Grok, Mistral, DeepSeek, Perplexity
- [x] Groq, MiniMax, Moonshot/Kimi, Qwen, Z.AI
- [x] HuggingFace, Ollama, LM Studio (local models)
- [x] OpenRouter, LiteLLM, Cloudflare AI Gateway
- [x] GitHub Copilot, Custom OpenAI-compatible endpoints

### Tools & Integrations
- [x] Weather (Open-Meteo — free, no key)
- [x] Image generation (DALL-E 3, Stability AI)
- [x] Spotify, Home Assistant, GitHub, Trello, Obsidian
- [x] Gmail, Philips Hue, Sonos, 8Sleep, 1Password
- [x] Apple Notes / Reminders / Things 3 / Bear (macOS)
- [x] Browser control, Canvas/A2UI, iMessage
- [x] MCP (Model Context Protocol) — custom tool servers

### Security & Advanced
- [x] Docker sandboxing for agent tools
- [x] OSINT / Ethical hacking mode (`hyperclaw osint`)
- [x] Responsible disclosure program (SECURITY.md)
- [x] `trustedProxies` for nginx/Caddy/Cloudflare deployments
- [x] `session.dmScope` per-channel DM isolation
- [x] Voice transcription (Google Gemini + OpenAI Whisper)

### Apps
- [x] macOS companion app
- [x] macOS menu-bar app
- [x] iOS companion app
- [x] Android companion app

---

## 🔄 In Progress

- [ ] **Web UI** — browser-based dashboard (alternative to TUI)
- [ ] **Skill marketplace** — `hyperclaw hub` with community skills
- [ ] **RAG (Retrieval-Augmented Generation)** — local document indexing
- [ ] **Multi-user mode** — multiple users on same instance with separate contexts

---

## 📅 Planned

### Short-term (next release)
- [ ] **Voice-first mode** — always-on microphone, wake-word detection
- [ ] **Scheduled skills** — cron-like task runner built into the agent
- [ ] **Telegram inline mode** — use HyperClaw directly inside any Telegram chat
- [ ] **Encrypted config** — `~/.hyperclaw/hyperclaw.json` at-rest encryption

### Medium-term
- [ ] **Multi-agent collaboration** — multiple HyperClaw instances talking to each other
- [ ] **One-click cloud deploy** — Railway / Render / Fly.io deploy button
- [ ] **Plugin SDK** — stable API for third-party channel/tool plugins
- [ ] **Memory V2** — semantic search over conversation history (vector DB)
- [ ] **Fine-tuned HyperClaw model** — open-weights model trained on agent tasks

### Long-term
- [ ] **HyperClaw Cloud** (optional) — hosted relay for channels that need a public endpoint
- [ ] **Mobile-native agent** — full agent running on-device on iOS/Android
- [ ] **Enterprise features** — SSO, audit logs, team management

---

## 💡 Community Suggestions

Have an idea? [Open a Discussion](https://github.com/mylo-2001/hyperclaw/discussions) or [file a Feature Request](https://github.com/mylo-2001/hyperclaw/issues/new/choose).

---

<div align="center">

[🏠 Main README](README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>
