# Microsoft Teams — HyperClaw

Talk to HyperClaw via Teams DMs and chats using the Bot Framework webhook.

**Updated:** 2026-03  
**Status:** Text + DM supported via Azure Bot. Channel/group file attachments and RSC require additional setup (see Limitations).

---

## Extension

Microsoft Teams ships as an extension in `extensions/msteams`. It is bundled with the core install — no separate plugin install needed. Enable it by adding `msteams` to `gateway.enabledChannels` and configuring credentials.

---

## Quick setup

1. **Create an Azure Bot** (see [Azure Bot Setup](#azure-bot-setup))
2. **Configure HyperClaw** with App ID and App Password
3. **Expose the webhook** — Teams sends to `https://<host>:<port>/webhook/msteams`
4. **Install the Teams app** and start the gateway

### Minimal config

```json
{
  "gateway": {
    "enabledChannels": ["msteams"]
  },
  "channels": {
    "msteams": {
      "appId": "<APP_ID>",
      "appPassword": "<APP_PASSWORD>",
      "dmPolicy": "pairing",
      "allowFrom": []
    }
  }
}
```

Or use environment variables:
- `MSTEAMS_APP_ID`
- `MSTEAMS_APP_PASSWORD`

---

## Azure Bot Setup

### Step 1: Create Azure Bot

1. Go to [Create Azure Bot](https://portal.azure.com/#create/Microsoft.AzureBot)
2. **Basics:**
   - Bot handle: e.g. `hyperclaw-msteams` (must be unique)
   - Subscription, Resource group
   - Pricing tier: **Free** for dev/testing
   - Type of App: **Single Tenant** (recommended)
   - Creation type: **Create new Microsoft App ID**
3. Click **Review + create** → **Create**

> **Note:** Creation of new multi-tenant bots was deprecated after 2025-07-31. Use Single Tenant for new bots.

### Step 2: Get credentials

1. Go to your Azure Bot resource → **Configuration**
2. Copy **Microsoft App ID** → this is `appId`
3. Click **Manage** (next to App ID) → go to App Registration  
   - **Certificates & secrets** → **New client secret** → copy the **Value** → this is `appPassword`
4. In App Registration → **Overview** → copy **Directory (tenant) ID** → this is `tenantId` (for single-tenant)

### Step 3: Configure Messaging Endpoint

In Azure Bot → **Configuration**:
- Set **Messaging endpoint** to your webhook URL:
  - Production: `https://your-domain.com/webhook/msteams`
  - Local dev: use a tunnel (see [Local Development](#local-development))

### Step 4: Enable Teams Channel

In Azure Bot → **Channels**:
- Click **Microsoft Teams** → **Configure** → **Save**
- Accept the Terms of Service

---

## Local Development (Tunneling)

Teams cannot reach localhost. Use a tunnel:

**Option A: ngrok**
```bash
ngrok http 18789
# Set messaging endpoint: https://abc123.ngrok.io/webhook/msteams
```

**Option B: Tailscale Funnel**
```bash
tailscale funnel 18789
# Use your Tailscale funnel URL: https://<host>/webhook/msteams
```

---

## Configuration

| Key | Description |
|-----|-------------|
| `channels.msteams.appId` | Azure Bot App ID |
| `channels.msteams.appPassword` | Client secret (App password) |
| `channels.msteams.dmPolicy` | `pairing` \| `allowlist` \| `open` \| `none` |
| `channels.msteams.allowFrom` | AAD object IDs for allowlist (when dmPolicy is allowlist) |

### DM Policy

- **`pairing`** (default): Unknown senders get a 6-digit code. Approve with:  
  `hyperclaw pairing approve msteams <CODE>`
- **`allowlist`**: Only users in `allowFrom` can message. Use AAD object IDs.
- **`open`**: Any user can message (use with caution).
- **`none`**: Block all DMs.

---

## How it works

1. Add `msteams` to `gateway.enabledChannels`
2. Configure `appId` and `appPassword`
3. Set Azure Bot Messaging endpoint to `https://<your-host>/webhook/msteams`
4. Build and install a Teams app that references your bot
5. Start the gateway — the Teams connector starts when credentials exist

The gateway receives Bot Framework activities at `/webhook/msteams` and forwards them to the connector.

---

## Teams App Manifest

Create a minimal manifest for your bot:

1. **manifest.json** — include bot entry with `botId` = your App ID
2. **outline.png** (32×32) and **color.png** (192×192)
3. Zip: `manifest.json`, `outline.png`, `color.png`
4. In Teams: **Apps** → **Manage your apps** → **Upload a custom app**

Example manifest:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.23/MicrosoftTeams.schema.json",
  "manifestVersion": "1.23",
  "version": "1.0.0",
  "id": "00000000-0000-0000-0000-000000000000",
  "name": { "short": "HyperClaw" },
  "developer": {
    "name": "Your Org",
    "websiteUrl": "https://example.com",
    "privacyUrl": "https://example.com/privacy",
    "termsOfUseUrl": "https://example.com/terms"
  },
  "description": { "short": "HyperClaw in Teams" },
  "icons": { "outline": "outline.png", "color": "color.png" },
  "accentColor": "#dc2626",
  "bots": [{
    "botId": "<YOUR_APP_ID>",
    "scopes": ["personal", "team", "groupChat"],
    "isNotificationOnly": false,
    "supportsFiles": true
  }],
  "webApplicationInfo": {
    "id": "<YOUR_APP_ID>"
  }
}
```

Replace `<YOUR_APP_ID>` with your Azure Bot App ID.

---

## Limitations (current)

| Feature | Status |
|---------|--------|
| DM text | ✅ Supported |
| DM file attachments | ⚠️ Payload may include HTML stub; full file download may require Graph API |
| Channel/group text | ✅ Via Bot Framework (if bot installed in team) |
| Channel/group files | ❌ Requires SharePoint + Graph permissions |
| RSC permissions | Not configured in default setup |
| Message history | Real-time only (no Graph history) |
| Adaptive Cards / polls | Not yet implemented |

For full channel/group file support and RSC, you would need:
- Microsoft Graph permissions (ChannelMessage.Read.All, Sites.ReadWrite.All, etc.)
- Admin consent
- `sharePointSiteId` for file uploads in groups/channels

---

## Testing

1. **Azure Web Chat**: In Azure Portal → your Bot → **Test in Web Chat** — confirms webhook works
2. **Teams**: Install the app, find the bot, send a DM — check gateway logs for incoming activity

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No responses in Teams | Check gateway logs; verify Messaging endpoint URL |
| 401 Unauthorized | Expected when testing manually without Azure JWT — use Web Chat to test |
| Pairing not working | Run `hyperclaw pairing approve msteams <CODE>` after receiving the code |
| Webhook not reached | Ensure port is exposed; use ngrok/Tailscale for local dev |

---

## References

- [Create Azure Bot](https://portal.azure.com/#create/Microsoft.AzureBot)
- [Teams Developer Portal](https://dev.teams.microsoft.com/)
- [Teams app manifest schema](https://developer.microsoft.com/en-us/json-schemas/teams/v1.23/MicrosoftTeams.schema.json)
- [Bot Framework](https://dev.botframework.com/)
