# Gmail Pub/Sub — Real-time email triggers

Αντί για IMAP polling, το Gmail Pub/Sub σου δίνει real-time ειδοποιήσεις όταν έρχεται νέο mail.

## Setup

1. **Google Cloud Console**
   - Δημιούργησε project
   - Ενεργοποίησε Gmail API και Cloud Pub/Sub API
   - Δημιούργησε Pub/Sub topic (π.χ. `gmail-push`)
   - Δώσε publish rights στο `gmail-api-push@system.gserviceaccount.com`

2. **Push subscription**
   - Δημιούργησε subscription τύπου **Push**
   - Endpoint URL: `https://your-server/webhook/gmail-pubsub`
   - Το server σου πρέπει να είναι publicly accessible (ngrok, Tailscale Funnel, κ.λπ.)

3. **OAuth + Gmail watch**
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export GOOGLE_OAUTH_CLIENT_SECRET="your-secret"
   hyperclaw auth oauth google-gmail
   hyperclaw gmail watch-setup -t projects/YOUR_PROJECT/topics/gmail-push
   ```

4. **HyperClaw**
   - Ενεργοποίησε το `email` channel (IMAP + SMTP όπως πριν)
   - Όταν το Pub/Sub στέλνει push στο `/webhook/gmail-pubsub`, το email connector κάνει **άμεσο poll**

## Σημείωση

Το email connector χρησιμοποιεί **IMAP** για fetch. Το Gmail Pub/Sub απλά λέει "νέο mail" — μετά γίνεται IMAP poll.
