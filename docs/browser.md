# Browser Control (Puppeteer)
---

<div align="center">

[← Multi-Agent](multi-agent.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Deployment →](deployment.md)

</div>

---

HyperClaw includes `browser_snapshot` and `browser_action` tools for web automation.

## Setup

1. **Install Puppeteer** (optional dependency):

   ```bash
   npm i puppeteer
   ```

2. **Enable in config** (optional — tools work when Puppeteer is available):

   Add to `~/.hyperclaw/hyperclaw.json`:

   ```json
   {
     "browser": { "enabled": true }
   }
   ```

## Tools

### browser_snapshot

Captures the current page: title, URL, main text, and links.

- **url** (optional): Navigate to this URL before capturing. Omit to snapshot the current page.

### browser_action

Perform actions: `click`, `type`, `scroll`, `navigate`.

- **action**: `click` | `type` | `scroll` | `navigate`
- **selector**: CSS selector or link/button text (for click)
- **value**: For `type` — text to type. For `navigate` — URL. For `scroll` — `up` or `down`

## Docker

For Puppeteer in Docker, use the `gateway-browser` image:

```bash
docker compose --profile browser up -d gateway-browser
```

Or build manually:

```bash
docker build -f Dockerfile.browser -t hyperclaw:gateway-browser .
docker run -p 18789:18789 -v ~/.hyperclaw:/root/.hyperclaw hyperclaw:gateway-browser
```

The image includes Chromium; set `PUPPETEER_EXECUTABLE_PATH` if using a custom binary.

## Security

- Browser runs headless; no visible window.
- Sandboxed with `--no-sandbox` only when required (e.g. Docker).
- Use PC access config to limit which sessions can run browser tools.

---

<div align="center">

[← Multi-Agent](multi-agent.md) &nbsp;•&nbsp; [📋 Docs Index](README.md) &nbsp;•&nbsp; [Deployment →](deployment.md)

</div>
<div align="right"><a href="#top">▲ Back to top</a></div>