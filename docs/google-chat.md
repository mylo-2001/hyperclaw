# Google Chat — HyperClaw Setup Guide

> **Status:** ready for DMs + Spaces via Google Chat API webhooks (HTTP only).

---

## Prerequisites

- A Google account with access to [Google Cloud Console](https://console.cloud.google.com/)
- A running HyperClaw gateway with a **public HTTPS endpoint** on the `/googlechat` path
- (See [Public URL options](#public-url-webhook-only) below if you don't have one yet)

---

## Step 1 — Create a Google Cloud project & enable the API

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a new project (e.g. `hyperclaw-chat`).
2. In the left menu go to **APIs & Services → Library**.
3. Search for **Google Chat API** and click **Enable**.

---

## Step 2 — Create a Service Account & download JSON key

1. Go to **APIs & Services → Credentials → Create Credentials → Service Account**.
2. Name it (e.g. `hyperclaw-chat`). Leave permissions and principals blank → **Done**.
3. In the service account list, click the account you just created.
4. Go to the **Keys** tab → **Add Key → Create new key → JSON → Create**.
5. Save the downloaded JSON file on your gateway host:

```bash
mkdir -p ~/.hyperclaw
mv ~/Downloads/your-project-*.json ~/.hyperclaw/googlechat-service-account.json
chmod 600 ~/.hyperclaw/googlechat-service-account.json
```

---

## Step 3 — Configure the Google Chat app

1. In Google Cloud Console go to **APIs & Services → Google Chat API → Configuration**.
2. Fill in **Application info:**
   - App name: e.g. `HyperClaw`
   - Avatar URL: e.g. `https://raw.githubusercontent.com/mylo-2001/hyperclaw/main/apps/web/public/logo.png`
   - Description: e.g. `Personal AI Assistant`
3. Enable **Interactive features**.
4. Under **Functionality**, check **Join spaces and group conversations**.
5. Under **Connection settings**, select **HTTP endpoint URL**.
6. Under **Triggers**, select **Use a common HTTP endpoint URL for all triggers** and set it to:

```
https://<your-gateway-public-url>/googlechat
```

> Run `hyperclaw status` to find your gateway's public URL.

7. Under **Visibility**, check **Make this Chat app available to specific people and groups in \<Your Domain\>**.  
   Enter your email address (e.g. `user@example.com`).
8. Click **Save**.
9. After saving, refresh the page. Find **App status** and change it to **Live - available to users**. Click **Save** again.

---

## Step 4 — Configure HyperClaw

Add to `~/.hyperclaw/hyperclaw.json`:

```json
{
  "channels": {
    "googlechat": {
      "enabled": true,
      "serviceAccountFile": "/path/to/googlechat-service-account.json",
      "audienceType": "app-url",
      "audience": "https://your-gateway-public-url/googlechat",
      "webhookPath": "/googlechat",
      "botUser": "users/1234567890",
      "dm": {
        "policy": "pairing",
        "allowFrom": ["users/1234567890"]
      },
      "groupPolicy": "allowlist",
      "groups": {
        "spaces/AAAA": {
          "allow": true,
          "requireMention": true,
          "users": ["users/1234567890"],
          "systemPrompt": "Short answers only."
        }
      },
      "actions": { "reactions": true },
      "typingIndicator": "message",
      "mediaMaxMb": 20
    }
  }
}
```

Or using environment variables:

```bash
GOOGLE_CHAT_SERVICE_ACCOUNT_FILE=/path/to/service-account.json
```

Or inline in config:

```json
{
  "channels": {
    "googlechat": {
      "serviceAccountRef": { "source": "file", "provider": "filemain", "id": "/channels/googlechat/serviceAccount" }
    }
  }
}
```

### Audience types

| `audienceType` | `audience` value |
|----------------|-----------------|
| `"app-url"` | Your HTTPS webhook URL (e.g. `https://gateway.example.com/googlechat`) |
| `"project-number"` | Your Cloud project number (numeric string) |

---

## Step 5 — Add the bot to Google Chat

Once the gateway is running and your email is added to the visibility list:

1. Go to [chat.google.com](https://chat.google.com).
2. Click the **+** icon next to **Direct Messages**.
3. In the search bar, type the **App name** you configured (e.g. `HyperClaw`).
   > The bot will **not** appear in the Marketplace browse list — it is a private app. Search by name.
4. Select your bot from the results and click **Chat**.
5. Send **Hello** to trigger the assistant.

For group **Spaces**: add the app via **Space settings → Apps & integrations → Add apps**.

---

## Public URL (webhook-only)

Google Chat webhooks require a public HTTPS endpoint.  
**Only expose `/googlechat`** — keep the dashboard and other endpoints private.

### Option A — Tailscale Funnel (recommended)

```bash
# Check which IP your gateway is bound to
hyperclaw status

# Expose only the webhook path publicly
tailscale funnel --bg --set-path /googlechat http://127.0.0.1:18789/googlechat

# Keep dashboard tailnet-only
tailscale serve --bg --https 8443 http://127.0.0.1:18789

# Verify
tailscale funnel status
```

Your public webhook URL: `https://<node-name>.<tailnet>.ts.net/googlechat`  
Your private dashboard: `https://<node-name>.<tailnet>.ts.net:8443/`

> To remove later: `tailscale funnel reset && tailscale serve reset`

### Option B — Caddy reverse proxy

```caddy
your-domain.com {
    reverse_proxy /googlechat* localhost:18789
}
```

All other paths return 404 — only `/googlechat` is routed.

### Option C — Cloudflare Tunnel

Configure ingress rules:

```yaml
ingress:
  - hostname: your-domain.com
    path: /googlechat
    service: http://localhost:18789/googlechat
  - service: http_status:404
```

---

## How it works

1. Google Chat sends webhook POSTs to your gateway's `/googlechat` endpoint.
2. Each request includes `Authorization: Bearer <token>` — verified before parsing the body.
3. Messages are routed by space type:
   - DMs → session key `agent:<agentId>:googlechat:dm:<spaceId>`
   - Spaces → session key `agent:<agentId>:googlechat:group:<spaceId>`
4. DM access is `pairing` by default. Unknown senders receive a pairing code → approve with:
   ```bash
   hyperclaw pairing approve googlechat <code>
   ```
5. Group spaces require `@HyperClaw` mention by default (`requireMention: true`).

---

## Targets (for allowlists)

| Target type | Format |
|-------------|--------|
| Direct messages | `users/<userId>` (recommended) |
| Spaces | `spaces/<spaceId>` |

> `users/<email>` format is deprecated — use `users/<userId>` instead.  
> Email matching is only enabled when `channels.googlechat.dangerouslyAllowNameMatching: true`.

---

## Config reference highlights

```json
{
  "channels": {
    "googlechat": {
      "enabled": true,
      "serviceAccountFile": "/path/to/service-account.json",
      "audienceType": "app-url",
      "audience": "https://gateway.example.com/googlechat",
      "webhookPath": "/googlechat",
      "botUser": "users/1234567890",
      "dm": {
        "policy": "pairing",
        "allowFrom": ["users/1234567890"]
      },
      "groupPolicy": "allowlist",
      "groups": {
        "spaces/AAAA": {
          "allow": true,
          "requireMention": true,
          "users": ["users/1234567890"],
          "systemPrompt": "Short answers only."
        }
      },
      "actions": { "reactions": true },
      "typingIndicator": "message",
      "mediaMaxMb": 20,
      "dangerouslyAllowNameMatching": false
    }
  }
}
```

---

## Troubleshooting

### 405 Method Not Allowed

Google Cloud Logs Explorer shows `status code: 405`:

1. Verify channel config exists:
   ```bash
   hyperclaw config get channels.googlechat
   ```
2. Restart the gateway after adding config:
   ```bash
   hyperclaw gateway restart
   ```
3. Check channel status:
   ```bash
   hyperclaw channels status
   # Expected: Google Chat default: enabled, configured, ...
   ```

### No messages arriving

```bash
# Check the gateway webhook probe
hyperclaw channels status --probe

# Follow live logs while sending a test message
hyperclaw logs --follow
```

Common causes:
- Chat app webhook URL doesn't match your public URL
- `audienceType`/`audience` mismatch
- App status not set to "Live"

### Bot not appearing in search

The app is **private** — it will not appear in Marketplace. Search by exact app name.  
Make sure your Google account email is in the **Visibility** list in the Chat app configuration.

### Mention gating blocking replies

Set `botUser` to the app's user resource name. Find it in:
- Google Cloud Console → Chat API → Bot Users
- Or from the first message the bot receives (logged in gateway output)

---

## Reactions

Available via the `reactions` tool when `actions.reactions: true`:

- `emoji` is required when adding a reaction
- `emoji: ""` removes the bot's reactions on that message
- `remove: true` removes just that specific emoji reaction

---

## Related docs

- [Gateway configuration](./configuration.md)
- [Security](./security.md)
- [Tailscale](./tailscale.md)
- [Deployment](./deployment.md)
