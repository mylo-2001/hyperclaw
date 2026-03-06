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
      '1. Open Telegram and search for @BotFather (the official bot for creating bots).',
      '2. Start a conversation with /start and type /newbot to create a new bot.',
      '3. Give the bot a name (e.g. "My HyperClaw Bot") and a username ending in "bot" (e.g. my_hyperclaw_bot).',
      '4. @BotFather will send you the Bot Token — a string starting with 7xxxxxx:AAH... Keep it secret!',
      '5. Copy the token and paste it below.',
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
      '1. Go to Discord Developer Portal: https://discord.com/developers/applications',
      '2. Click "New Application", give it a name and create it.',
      '3. Left menu: Bot → Add Bot.',
      '4. Click "Reset Token" and copy the token (keep it secret!).',
      '5. Settings → OAuth2 → General, copy the Application ID (Client ID).',
      '6. Optional: To add the bot to a server, Bot → OAuth2 → URL Generator, scope: bot.',
      '',
      '  🔗 discord.com/developers/applications'
    ],
    extraFields: [{ name: 'clientId', label: 'Client ID (Application ID)', hint: 'From OAuth2 → General', required: true }],
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
      '1. Go to Meta for Developers: https://developers.facebook.com/',
      '2. My Apps → Create App → Business type.',
      '3. Add product: WhatsApp → Get started.',
      '4. WhatsApp → API Setup: copy the Temporary access token or create a permanent one.',
      '5. You also need a Phone Number ID and WhatsApp Business Account ID.',
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
      '1. No Meta Business API needed — uses WhatsApp Web.',
      '2. Make sure you have installed: npm install @whiskeysockets/baileys',
      '3. Start the gateway. On first connection a QR code will appear.',
      '4. Scan the QR with your phone (WhatsApp → Linked Devices → Link a device).',
      '5. After connecting, the session is saved — no QR needed again.',
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
      '1. Go to api.slack.com/apps → Create New App → From scratch.',
      '2. Give it a name and choose a workspace.',
      '3. OAuth & Permissions: Add Bot Token Scopes (chat:write, users:read, im:read, im:history, etc.).',
      '4. Install App to workspace — copy the "Bot User OAuth Token" (starts with xoxb-).',
      '5. Basic Information → App Credentials → Signing Secret — copy it.',
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
      '1. Install signal-cli: https://github.com/AsamK/signal-cli',
      '2. Register number: signal-cli -a +1XXXXXXXXX register',
      '3. Verify electronically (if available) or via SMS code.',
      '4. Enter your phone number here (e.g. +1XXXXXXXXX).',
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
      '1. macOS only. You need BlueBubbles (bluebubbles.app) or Beeper bridge.',
      '2. BlueBubbles: install on Mac, check server URL and API key.',
      '3. Or Beeper: connect to iMessage via Beeper desktop app.',
      '4. Set server URL and token in the channel configuration.',
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
      '1. Create a bot account on matrix.org or another homeserver.',
      '2. Access token: Element/SchildiChat → Settings → Help & About → Access Token.',
      '3. Or via API: POST /_matrix/client/r0/login with type=m.login.password.',
      '4. Homeserver URL: https://matrix.org or your server URL.',
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
      '1. Choose an IRC server (e.g. irc.libera.chat, irc.oftc.net).',
      '2. You need a nickname for the bot and optionally a channel to join.',
      '3. Some servers require authentication before /join.',
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
      '1. In Mattermost: Profile → Account Settings → Security → Personal Access Tokens.',
      '2. Create token — copy it (not shown again).',
      '3. Integrations → Outgoing Webhooks → Add outgoing webhook.',
      '4. Note the webhook URL and Trigger Word. The webhook token is needed for verification.',
      '5. Webhook URL for gateway: https://<gateway>/webhook/mattermost',
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
      '1. In Google Chat: Room → Manage webhooks → Add webhook.',
      '2. Give it a name and copy the Webhook URL.',
      '3. Paste the URL below.',
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
      '1. In Teams: Channel → Connectors → Incoming Webhook → Configure.',
      '2. Give it a name and copy the Webhook URL.',
      '3. Paste the URL below.',
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
      '1. You need a Nostr private key (nsec1...). Create one with Damus, Amethyst or iris.to.',
      '2. Choose a Relay: e.g. wss://relay.damus.io, wss://relay.nostr.band.',
      '3. NEVER share your nsec — it is your private key.',
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
      '1. Go to developers.line.biz → Console → Create provider & channel.',
      '2. Messaging API channel → Configure Basic settings.',
      '3. Channel access token: Issue or Regenerate — copy it.',
      '4. Channel secret: from Basic settings — copy it.',
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
      '1. Go to open.feishu.cn → Create enterprise app.',
      '2. Credentials: copy App ID and App Secret.',
      '3. Enable permissions: im:message, im:message.group_at_msg etc.',
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
      '1. Create App Password: Nextcloud → Profile → Security → App passwords.',
      '2. You need the Nextcloud URL, username and App Password.',
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
      '2. Create an app and connect it to your OA.',
      '3. Access Token from Zalo API (OAuth flow or test token for development).',
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
      '1. You need an SMTP server (Gmail, Outlook, SendGrid, Mailgun, or custom).',
      '2. Gmail: enable 2FA, create App Password (myaccount.google.com/apppasswords).',
      '3. SMTP host: smtp.gmail.com, smtp.office365.com, or your provider host.',
      '4. For IMAP (reading email): imap.gmail.com etc.',
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
    '1. Unofficial API — uses browser cookies. May break with Zalo updates.',
    '2. Open Zalo Web in browser, Developer Tools → Application → Cookies.',
    '3. Look for the token/cookie Zalo uses for auth.',
    '4. See docs/channels/zalo-personal.md for details.',
    '',
    '  ⚠️  Unofficial — use at your own risk'
  ],
  status: 'available',
  notes: 'Uses unofficial Zalo personal API — may break on Zalo app updates'
};

// Add to CHANNELS array
CHANNELS.push(ZALO_PERSONAL);
