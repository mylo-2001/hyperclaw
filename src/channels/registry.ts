import chalk from 'chalk';
import os from 'os';

export type ChannelStatus = 'configured' | 'recommended' | 'available' | 'unavailable';

export interface ChannelDef {
  id: string;
  name: string;
  emoji: string;
  requiresGateway: boolean;
  supportsDM: boolean;
  platforms: ('linux' | 'darwin' | 'win32' | 'all')[];
  tokenLabel?: string;
  tokenHint?: string;
  /** Step-by-step setup guide shown before token prompt */
  setupSteps?: string[];
  extraFields?: { name: string; label: string; hint?: string; required: boolean }[];
  npmPackage?: string;
  status?: ChannelStatus;
  notes?: string;
}

export const CHANNELS: ChannelDef[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    emoji: '✈️',
    requiresGateway: false,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Telegram Bot Token',
    tokenHint: 'Get from @BotFather → /newbot',
    setupSteps: [
      '1. Άνοιξε το Telegram και ψάξε για @BotFather (είναι ο επίσημος bot για δημιουργία bots).',
      '2. Ξεκίνα συνομιλία με /start και πληκτρολόγησε /newbot για να δημιουργήσεις νέο bot.',
      '3. Δώσε ένα όνομα στο bot (π.χ. "My HyperClaw Bot") και μετά ένα username που να τελειώνει σε "bot" (π.χ. my_hyperclaw_bot).',
      '4. Ο @BotFather θα σου στείλει το Bot Token — μια συμβολοσειρά που ξεκινά με 7xxxxxx:AAH... Κράτα το μυστικό!',
      '5. Αντιγράψε το token και κολλήστε το παρακάτω.',
      '',
      '  🔗 t.me/BotFather'
    ],
    status: 'recommended',
    npmPackage: 'node-telegram-bot-api'
  },
  {
    id: 'discord',
    name: 'Discord',
    emoji: '🎮',
    requiresGateway: false,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Discord Bot Token',
    tokenHint: 'discord.com/developers/applications',
    setupSteps: [
      '1. Πήγαινε στο Discord Developer Portal: https://discord.com/developers/applications',
      '2. Κλικ "New Application", δώσε όνομα και δημιούργησέ το.',
      '3. Στο μενού αριστερά: Bot → Add Bot.',
      '4. Κλικ "Reset Token" και αντιγράψε το token (Κράτα το μυστικό!).',
      '5. Στο Settings → OAuth2 → General, αντιγράψε το Application ID (Client ID).',
      '6. Προαιρετικά: Για να προσθέσεις το bot σε server, Bot → OAuth2 → URL Generator, scope: bot.',
      '',
      '  🔗 discord.com/developers/applications'
    ],
    extraFields: [{ name: 'clientId', label: 'Client ID (Application ID)', hint: 'Από OAuth2 → General', required: true }],
    status: 'recommended',
    npmPackage: 'discord.js'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp (Cloud API)',
    emoji: '📱',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'WhatsApp Business API key',
    tokenHint: 'business.whatsapp.com',
    setupSteps: [
      '1. Πήγαινε στο Meta for Developers: https://developers.facebook.com/',
      '2. My Apps → Create App → Business type.',
      '3. Προσθήκη προϊόντος: WhatsApp → Get started.',
      '4. Στο WhatsApp → API Setup: αντιγράψε το Temporary access token ή δημιούργησε μόνιμο.',
      '5. Χρειάζεσαι επίσης Phone Number ID και WhatsApp Business Account ID.',
      '',
      '  🔗 developers.facebook.com — business.whatsapp.com'
    ],
    status: 'available',
    npmPackage: undefined
  },
  {
    id: 'whatsapp-baileys',
    name: 'WhatsApp (Baileys)',
    emoji: '📲',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    setupSteps: [
      '1. Δεν χρειάζεσαι Meta Business API — χρησιμοποιεί WhatsApp Web.',
      '2. Βεβαιώσου ότι έχεις εγκατεστημένο: npm install @whiskeysockets/baileys',
      '3. Ξεκίνα το gateway. Στην πρώτη σύνδεση θα εμφανιστεί QR code.',
      '4. Σκάνε το QR με το κινητό σου (WhatsApp → Linked Devices → Link a device).',
      '5. Μετά τη σύνδεση το session αποθηκεύεται — δεν χρειάζεται ξανά QR.',
      '',
      '  📖 docs: github.com/WhiskeySockets/Baileys'
    ],
    status: 'available',
    notes: 'WhatsApp Web via Baileys — no Meta Business. Scan QR on first run.',
    npmPackage: '@whiskeysockets/baileys'
  },
  {
    id: 'slack',
    name: 'Slack',
    emoji: '💼',
    requiresGateway: false,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Slack Bot Token (xoxb-...)',
    extraFields: [{ name: 'signingSecret', label: 'Signing Secret', required: true }],
    setupSteps: [
      '1. Πήγαινε στο api.slack.com/apps → Create New App → From scratch.',
      '2. Δώσε όνομα και διάλεξε workspace.',
      '3. OAuth & Permissions: Προσθήκη Bot Token Scopes (chat:write, users:read, im:read, im:history κ.λπ.).',
      '4. Install App στο workspace — αντιγράψε το "Bot User OAuth Token" (ξεκινά με xoxb-).',
      '5. Basic Information → App Credentials → Signing Secret — αντιγράψε το.',
      '',
      '  🔗 api.slack.com/apps'
    ],
    status: 'available',
    npmPackage: '@slack/bolt'
  },
  {
    id: 'signal',
    name: 'Signal',
    emoji: '🔒',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['linux', 'darwin'],
    tokenLabel: 'Signal phone number',
    tokenHint: 'Requires signal-cli installed',
    setupSteps: [
      '1. Εγκατάσταση signal-cli: https://github.com/AsamK/signal-cli',
      '2. Εγγραφή αριθμού: signal-cli -a +30XXXXXXXXX register',
      '3. Ήλεκτρονική επαλήθευση (αν υπάρχει) ή κωδικός από SMS.',
      '4. Εδώ γράψε τον αριθμό τηλεφώνου (π.χ. +30XXXXXXXXX).',
      '',
      '  🔗 github.com/AsamK/signal-cli'
    ],
    status: 'available',
    notes: 'Requires signal-cli to be installed and registered'
  },
  {
    id: 'imessage',
    name: 'iMessage',
    emoji: '💬',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['darwin'],
    setupSteps: [
      '1. macOS μόνο. Χρειάζεσαι BlueBubbles (bluebubbles.app) ή Beeper bridge.',
      '2. BlueBubbles: εγκατάσταση στο Mac, έλεγχος server URL και API key.',
      '3. Ή Beeper: σύνδεση με iMessage μέσω Beeper desktop app.',
      '4. Ρύθμισε server URL και token στην διαμόρφωση του channel.',
      '',
      '  🔗 bluebubbles.app — beeper.com'
    ],
    status: os.platform() === 'darwin' ? 'available' : 'unavailable',
    notes: 'macOS only — uses BlueBubbles or Beeper bridge',
    npmPackage: 'bluebubbles-api'
  },
  {
    id: 'matrix',
    name: 'Matrix',
    emoji: '🔷',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: undefined,
    extraFields: [
      { name: 'homeserver', label: 'Homeserver URL', hint: 'e.g. https://matrix.org', required: true },
      { name: 'accessToken', label: 'Access Token', required: true }
    ],
    setupSteps: [
      '1. Δημιούργησε λογαριασμό bot σε matrix.org ή άλλο homeserver.',
      '2. Access token: Element/SchildiChat → Settings → Help & About → Access Token.',
      '3. Ή μέσω API: POST /_matrix/client/r0/login με type=m.login.password.',
      '4. Homeserver URL: https://matrix.org ή το URL του server σου.',
      '',
      '  🔗 matrix.org — element.io'
    ],
    status: 'available',
    npmPackage: 'matrix-js-sdk'
  },
  {
    id: 'irc',
    name: 'IRC',
    emoji: '📡',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: undefined,
    extraFields: [
      { name: 'server', label: 'Server', hint: 'e.g. irc.libera.chat', required: true },
      { name: 'nick', label: 'Nickname', required: true },
      { name: 'channels', label: 'Default channels (#room)', required: false }
    ],
    setupSteps: [
      '1. Διάλεξε IRC server (π.χ. irc.libera.chat, irc.oftc.net).',
      '2. Χρειάζεσαι nickname για το bot και προαιρετικά channel για να μπεί.',
      '3. Κάποιοι servers χρειάζονται επαλήθευση πριν το /join.',
      '',
      '  🔗 libera.chat — oftc.net'
    ],
    status: 'available',
    npmPackage: 'irc'
  },
  {
    id: 'mattermost',
    name: 'Mattermost',
    emoji: '🏢',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Personal Access Token (or Bot token)',
    tokenHint: 'Account Settings > Security > Personal Access Tokens',
    setupSteps: [
      '1. Στο Mattermost: Προφίλ → Account Settings → Security → Personal Access Tokens.',
      '2. Create token — αντιγράψε το (δεν εμφανίζεται ξανά).',
      '3. Integrations → Outgoing Webhooks → Add outgoing webhook.',
      '4. Σημείωσε το webhook URL και το Trigger Word. Το token από το webhook χρειάζεται για επαλήθευση.',
      '5. Webhook URL για gateway: https://<gateway>/webhook/mattermost',
      '',
      '  🔗 docs.mattermost.com'
    ],
    extraFields: [
      { name: 'serverUrl', label: 'Server URL', hint: 'https://mattermost.example.com', required: true },
      { name: 'webhookToken', label: 'Outgoing Webhook Token', hint: 'From Integrations > Outgoing Webhook', required: true }
    ],
    status: 'available',
    notes: 'Requires Outgoing Webhook + PAT. Webhook URL: /webhook/mattermost',
    npmPackage: '@mattermost/client'
  },
  {
    id: 'googlechat',
    name: 'Google Chat',
    emoji: '🔵',
    requiresGateway: false,
    supportsDM: false,
    platforms: ['all'],
    tokenLabel: 'Google Chat webhook URL',
    setupSteps: [
      '1. Στο Google Chat: Room → Manage webhooks → Add webhook.',
      '2. Δώσε όνομα και αντιγράψε το Webhook URL.',
      '3. Κόλλησε το URL παρακάτω.',
      '',
      '  🔗 chat.google.com'
    ],
    status: 'available'
  },
  {
    id: 'msteams',
    name: 'Microsoft Teams',
    emoji: '🟣',
    requiresGateway: false,
    supportsDM: false,
    platforms: ['all'],
    tokenLabel: 'Teams incoming webhook URL',
    setupSteps: [
      '1. Στο Teams: Channel → Connectors → Incoming Webhook → Configure.',
      '2. Δώσε όνομα και αντιγράψε το Webhook URL.',
      '3. Κόλλησε το URL παρακάτω.',
      '',
      '  🔗 docs.microsoft.com/microsoftteams/platform/webhooks-and-connectors'
    ],
    status: 'available'
  },
  {
    id: 'nostr',
    name: 'Nostr',
    emoji: '⚡',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Nostr private key (nsec)',
    extraFields: [{ name: 'relay', label: 'Relay URL', hint: 'wss://relay.damus.io', required: true }],
    setupSteps: [
      '1. Χρειάζεσαι Nostr private key (nsec1...). Μπορείς να δημιουργήσεις με Damus, Amethyst ή iris.to.',
      '2. Επιλογή Relay: π.χ. wss://relay.damus.io, wss://relay.nostr.band.',
      '3. ΜΗΝ μοιράζεσαι το nsec — είναι το ιδιωτικό κλειδί σου.',
      '',
      '  🔗 nostr.com — damus.io'
    ],
    status: 'available',
    npmPackage: 'nostr-tools'
  },
  {
    id: 'line',
    name: 'LINE',
    emoji: '🟩',
    requiresGateway: false,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'LINE Channel access token',
    extraFields: [{ name: 'secret', label: 'Channel Secret', required: true }],
    setupSteps: [
      '1. Πήγαινε στο developers.line.biz → Console → Create provider & channel.',
      '2. Messaging API channel → Ορισμός Basic settings.',
      '3. Channel access token: Issue ή Regenerate — αντιγράψε το.',
      '4. Channel secret: από Basic settings — αντιγράψε το.',
      '',
      '  🔗 developers.line.biz'
    ],
    status: 'available',
    npmPackage: '@line/bot-sdk'
  },
  {
    id: 'feishu',
    name: 'Feishu / Lark',
    emoji: '🪶',
    requiresGateway: false,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Feishu App ID',
    extraFields: [{ name: 'appSecret', label: 'App Secret', required: true }],
    setupSteps: [
      '1. Πήγαινε στο open.feishu.cn → Create enterprise app.',
      '2. Credentials: αντιγράψε App ID και App Secret.',
      '3. Ενεργοποίηση δικαιωμάτων: im:message, im:message.group_at_msg κ.λπ.',
      '',
      '  🔗 open.feishu.cn'
    ],
    status: 'available'
  },
  {
    id: 'synology-chat',
    name: 'Synology Chat',
    emoji: 'π’¬',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Incoming Webhook URL',
    tokenHint: 'Synology Chat incoming webhook URL',
    extraFields: [
      { name: 'outgoingToken', label: 'Outgoing Webhook Token', hint: 'Optional verification token', required: false }
    ],
    setupSteps: [
      '1. Synology Chat → Integration → Incoming Webhook: create a webhook and copy the URL.',
      '2. If you want inbound bot events, create an Outgoing Webhook pointing to /webhook/synology-chat.',
      '3. Paste the incoming webhook URL below.',
      '',
      '  🔗 kb.synology.com'
    ],
    status: 'available',
    notes: 'Webhook bridge for Synology Chat rooms / bot automation.'
  },
  {
    id: 'twitch',
    name: 'Twitch',
    emoji: 'π“Ί',
    requiresGateway: true,
    supportsDM: false,
    platforms: ['all'],
    tokenLabel: 'OAuth Token (oauth:...)',
    tokenHint: 'Generate a Twitch chat token for your bot account',
    extraFields: [
      { name: 'username', label: 'Bot Username', required: true },
      { name: 'channels', label: 'Channels (#name or comma-separated)', required: true }
    ],
    setupSteps: [
      '1. Create or use a Twitch bot account.',
      '2. Generate an IRC OAuth token for Twitch chat (format: oauth:...).',
      '3. Add one or more channels the bot should join.',
      '',
      '  🔗 dev.twitch.tv'
    ],
    status: 'available',
    notes: 'Twitch IRC chat integration for streams / channel chat.'
  },
  {
    id: 'tlon',
    name: 'Tlon',
    emoji: 'π”µ',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'API Key',
    tokenHint: 'Token for your Tlon API / bot gateway',
    extraFields: [
      { name: 'apiBaseUrl', label: 'API Base URL', hint: 'e.g. https://tlon.example.com', required: true },
      { name: 'channelId', label: 'Default Channel ID', required: false },
      { name: 'webhookSecret', label: 'Webhook Secret', required: false }
    ],
    setupSteps: [
      '1. Point Tlon events to /webhook/tlon on your HyperClaw gateway.',
      '2. Use the API base URL and API key for outbound sends.',
      '3. Optionally set a default channel ID and webhook secret.',
      '',
      '  🔗 Tlon bot gateway / integration endpoint'
    ],
    status: 'available',
    notes: 'Generic Tlon bridge via webhook ingress + outbound API send.'
  },
  {
    id: 'instagram',
    name: 'Instagram DMs',
    emoji: '📷',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Page Access Token',
    extraFields: [
      { name: 'instagramAccountId', label: 'Instagram Business Account ID', hint: 'From Meta Graph API', required: true },
      { name: 'verifyToken', label: 'Webhook Verify Token', hint: 'Any string for webhook verification', required: true }
    ],
    setupSteps: [
      '1. Meta for Developers → App → Add Instagram product.',
      '2. Connect Instagram Business account.',
      '3. Webhook URL: https://<your-host>/webhook/instagram, subscribe to messages.',
      '4. Page Access Token from Graph API Explorer.',
      '',
      '  🔗 developers.facebook.com'
    ],
    status: 'available',
    notes: 'Requires Instagram Business + Meta App'
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    emoji: '💬',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Page Access Token',
    extraFields: [
      { name: 'verifyToken', label: 'Webhook Verify Token', required: true },
      { name: 'appSecret', label: 'App Secret', required: true },
      { name: 'pageId', label: 'Page ID', required: true }
    ],
    setupSteps: [
      '1. Meta for Developers → App → Add Messenger product.',
      '2. Webhook: https://<your-host>/webhook/messenger, subscribe to messages.',
      '3. Page Access Token, App Secret, Page ID from app settings.',
      '',
      '  🔗 developers.facebook.com'
    ],
    status: 'available'
  },
  {
    id: 'twitter',
    name: 'Twitter / X DMs',
    emoji: '🐦',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Bearer Token',
    extraFields: [
      { name: 'apiKey', label: 'API Key (Consumer Key)', required: true },
      { name: 'apiSecret', label: 'API Secret (Consumer Secret)', required: true },
      { name: 'accessToken', label: 'Access Token', required: true },
      { name: 'accessTokenSecret', label: 'Access Token Secret', required: true }
    ],
    setupSteps: [
      '1. X Developer Portal → Project → App → Keys and tokens.',
      '2. Enable DM access. Account Activity API subscription.',
      '3. Webhook URL for Account Activity API.',
      '',
      '  🔗 developer.twitter.com'
    ],
    status: 'available',
    notes: 'Requires X API v2 + Account Activity API'
  },
  {
    id: 'viber',
    name: 'Viber',
    emoji: '🟣',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Viber Auth Token',
    extraFields: [
      { name: 'botName', label: 'Bot Name', required: true },
      { name: 'webhookUrl', label: 'Webhook URL', hint: 'https://<host>/webhook/viber', required: true }
    ],
    setupSteps: [
      '1. Viber Partners: partners.viber.com → Create bot.',
      '2. Auth Token, Bot Name from dashboard.',
      '3. Set webhook URL: https://<your-host>/webhook/viber',
      '',
      '  🔗 partners.viber.com'
    ],
    status: 'available'
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud Talk',
    emoji: '☁️',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Nextcloud URL',
    extraFields: [
      { name: 'username', label: 'Username', required: true },
      { name: 'password', label: 'App Password', required: true }
    ],
    setupSteps: [
      '1. Δημιούργησε App Password: Nextcloud → Προφίλ → Security → App passwords.',
      '2. Χρειάζεσαι URL του Nextcloud, username και App Password.',
      '',
      '  🔗 nextcloud.com'
    ],
    status: 'available'
  },
  {
    id: 'zalo',
    name: 'Zalo',
    emoji: '🔵',
    requiresGateway: false,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Zalo OA Access Token',
    setupSteps: [
      '1. Zalo Official Account (OA): developers.zalo.me → My Apps.',
      '2. Δημιουργία εφαρμογής και σύνδεση με OA.',
      '3. Access Token από το Zalo API (OAuth flow ή test token για ανάπτυξη).',
      '',
      '  🔗 developers.zalo.me'
    ],
    status: 'available'
  },
  {
    id: 'web',
    name: 'Web UI',
    emoji: '🌐',
    requiresGateway: true,
    supportsDM: false,
    platforms: ['all'],
    status: 'recommended',
    notes: 'Built-in — served at http://localhost:<gateway_port>'
  },
  {
    id: 'email',
    name: 'Email Gateway',
    emoji: '📧',
    requiresGateway: true,
    supportsDM: false,
    platforms: ['all'],
    tokenLabel: 'SMTP host',
    extraFields: [
      { name: 'smtpUser', label: 'SMTP Username', required: true },
      { name: 'smtpPass', label: 'SMTP Password', required: true },
      { name: 'imapHost', label: 'IMAP host (for reading)', required: false }
    ],
    setupSteps: [
      '1. Χρειάζεσαι SMTP server (Gmail, Outlook, SendGrid, Mailgun, ή custom).',
      '2. Gmail: ενεργοποίηση 2FA, δημιουργία App Password (myaccount.google.com/apppasswords).',
      '3. SMTP host: smtp.gmail.com, smtp.office365.com, ή το host του provider σου.',
      '4. Για IMAP (ανάγνωση email): imap.gmail.com κ.λπ.',
      '',
      '  🔗 support.google.com/accounts/answer/185833'
    ],
    status: 'available',
    npmPackage: 'nodemailer'
  },
  {
    id: 'cli',
    name: 'CLI / Terminal',
    emoji: '🖥️',
    requiresGateway: false,
    supportsDM: false,
    platforms: ['all'],
    status: 'recommended',
    notes: 'Always active — hyperclaw chat'
  },
  {
    id: 'chrome-extension',
    name: 'Chrome Extension',
    emoji: '🌐',
    requiresGateway: true,
    supportsDM: false,
    platforms: ['all'],
    status: 'available',
    notes: 'Browser extension — connects via WebSocket. Load extensions/chrome-extension in Chrome.'
  },
  {
    id: 'voice-call',
    name: 'Voice Call (Terminal)',
    emoji: '🎙️',
    requiresGateway: true,
    supportsDM: false,
    platforms: ['all'],
    status: 'available',
    notes: 'Terminal voice session — hyperclaw voice-call'
  }
];

export function getChannel(id: string): ChannelDef | undefined {
  return CHANNELS.find(c => c.id === id);
}

export function statusBadge(status: ChannelStatus = 'available'): string {
  return {
    configured: chalk.green('[configured]'),
    recommended: chalk.cyan('[recommended]'),
    available: chalk.gray('[available]'),
    unavailable: chalk.red('[unavailable]')
  }[status];
}

export function getAvailableChannels(): ChannelDef[] {
  const platform = os.platform() as any;
  return CHANNELS.filter(ch => {
    if (ch.platforms.includes('all')) return true;
    return ch.platforms.includes(platform);
  });
}

// Zalo Personal (separate from Zalo OA)
export const ZALO_PERSONAL: ChannelDef = {
  id: 'zalo-personal',
  name: 'Zalo Personal',
  emoji: '🔵',
  requiresGateway: true,
  supportsDM: true,
  platforms: ['all'],
  tokenLabel: 'Zalo Personal cookie token',
  tokenHint: 'Extract from browser',
  setupSteps: [
    '1. Unofficial API — χρησιμοποιεί browser cookies. Μπορεί να χαλάσει με ενημερώσεις Zalo.',
    '2. Άνοιξε Zalo Web στο browser, Developer Tools → Application → Cookies.',
    '3. Ψάξε για token/cookie που χρησιμοποιεί το Zalo για auth.',
    '4. Δες docs/channels/zalo-personal.md για λεπτομέρειες.',
    '',
    '  ⚠️  Unofficial — use at your own risk'
  ],
  status: 'available',
  notes: 'Uses unofficial Zalo personal API — may break on Zalo app updates'
};

// Add to CHANNELS array
CHANNELS.push(ZALO_PERSONAL);
