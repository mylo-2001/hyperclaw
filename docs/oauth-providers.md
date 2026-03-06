# OAuth for AI providers

Αντί για API key μπορείς να χρησιμοποιήσεις OAuth (access token + refresh).

## Ρύθμιση

1. **Αρχείο token** — `~/.hyperclaw/oauth-<providerId>.json`:

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

Αν δεν δώσεις `oauthTokenPath`, χρησιμοποιείται αυτόματα `~/.hyperclaw/oauth-<providerId>.json`.

## Πλήρες OAuth flow (browser)

```bash
# Δημιουργία OAuth client: https://console.cloud.google.com/apis/credentials
export GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"   # optional για PKCE

hyperclaw auth oauth google
```

Ανοίγει browser, ολοκληρώνεις consent, τα tokens αποθηκεύονται αυτόματα.

## Χειροκίνητη αποθήκευση tokens (oauth-set)

```bash
hyperclaw auth oauth-set google --token "ya29.xxx" --refresh "1//xxx" --expires-in 3600 --token-url "https://oauth2.googleapis.com/token"
```

Μετά ρύθμισε στο hyperclaw.json: `"authType": "oauth"`, `"providerId": "google"`.

## Refresh

Όταν το `expires_at` έχει λήξει και υπάρχει `refresh_token` και `token_url`, το HyperClaw κάνει αυτόματα POST για νέο `access_token` και ενημερώνει το αρχείο.

## Υποστηριζόμενα

- **Google** — `hyperclaw auth oauth google`, `token_url`: `https://oauth2.googleapis.com/token`
- **Google Gmail** — `hyperclaw auth oauth google-gmail`, για Gmail Pub/Sub watch (ίδια credentials)
- **Microsoft/Azure** — `hyperclaw auth oauth microsoft`, για Azure OpenAI/Azure AD
- Άλλα providers: όρισε `token_url` στο token file αν έχουν refresh endpoint.

## Anthropic / OpenAI

- **API keys** — `hyperclaw auth add anthropic` ή `hyperclaw auth add openai` (default)
- **Anthropic setup token** (Claude Pro/Max) — `hyperclaw auth setup-token anthropic` (paste από `claude setup-token`)
- **OpenAI** — μόνο API keys, δεν υπάρχει OAuth για API
