# Deployment Guide

## Docker

### Production gateway

```bash
docker compose up -d gateway
```

Port 18789 will be exposed. Configure webhooks to point at your public URL (e.g. `https://your-domain.com/webhook/telegram`).

### Sandbox mode

Run the sandboxed agent (no PC tools, no host fs access):

```bash
docker compose --profile sandbox up -d sandbox
```

### Gateway with browser tools (Puppeteer)

```bash
docker compose --profile browser up -d gateway-browser
```

Uses port 18790 by default (to avoid conflict with the main gateway).

### Full stack

```bash
docker compose up -d
```

Runs the main gateway. Add `--profile sandbox` or `--profile browser` to include those services.

## Fly.io

See `fly.toml`. Deploy with:

```bash
fly deploy
```

Set secrets: `fly secrets set OPENROUTER_API_KEY=xxx` etc.

## Render

See `render.yaml`. Connect the repo and deploy; configure env vars in the dashboard.

## Environment

- `HYPERCLAW_PORT` — port (default 18789)
- `HYPERCLAW_BIND` — bind address (default 127.0.0.1; use 0.0.0.0 for Docker)
- `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` — model provider
- Channel tokens: `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`, etc.

## Data persistence

Mount `~/.hyperclaw` (or `$HYPERCLAW_DIR`) for config, credentials, and channel state.
