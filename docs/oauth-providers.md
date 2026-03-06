# OAuth for AI providers

Instead of an API key you can use OAuth (access token + refresh).

## Setup

1. **Token file** — `~/.hyperclaw/oauth-<providerId>.json`:

```json
{
  "access_token": "ya29.xxx",
  "refresh_token": "1//xxx",
  "expires_at": 1734567890,
  "token_url": "https://oauth2.googleapis.com/token",
  "client_id": "optional",
  "client_secret": "optional"
}
```

2. **hyperclaw.json**:

```json
{
  "provider": {
    "providerId": "google",
    "modelId": "gemini-1.5-flash",
    "authType": "oauth",
    "oauthTokenPath": "~/.hyperclaw/oauth-google.json"
  }
}
```

If you omit `oauthTokenPath`, the default path `~/.hyperclaw/oauth-<providerId>.json` is used automatically.

## Full OAuth flow (browser)

```bash
# Create OAuth client: https://console.cloud.google.com/apis/credentials
export GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"   # optional for PKCE

hyperclaw auth oauth google
```

Opens browser, complete consent, tokens are saved automatically.

## Manual token save (oauth-set)

```bash
hyperclaw auth oauth-set google --token "ya29.xxx" --refresh "1//xxx" --expires-in 3600 --token-url "https://oauth2.googleapis.com/token"
```

Then set in hyperclaw.json: `"authType": "oauth"`, `"providerId": "google"`.

## Token refresh

When expires_at has expired and refresh_token and token_url are present, HyperClaw automatically POSTs for a new access_token and updates the file.

## Supported

- **Google** — `hyperclaw auth oauth google`, `token_url`: `https://oauth2.googleapis.com/token`
- **Google Gmail** — `hyperclaw auth oauth google-gmail`, for Gmail Pub/Sub watch (same credentials)
- **Microsoft/Azure** — `hyperclaw auth oauth microsoft`, for Azure OpenAI/Azure AD
- Other providers: set token_url in the token file if they have a refresh endpoint.

## Anthropic / OpenAI

- **API keys** — `hyperclaw auth add anthropic` or `hyperclaw auth add openai` (default)
- **Anthropic setup token** (Claude Pro/Max) — `hyperclaw auth setup-token anthropic` (paste from claude setup-token)
- **OpenAI** — API keys only, no OAuth for the API
