# Managed Cloud Hosting — HyperClaw

> Cloud deployment and developer API keys for embed-in-any-app.

## Overview

HyperClaw supports **cloud self-deploy** (Fly.io, Render, Docker) and **developer API keys** for third-party integrations. A fully managed SaaS (multi-tenant, hosted instances) is a future direction.

### What's Available Today

| Feature | Status | Description |
|---------|--------|-------------|
| **Cloud deploy** | ✅ | One-command deploy to Fly.io, Render; Docker support |
| **Developer API keys** | ✅ | Create keys for embed / third-party apps; `Authorization: Bearer <key>` |
| **Managed SaaS** | 🔜 | Multi-tenant hosted instances (future) |

## Cloud Deploy

### Fly.io

```bash
hyperclaw deploy --platform fly
# or: fly deploy
```

Set secrets: `fly secrets set OPENROUTER_API_KEY=xxx HYPERCLAW_GATEWAY_TOKEN=xxx`

### Render

1. Push to GitHub and connect repo at [render.com](https://render.com)
2. New Web Service → use `render.yaml`
3. Set env: `OPENROUTER_API_KEY`, `HYPERCLAW_GATEWAY_TOKEN`

### Docker

See [deployment.md](deployment.md) for Docker and docker-compose.

## Developer API Keys

For embed-in-any-app and third-party integrations. Keys allow apps to call the gateway via `Authorization: Bearer <key>`.

### Create a key

```bash
hyperclaw developer-key create -n "My App"
```

Store the key securely. It is shown once.

### List keys

```bash
hyperclaw developer-key list
```

### Revoke a key

```bash
hyperclaw developer-key revoke <key_id>
```

### Using a key

```bash
curl -H "Authorization: Bearer hc_xxx" https://your-gateway.com/api/v1/pi -d '{"jsonrpc":"2.0","method":"send","params":{"message":"Hello"}}'
```

Keys are validated alongside the gateway token. Both grant access to protected endpoints.

## Self-Hosted Today

Until managed SaaS is available:

- **CLI + gateway** — `hyperclaw run` or `hyperclaw daemon start`
- **Tailscale / Funnel** — Expose gateway securely
- **Deployment** — [deployment.md](deployment.md)
