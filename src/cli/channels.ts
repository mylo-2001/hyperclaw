/**
 * src/cli/channels.ts
 * Channel registry — status badges, DM policy, eligibility check per OS.
 * Channel matrix with configured/recommended/available/unavailable.
 */
import chalk from 'chalk';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';

export type ChannelStatus = 'configured' | 'recommended' | 'available' | 'unavailable';
export type DMPolicy = 'open' | 'allowlist' | 'pairing' | 'none';

export interface ChannelDef {
  id: string;
  name: string;
  emoji: string;
  requiresGateway: boolean;
  supportsDM: boolean;
  platforms: ('linux' | 'darwin' | 'win32' | 'all')[];
  tokenLabel?: string;
  tokenHint?: string;
  /** Step-by-step setup guide */
  setupSteps?: string[];
  extraFields?: { name: string; label: string; hint?: string; required: boolean }[];
  npmPackage?: string;
  notes?: string;
  defaultDMPolicy: DMPolicy;
}

export const CHANNEL_DEFS: ChannelDef[] = [
  {
    id: 'telegram',    name: 'Telegram',     emoji: '✈️',
    requiresGateway: false, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Telegram Bot Token', tokenHint: 'Get from @BotFather → /newbot',
    setupSteps: [
      '1. Open Telegram → @BotFather → /newbot',
      '2. Set name and username (must end in bot)',
      '3. Copy the Bot Token',
      '  🔗 t.me/BotFather'
    ],
    npmPackage: 'node-telegram-bot-api', defaultDMPolicy: 'pairing'
  },
  {
    id: 'discord',     name: 'Discord',      emoji: '🎮',
    requiresGateway: false, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Discord Bot Token', tokenHint: 'discord.com/developers/applications',
    setupSteps: [
      '1. discord.com/developers/applications → New Application',
      '2. Bot → Add Bot → Reset Token',
      '3. OAuth2 → General → copy Application ID',
      '  🔗 discord.com/developers/applications'
    ],
    extraFields: [{ name: 'clientId', label: 'Client ID', required: true }],
    npmPackage: 'discord.js', defaultDMPolicy: 'pairing'
  },
  {
    id: 'whatsapp',    name: 'WhatsApp',     emoji: '📱',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'WhatsApp Business API key', tokenHint: 'business.whatsapp.com',
    setupSteps: [
      '1. developers.facebook.com → My Apps → Create App',
      '2. WhatsApp → API Setup → Access Token',
      '  🔗 business.whatsapp.com'
    ],
    npmPackage: '@whiskeysockets/baileys', defaultDMPolicy: 'pairing'
  },
  {
    id: 'slack',       name: 'Slack',        emoji: '💼',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Slack Bot Token (xoxb-...)', tokenHint: 'api.slack.com/apps',
    setupSteps: [
      '1. api.slack.com/apps → Create App → Bot',
      '2. Install App → αντιγράψε Bot Token (xoxb-)',
      '3. Basic Information → Signing Secret',
      '  🔗 api.slack.com/apps'
    ],
    extraFields: [{ name: 'signingSecret', label: 'Signing Secret', required: true }],
    defaultDMPolicy: 'allowlist'
  },
  {
    id: 'signal',      name: 'Signal',       emoji: '🔒',
    requiresGateway: true, supportsDM: true, platforms: ['linux', 'darwin'],
    tokenLabel: 'Registered phone number', tokenHint: 'Requires signal-cli installed',
    setupSteps: [
      '1. Install signal-cli or signald',
      '2. Link your number (signal-cli link or signald register)',
      '  🔗 github.com/AsamK/signal-cli'
    ],
    notes: 'Needs signal-cli + registered number', defaultDMPolicy: 'pairing'
  },
  {
    id: 'imessage',    name: 'iMessage',     emoji: '🍏',
    requiresGateway: true, supportsDM: true, platforms: ['darwin'],
    tokenLabel: 'BlueBubbles server password', tokenHint: 'bluebubbles.app on macOS',
    setupSteps: [
      '1. Install BlueBubbles on a Mac',
      '2. Configure and connect',
      '  🔗 bluebubbles.app'
    ],
    notes: 'macOS only via BlueBubbles', defaultDMPolicy: 'pairing'
  },
  {
    id: 'imessage-native', name: 'iMessage (imsg)', emoji: '💬',
    requiresGateway: true, supportsDM: true, platforms: ['darwin'],
    tokenLabel: 'Not required', tokenHint: 'Uses imsg CLI',
    setupSteps: [
      '1. Install imsg CLI: brew install steipete/imsg/imsg',
      '2. No token required — uses native iMessage',
      '  🔗 github.com/steipete/imsg'
    ],
    notes: 'macOS only, native via imsg CLI (github.com/steipete/imsg). No BlueBubbles.', defaultDMPolicy: 'pairing'
  },
  {
    id: 'matrix',      name: 'Matrix',       emoji: '🔢',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Matrix access token', tokenHint: 'element.io → Settings → Help → Access Token',
    setupSteps: [
      '1. Element → Settings → Help & About → Access Token',
      '2. Copy the access token',
      '  🔗 element.io'
    ],
    extraFields: [
      { name: 'homeserver', label: 'Homeserver URL', hint: 'https://matrix.org', required: true },
      { name: 'userId', label: 'User ID (@user:server)', required: true }
    ], defaultDMPolicy: 'pairing'
  },
  {
    id: 'email',       name: 'Email',        emoji: '📧',
    requiresGateway: false, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Gmail app password or IMAP password', tokenHint: 'Use app-specific password',
    setupSteps: [
      '1. Enable IMAP/SMTP in your email provider',
      '2. Use app password if you have 2FA',
      '  🔗 Gmail: myaccount.google.com/apppasswords'
    ],
    extraFields: [
      { name: 'imapHost', label: 'IMAP host', hint: 'imap.gmail.com', required: true },
      { name: 'smtpHost', label: 'SMTP host', hint: 'smtp.gmail.com', required: true },
      { name: 'user', label: 'Email address', required: true }
    ], defaultDMPolicy: 'allowlist'
  },
  {
    id: 'feishu',      name: 'Feishu/Lark',  emoji: '🪶',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Feishu App ID', tokenHint: 'open.feishu.cn',
    setupSteps: [
      '1. open.feishu.cn → Create application',
      '2. Copy App ID and App Secret',
      '  🔗 open.feishu.cn'
    ],
    extraFields: [{ name: 'appSecret', label: 'App Secret', required: true }],
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'msteams',     name: 'MS Teams',     emoji: '🟦',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Azure Bot App ID', tokenHint: 'portal.azure.com → Bot Services',
    setupSteps: [
      '1. dev.botframework.com → Register Bot',
      '2. Azure Bot → Configuration → copy App ID & Secret',
      '  🔗 dev.botframework.com'
    ],
    extraFields: [{ name: 'appPassword', label: 'App Password', required: true }],
    defaultDMPolicy: 'allowlist'
  },
  {
    id: 'messenger',   name: 'Messenger',    emoji: '💬',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Page Access Token', tokenHint: 'developers.facebook.com',
    setupSteps: [
      '1. developers.facebook.com → My Apps → Create App',
      '2. Add Messenger product → Page Access Token',
      '  🔗 developers.facebook.com'
    ],
    extraFields: [{ name: 'verifyToken', label: 'Webhook Verify Token', required: true }],
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'nostr',       name: 'Nostr',        emoji: '🌐',
    requiresGateway: false, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Nostr private key (hex or nsec)', tokenHint: 'Generate with: openssl rand -hex 32',
    setupSteps: [
      '1. Use existing nostr client or generate new keypair',
      '2. Copy nsec (private key)',
      '  🔗 nostr.com'
    ],
    notes: 'Decentralized — no account needed', defaultDMPolicy: 'open'
  },
  {
    id: 'line',        name: 'LINE',         emoji: '💚',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'LINE Channel Access Token', tokenHint: 'developers.line.biz',
    setupSteps: [
      '1. developers.line.biz → Add Messaging API channel',
      '2. Copy Channel Secret & Access Token',
      '  🔗 developers.line.biz'
    ],
    extraFields: [{ name: 'channelSecret', label: 'Channel Secret', required: true }],
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'viber',       name: 'Viber',        emoji: '💜',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Viber Auth Token', tokenHint: 'partners.viber.com',
    setupSteps: [
      '1. partners.viber.com → Create Bot',
      '2. Copy the Auth Token',
      '  🔗 partners.viber.com'
    ],
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'zalo',        name: 'Zalo OA',      emoji: '🔵',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Zalo OA Access Token', tokenHint: 'developers.zalo.me',
    setupSteps: [
      '1. developers.zalo.me → Create application',
      '2. Copy App ID and Access Token',
      '  🔗 developers.zalo.me'
    ],
    extraFields: [{ name: 'secretKey', label: 'Secret Key', required: true }],
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'twitter',     name: 'Twitter/X DM', emoji: '🐦',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Twitter API Key', tokenHint: 'developer.twitter.com',
    setupSteps: [
      '1. developer.twitter.com → Developer Portal',
      '2. Create Project & App → copy API keys',
      '  🔗 developer.twitter.com'
    ],
    extraFields: [
      { name: 'apiKeySecret', label: 'API Key Secret', required: true },
      { name: 'accessToken', label: 'Access Token', required: true },
      { name: 'accessTokenSecret', label: 'Access Token Secret', required: true }
    ], defaultDMPolicy: 'allowlist'
  },
  {
    id: 'irc',         name: 'IRC',          emoji: '📡',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'NickServ password (optional)', tokenHint: 'freenode, libera.chat, etc.',
    setupSteps: [
      '1. Choose IRC server (e.g. irc.libera.chat)',
      '2. Configure nick and password if needed',
      '  🔗 libera.chat'
    ],
    extraFields: [
      { name: 'server', label: 'IRC server', hint: 'irc.libera.chat', required: true },
      { name: 'nick', label: 'Nickname', required: true }
    ], defaultDMPolicy: 'allowlist'
  },
  {
    id: 'mattermost',  name: 'Mattermost',   emoji: '🏗️',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Mattermost bot token', tokenHint: 'Settings → Integrations → Bot Accounts',
    setupSteps: [
      '1. Mattermost → Account Settings → Security → Personal Access Tokens',
      '2. Create token and copy it',
      '  🔗 docs.mattermost.com'
    ],
    extraFields: [{ name: 'serverUrl', label: 'Server URL', required: true }],
    defaultDMPolicy: 'allowlist'
  },
  {
    id: 'nextcloud',   name: 'Nextcloud Talk', emoji: '☁️',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Nextcloud app password', tokenHint: 'Your Nextcloud server',
    setupSteps: [
      '1. Nextcloud Admin → OAuth → new client',
      '2. Talk → view bot credentials',
      '  🔗 nextcloud.com'
    ],
    extraFields: [
      { name: 'serverUrl', label: 'Nextcloud URL', required: true },
      { name: 'username', label: 'Username', required: true }
    ], defaultDMPolicy: 'allowlist'
  },
  {
    id: 'googlechat',  name: 'Google Chat',  emoji: '🔵',
    requiresGateway: true, supportsDM: false, platforms: ['all'],
    tokenLabel: 'Google Chat Webhook URL', tokenHint: 'chat.google.com → Space → Apps & Integrations',
    setupSteps: [
      '1. chat.google.com → Space → Apps & Integrations → Manage webhooks',
      '2. Add webhook and copy the URL',
      '  🔗 chat.google.com'
    ],
    defaultDMPolicy: 'none'
  },
  {
    id: 'whatsapp-baileys', name: 'WhatsApp (Baileys)', emoji: '📲',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Not required — scans QR code on first run',
    setupSteps: [
      '1. No Meta Business API needed — uses WhatsApp Web protocol',
      '2. Start the gateway — a QR code will appear in the terminal',
      '3. Open WhatsApp on your phone → Linked Devices → Link a device',
      '4. Scan the QR code. Session is saved — no QR needed on future starts',
      '  🔗 github.com/WhiskeySockets/Baileys'
    ],
    notes: 'WhatsApp Web via Baileys — no Meta Business needed. QR scan on first run.',
    npmPackage: '@whiskeysockets/baileys', defaultDMPolicy: 'pairing'
  },
  {
    id: 'instagram', name: 'Instagram DMs', emoji: '📸',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Meta Page Access Token', tokenHint: 'developers.facebook.com → Instagram product',
    setupSteps: [
      '1. Meta for Developers → My Apps → Create App → Business',
      '2. Add Instagram product → Connect Instagram Business account',
      '3. Webhooks: subscribe to messages, URL: https://<host>/webhook/instagram',
      '4. Copy Page Access Token from Graph API Explorer (pages_messaging scope)',
      '  🔗 developers.facebook.com'
    ],
    extraFields: [
      { name: 'instagramAccountId', label: 'Instagram Business Account ID', required: true },
      { name: 'verifyToken', label: 'Webhook Verify Token (any string)', required: true }
    ],
    notes: 'Requires Instagram Business + Meta App', defaultDMPolicy: 'pairing'
  },
  {
    id: 'zalo-personal', name: 'Zalo Personal', emoji: '🔵',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Zalo cookie token', tokenHint: 'Extracted from browser session',
    setupSteps: [
      '1. Open Zalo Web in browser (chat.zalo.me)',
      '2. Open DevTools → Application → Cookies → find zpw_sek or _zlang',
      '3. Copy the session cookie value',
      '  ⚠  Unofficial API — may break on Zalo updates. Use at your own risk.'
    ],
    notes: 'Unofficial — uses Zalo Personal API. May break on updates.', defaultDMPolicy: 'pairing'
  },
  {
    id: 'voice-call', name: 'Voice Call', emoji: '🎙️',
    requiresGateway: true, supportsDM: false, platforms: ['all'],
    tokenLabel: 'Not required',
    setupSteps: [
      '1. No external account needed',
      '2. Requires microphone + ElevenLabs API key for TTS (optional)',
      '3. Start with: hyperclaw voice-call',
      '  💡 Works in terminal — voice input → agent → voice output'
    ],
    notes: 'Terminal voice session — hyperclaw voice-call', defaultDMPolicy: 'none'
  },
  {
    id: 'web', name: 'WebChat UI', emoji: '🌐',
    requiresGateway: true, supportsDM: false, platforms: ['all'],
    setupSteps: [
      '1. Built-in — no setup needed',
      '2. Start gateway: hyperclaw gateway',
      '3. Open: http://localhost:<port>/dashboard',
      '  💡 Works in any browser on your local network'
    ],
    notes: 'Built-in WebChat at http://localhost:<port>', defaultDMPolicy: 'none'
  },
  {
    id: 'cli', name: 'CLI / Terminal', emoji: '🖥️',
    requiresGateway: false, supportsDM: false, platforms: ['all'],
    setupSteps: [
      '1. Always active — no setup needed',
      '2. Use: hyperclaw chat  or  hyperclaw agent --message "..."',
      '  💡 Works offline without any channel configured'
    ],
    notes: 'Always active — hyperclaw chat', defaultDMPolicy: 'none'
  },
  {
    id: 'chrome-extension', name: 'Chrome Extension', emoji: '🔌',
    requiresGateway: true, supportsDM: false, platforms: ['all'],
    setupSteps: [
      '1. Open Chrome → chrome://extensions → Enable Developer mode',
      '2. Load unpacked → select: extensions/chrome-extension/',
      '3. Extension connects to gateway via WebSocket automatically',
      '  💡 Gives the agent access to your browser context'
    ],
    notes: 'Load extensions/chrome-extension/ as unpacked extension in Chrome', defaultDMPolicy: 'none'
  },
  {
    id: 'synology-chat', name: 'Synology Chat', emoji: '🖥️',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Incoming Webhook URL', tokenHint: 'DSM → Synology Chat → Integration → Incoming Webhooks',
    setupSteps: [
      '1. Open Synology Chat (DSM package)',
      '2. Top-right menu → Integration → Incoming Webhooks → Create',
      '3. Copy the Webhook URL (used to POST messages from HyperClaw)',
      '4. Outgoing Webhook: Integration → Outgoing Webhooks → Create',
      '     URL: http://<your-server>:7789/synology-hook',
      '     Method: POST',
      '  🔗 kb.synology.com/synologychat'
    ],
    extraFields: [
      { name: 'webhookPort', label: 'Outgoing webhook port', hint: '7789', required: false },
      { name: 'webhookToken', label: 'Outgoing webhook token (optional HMAC)', required: false }
    ],
    notes: 'Requires Synology Chat installed on your Synology NAS (DSM 7+)',
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'tlon', name: 'Tlon (Urbit)', emoji: '🪐',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'Urbit login code', tokenHint: 'From your Urbit ship: +code',
    setupSteps: [
      '1. Start your Urbit ship (e.g. via Port or urbit binary)',
      '2. In the Dojo: +code  → copy the code',
      '3. Note your ship name (e.g. ~sampel-palnet) and ship URL',
      '4. Optionally configure a group: ~sampel-palnet/my-group',
      '  🔗 tlon.io · urbit.org/getting-started'
    ],
    extraFields: [
      { name: 'shipUrl', label: 'Ship URL', hint: 'http://localhost:8080', required: true },
      { name: 'ship', label: 'Ship name', hint: '~sampel-palnet', required: true },
      { name: 'group', label: 'Group path (optional)', hint: '~sampel-palnet/my-group', required: false }
    ],
    notes: 'Requires a running Urbit ship with Tlon/Groups installed',
    defaultDMPolicy: 'pairing'
  },
  {
    id: 'twitch', name: 'Twitch', emoji: '🟣',
    requiresGateway: true, supportsDM: true, platforms: ['all'],
    tokenLabel: 'OAuth token (oauth:xxxxxxx)', tokenHint: 'twitchapps.com/tmi → connect with your bot account',
    setupSteps: [
      '1. Create a Twitch bot account (or use your own)',
      '2. Go to: twitchapps.com/tmi → Connect → copy the OAuth token',
      '3. Token format: oauth:xxxxxxxxxxxxxxxxxxxxxx',
      '4. Bot username = the Twitch account you logged in with',
      '  💡 To receive commands, users type: !<message>',
      '  💡 Moderators and the broadcaster bypass the allowlist by default',
      '  🔗 twitchapps.com/tmi'
    ],
    extraFields: [
      { name: 'username', label: 'Bot Twitch username (lowercase)', required: true },
      { name: 'channels', label: 'Channel(s) to join (comma-separated)', hint: 'mychannel or mychannel,otherchannel', required: true },
      { name: 'commandPrefix', label: 'Command prefix', hint: '! (default)', required: false }
    ],
    notes: 'Chat-based; uses Twitch IRC over WebSocket. Command prefix required (default: !)',
    defaultDMPolicy: 'pairing'
  },
];

// ── Status detection ──────────────────────────────────────────────────────────

export async function getChannelStatus(
  def: ChannelDef,
  configuredIds: string[]
): Promise<ChannelStatus> {
  const platform = os.platform() as 'linux' | 'darwin' | 'win32';

  // Platform check
  if (!def.platforms.includes('all') && !def.platforms.includes(platform)) {
    return 'unavailable';
  }
  // Configured check
  if (configuredIds.includes(def.id)) return 'configured';
  // Recommended = Telegram + Discord (most common)
  if (['telegram', 'discord'].includes(def.id)) return 'recommended';
  return 'available';
}

/** Human-readable reason why a channel is unavailable on this OS */
export function unavailableReason(def: ChannelDef): string {
  const platform = os.platform();
  if (def.platforms.length === 1 && def.platforms[0] === 'darwin') {
    return 'macOS only';
  }
  if (def.platforms.includes('linux') && def.platforms.includes('darwin') && !def.platforms.includes('win32' as any)) {
    return 'Linux/macOS only';
  }
  if (!def.platforms.includes('all') && !def.platforms.includes(platform as any)) {
    return `not supported on ${platform}`;
  }
  return 'unavailable on this OS';
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function statusBadge(status: ChannelStatus, def?: ChannelDef): string {
  switch (status) {
    case 'configured':  return chalk.green('[configured]');
    case 'recommended': return chalk.cyan('[recommended]');
    case 'available':   return chalk.gray('[available]');
    case 'unavailable': {
      const reason = def ? unavailableReason(def) : 'unavailable';
      return chalk.red(`[${reason}]`);
    }
  }
}

export async function showChannelMatrix(configuredIds: string[]): Promise<void> {
  console.log(chalk.bold.cyan('\n  📡 CHANNEL MATRIX\n'));
  for (const def of CHANNEL_DEFS) {
    const status = await getChannelStatus(def, configuredIds);
    const badge = statusBadge(status, def);
    const dmIcon = def.supportsDM ? chalk.green('DM✓') : chalk.gray('no DM');
    console.log(`  ${def.emoji} ${def.name.padEnd(18)} ${badge.padEnd(32)} ${dmIcon}`);
    if (def.notes) console.log(chalk.gray(`     ${def.notes}`));
  }
  console.log();
}

export function getChannelDef(id: string): ChannelDef | undefined {
  return CHANNEL_DEFS.find(c => c.id === id);
}

// Aliases for onboard.ts compatibility
export const CHANNELS = CHANNEL_DEFS;
export async function getAvailableChannels(configuredIds: string[] = []): Promise<(ChannelDef & { status: ChannelStatus })[]> {
  const result: (ChannelDef & { status: ChannelStatus })[] = [];
  for (const def of CHANNEL_DEFS) {
    const status = await getChannelStatus(def, configuredIds);
    result.push({ ...def, status });
  }
  return result;
}
