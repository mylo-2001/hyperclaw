<a name="top"></a>

# Changelog

<div align="center">

[🏠 Main README](README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>

---

All notable changes to HyperClaw are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [5.2.1] — 2026-03-06

### Fixed
- `postinstall.js` UTF-8 BOM causing `SyntaxError: Invalid or unexpected token` on Windows
- `../README.md` broken nav link in `SECURITY.md` (now correctly `README.md`)
- Unclosed `<a name="top">` anchor tags in root-level markdown files
- `package-lock.json` regenerated to resolve `isbinaryfile@5.1.0` and `y18n@^5.1.0` CI failures
- macOS CI workflow updated to use `npm ci --ignore-scripts --legacy-peer-deps`

### Added
- Navigation links (Prev / Next / Index / Back to top) in all 54 `.md` documentation files
- Table of Contents with anchor links in `README.md`
- Dashboard screenshot in `README.md`
- Contributors widget + Star History chart in Community section
- `CHANGELOG.md` and `ROADMAP.md`

---

## [5.2.0] — 2026-02-28

### Added
- **MCP (Model Context Protocol)** — full custom MCP server support via `~/.hyperclaw/mcp-servers.json`
- **OSINT / Ethical Hacking mode** — `hyperclaw osint` command with dedicated tool suite
- **Tlon / Urbit integration** — Tlon Groups channel support (`extensions/tlon/`)
- **Google Chat setup guide** — `docs/google-chat.md` with full webhook and bot instructions
- **`trustedProxies` config** — reverse proxy support (nginx, Caddy, Cloudflare)
- **`session.dmScope`** — per-channel DM isolation
- **Config hot-reload** — changes to `~/.hyperclaw/hyperclaw.json` apply without restart
- HuggingFace Inference Providers with repo-style model IDs
- Groq model IDs updated to current production catalog
- Cohere and HuggingFace base URLs corrected

### Fixed
- OpenRouter model slugs updated to verified catalog
- Voice transcription: clarified Google native `generateContent` vs OpenAI Whisper path

---

## [5.1.0] — 2026-02-15

### Added
- `hyperclaw onboard` wizard: step-by-step API key instructions for all 20+ integrations
- Linux/macOS `EACCES` npm permission fix in `README.md`
- Terminal emoji rendering fix guide (Windows CMD, PowerShell, Kali, macOS)
- Daemon vs. foreground mode explanation with architecture diagram
- Windows CMD copy-paste limitation explanation
- Merged `.env.example` — single comprehensive file covering all providers and channels
- `docker-compose.yml` with environment variable examples for AI keys
- GitHub Issue Templates (bug report, feature request, security advisory)

### Fixed
- `fix-init-paths.mjs` — corrected double-patching bug (`require_paths.require_paths...` chains)
- `tsdown` bundler: `[UNRESOLVED_IMPORT]` errors in `src/cli/chat.ts`
- Linux binary execution: added `bin/hyperclaw.js` wrapper with correct Node.js shebang

---

## [5.0.7] — 2026-02-05

### Fixed
- `postinstall.js` Windows compatibility: removed Unix-only `2>/dev/null || true` shell syntax
- Groq model IDs: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` (was incorrect slugs)
- Cohere baseUrl: `https://api.cohere.ai/compatibility/v1` (was `.com`)
- HuggingFace baseUrl: `https://router.huggingface.co/v1`
- OpenRouter models: cleaned to verified subset only

### Changed
- npm publish version bumped to `5.0.7` (previous `5.0.6` already published)

---

## [5.0.0] — 2026-01-20

### Added
- Full monorepo structure (`apps/`, `packages/`, `extensions/`, `docs/`)
- `tsdown` (rolldown-based) bundler replacing previous build system
- 20+ AI providers: xAI Grok, MiniMax, Moonshot/Kimi, Qwen, Z.AI, LiteLLM, Cloudflare AI Gateway, GitHub Copilot, Groq, Mistral, DeepSeek, Perplexity, HuggingFace, Ollama, LM Studio
- 28+ messaging channels including Tlon, Nostr, Zalo, LINE, Feishu/Lark, Synology Chat
- `hyperclaw dashboard` TUI with live status, channel list, and log viewer
- Docker sandboxing for agent tool execution
- Security audit command (`hyperclaw security --fix`)
- DaemonManager: Windows Task Scheduler, macOS LaunchAgent, Linux systemd user service
- Voice transcription: Google Gemini native + OpenAI Whisper

### Changed
- Complete rewrite from v4 codebase
- Configuration moved to `~/.hyperclaw/hyperclaw.json`

---

## [4.0.0] — 2025-12-01

### Added
- Initial public release
- Telegram, Discord, WhatsApp, Signal, iMessage channels
- OpenAI, Anthropic, Ollama AI providers
- Basic skill system
- `hyperclaw onboard` wizard

---

<div align="center">

[🏠 Main README](README.md) &nbsp;•&nbsp; [📚 Docs](docs/README.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>
