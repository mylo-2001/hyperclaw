# Gmail Pub/Sub — Real-time email triggers

Instead of IMAP polling, Gmail Pub/Sub gives you real-time notifications when new mail arrives.

## Setup

1. **Google Cloud Console**
   - Create a project
   - Enable Gmail API and Cloud Pub/Sub API
   - Create a Pub/Sub topic (e.g. `gmail-push`)
   - Grant publish rights to `gmail-api-push@system.gserviceaccount.com`

2. **Push subscription**
   - Create a **Push** type subscription
   - Endpoint URL: `https://your-server/webhook/gmail-pubsub`
   - Your server must be publicly accessible (ngrok, Tailscale Funnel, etc.)

3. **OAuth + Gmail watch**
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export GOOGLE_OAUTH_CLIENT_SECRET="your-secret"
   hyperclaw auth oauth google-gmail
   hyperclaw gmail watch-setup -t projects/YOUR_PROJECT/topics/gmail-push
   ```

4. **HyperClaw**
   - Enable the `email` channel (IMAP + SMTP as usual)
   - When Pub/Sub sends a push to `/webhook/gmail-pubsub`, the email connector does an **immediate poll**

## Note

The email connector uses **IMAP** for fetching. Gmail Pub/Sub simply signals "new mail arrived" — then IMAP poll fetches it.
