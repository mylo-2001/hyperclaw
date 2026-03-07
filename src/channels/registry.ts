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
    extraFields: [
      { name: 'dmPolicy', label: 'DM policy', hint: 'pairing (default) | allowlist | open | disabled', required: false },
      { name: 'groupActivation', label: 'Group activation', hint: 'mention (default) | always', required: false }
    ],
    setupSteps: [
      '1. Open Telegram → @BotFather → /newbot. Save the token.',
      '2. Config: channels.telegram.botToken, dmPolicy (default: pairing), groups.',
      '3. Start gateway, approve first DM: hyperclaw pairing approve telegram <CODE>',
      '4. Add bot to groups; set groups["*"].requireMention for mention gating.',
      '',
      '  🔗 docs/telegram.md — full setup'
    ],
    status: 'recommended',
    npmPackage: 'node-telegram-bot-api',
    notes: 'DMs + groups. Pairing, allowlist, voice notes. Long polling default.'
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
      '1. Discord Developer Portal → New Application → Bot → Reset Token.',
      '2. Enable Message Content Intent (and Server Members if needed).',
      '3. OAuth2 URL Generator: scope bot + applications.commands, permissions: View Channels, Send Messages, Read Message History.',
      '4. Add bot to server, enable Developer Mode, copy Server ID and User ID.',
      '5. Enable DMs from server members (right‑click server → Privacy Settings).',
      '6. hyperclaw gateway → DM the bot → hyperclaw pairing approve discord <CODE>',
      '',
      '  🔗 docs/discord-setup.md — full setup guide'
    ],
    extraFields: [
      { name: 'listenGuildIds', label: 'Guild IDs to listen in', hint: '[] = all. Add Server IDs to restrict.', required: false },
      { name: 'requireMentionInGuild', label: 'Require @mention in guild', hint: 'true (default) | false', required: false },
      { name: 'dmPolicy', label: 'DM policy', hint: '"pairing" (default) | "allowlist" | "open" | "none"', required: false }
    ],
    status: 'recommended',
    npmPackage: 'ws'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp (Cloud API)',
    emoji: '📱',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Access Token',
    tokenHint: 'business.whatsapp.com',
    extraFields: [
      { name: 'phoneNumberId', label: 'Phone Number ID', hint: 'From Meta API Setup', required: true },
      { name: 'verifyToken', label: 'Webhook verify token', hint: 'Any string for webhook verification', required: false },
      { name: 'dmPolicy', label: 'DM policy', hint: 'pairing (default) | allowlist | open | disabled', required: false }
    ],
    setupSteps: [
      '1. Meta for Developers → Create App → Business → Add WhatsApp.',
      '2. API Setup: copy Phone Number ID and Access Token.',
      '3. Webhook: https://<host>/webhook/whatsapp, subscribe to messages.',
      '4. Start gateway. Approve DMs: hyperclaw pairing approve whatsapp <CODE>',
      '',
      '  🔗 docs/whatsapp.md — full setup'
    ],
    status: 'available',
    notes: 'Meta Business API. Webhook required.',
    npmPackage: undefined
  },
  {
    id: 'whatsapp-baileys',
    name: 'WhatsApp (Baileys)',
    emoji: '📲',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    extraFields: [
      { name: 'dmPolicy', label: 'DM policy', hint: 'pairing (default) | allowlist | open | disabled', required: false }
    ],
    setupSteps: [
      '1. No Meta API — uses WhatsApp Web. Install: npm install @whiskeysockets/baileys',
      '2. hyperclaw channels add whatsapp-baileys, then hyperclaw gateway',
      '3. Scan QR (WhatsApp → Linked Devices → Link a device)',
      '4. Approve first DM: hyperclaw pairing approve whatsapp-baileys <CODE>',
      '',
      '  🔗 docs/whatsapp.md — full setup'
    ],
    status: 'available',
    notes: 'WhatsApp Web via Baileys. No Meta Business. Pairing, voice notes.',
    npmPackage: '@whiskeysockets/baileys'
  },
  {
    id: 'slack',
    name: 'Slack',
    emoji: '💼',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Slack Bot Token (xoxb-...)',
    extraFields: [
      { name: 'appToken', label: 'App Token (xapp-...)', hint: 'Required for Socket Mode (default) — connections:write scope', required: false },
      { name: 'signingSecret', label: 'Signing Secret', hint: 'Required for HTTP Events API mode only', required: false },
      { name: 'mode', label: 'Connection mode', hint: 'socket (default) | http', required: false },
      { name: 'userToken', label: 'User Token (xoxp-...)', hint: 'Optional — for read operations', required: false },
      { name: 'ackReaction', label: 'Ack reaction emoji', hint: 'Shortcode without colons, e.g. eyes', required: false },
      { name: 'typingReaction', label: 'Typing reaction emoji', hint: 'Shortcode, e.g. hourglass_flowing_sand', required: false }
    ],
    setupSteps: [
      '1. Go to api.slack.com/apps → Create New App → From scratch.',
      '2. Socket Mode (default — no public URL needed):',
      '   a. Settings → Socket Mode → Enable Socket Mode.',
      '   b. Settings → Basic Information → App-Level Tokens → Generate Token (connections:write) → copy xapp-...',
      '   c. OAuth & Permissions: add bot scopes (chat:write, im:read, im:history, channels:history, etc.).',
      '   d. Install App → copy Bot Token (xoxb-...).',
      '3. HTTP mode (alternative):',
      '   a. Event Subscriptions → Request URL: https://<host>/webhook/slack.',
      '   b. Basic Information → Signing Secret — copy it.',
      '4. Subscribe to bot events: app_mention, message.im, message.channels, message.groups, message.mpim, reaction_added.',
      '5. App Home → Messages Tab → Enable.',
      '',
      '  🔗 api.slack.com/apps'
    ],
    status: 'recommended',
    notes: 'Socket Mode (default) requires appToken. HTTP mode requires signingSecret. Supports DMs, channels, threads, reactions, streaming.',
    npmPackage: '@slack/bolt'
  },
  {
    id: 'signal',
    name: 'Signal',
    emoji: '🔒',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['linux', 'darwin'],
    tokenLabel: 'Bot phone number (E.164)',
    tokenHint: 'e.g. +15551234567 — use a dedicated bot number',
    setupSteps: [
      '1. Install signal-cli: https://github.com/AsamK/signal-cli',
      '',
      '  Path A — Link existing Signal account (QR):',
      '    signal-cli link -n "HyperClaw"  then scan in Signal.',
      '',
      '  Path B — Register dedicated bot number (SMS):',
      '    signal-cli -a +<BOT_NUMBER> register',
      '    signal-cli -a +<BOT_NUMBER> register --captcha \'<URL>\'  (if captcha required)',
      '    signal-cli -a +<BOT_NUMBER> verify <CODE>',
      '',
      '2. Set account: "+<BOT_NUMBER>" in config.',
      '3. autoStart=true (default) spawns daemon automatically.',
      '   Or run daemon yourself and set httpUrl: "http://127.0.0.1:8080".',
      '',
      '  Access control:',
      '    dmPolicy=pairing (default) — senders get pairing code (expires 1h)',
      '    groupPolicy=allowlist (default) — only groupAllowFrom senders trigger bot',
      '',
      '  Chunking: textChunkLimit=4000, chunkMode=length|newline',
      '  Reactions: actions.reactions=true, reactionLevel=off|ack|minimal|extensive',
      '',
      '  🔗 github.com/AsamK/signal-cli',
      '  🔗 github.com/AsamK/signal-cli/wiki/Registration-with-captcha'
    ],
    extraFields: [
      { name: 'account', label: 'Bot number (E.164)', hint: '+15551234567', required: true },
      { name: 'cliPath', label: 'signal-cli path', hint: 'signal-cli (if on PATH)', required: false },
      { name: 'httpUrl', label: 'Daemon URL (external)', hint: 'http://127.0.0.1:8080 — skips autoStart', required: false },
      { name: 'httpPort', label: 'Daemon port', hint: '8080 (default)', required: false },
      { name: 'autoStart', label: 'Auto-spawn daemon', hint: 'true (default) / false', required: false },
      { name: 'startupTimeoutMs', label: 'Startup timeout (ms)', hint: '15000 default, max 120000', required: false },
      { name: 'dmPolicy', label: 'DM policy', hint: '"pairing" (default) | "allowlist" | "open" | "disabled"', required: false },
      { name: 'groupPolicy', label: 'Group policy', hint: '"allowlist" (default) | "open" | "disabled"', required: false },
      { name: 'textChunkLimit', label: 'Text chunk limit (chars)', hint: '4000 default', required: false },
      { name: 'chunkMode', label: 'Chunk mode', hint: '"length" (default) | "newline"', required: false }
    ],
    status: 'available',
    notes: 'signal-cli HTTP daemon + SSE events. DMs, groups, typing, reactions, chunking, multi-account.'
  },
  {
    id: 'imessage',
    name: 'iMessage (BlueBubbles)',
    emoji: '💬',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['darwin'],
    tokenLabel: 'BlueBubbles server URL',
    extraFields: [
      { name: 'password', label: 'BlueBubbles password', hint: 'Set in BlueBubbles server settings', required: true },
      { name: 'dmPolicy', label: 'DM policy', hint: 'pairing (default) | allowlist | open | disabled', required: false }
    ],
    setupSteps: [
      '1. macOS only. Install BlueBubbles server: bluebubbles.app',
      '2. BlueBubbles → Settings: enable web API, set password, note Server URL.',
      '3. Add channel (imessage or bluebubbles), enter serverUrl + password.',
      '4. hyperclaw gateway → hyperclaw pairing approve bluebubbles <CODE>',
      '',
      '  🔗 docs/bluebubbles.md — bluebubbles.app'
    ],
    status: os.platform() === 'darwin' ? 'recommended' : 'unavailable',
    notes: 'BlueBubbles server on Mac. DMs, pairing. Groups planned.',
    npmPackage: 'bluebubbles-api'
  },
  {
    id: 'imessage-native',
    name: 'iMessage (imsg CLI — legacy)',
    emoji: '💬',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['darwin'],
    extraFields: [
      { name: 'cliPath', label: 'imsg binary path', hint: 'Default: imsg (must be in PATH)', required: false },
      { name: 'dbPath', label: 'Messages DB path', hint: 'Default: ~/Library/Messages/chat.db', required: false }
    ],
    setupSteps: [
      '1. macOS only. Install imsg: brew install steipete/tap/imsg',
      '2. Verify: imsg rpc --help',
      '3. Grant Full Disk Access + Automation to Terminal/Node (one-time: imsg chats --limit 1).',
      '4. No token needed — imsg runs locally via JSON-RPC on stdio.',
      '5. (Optional) Set cliPath if imsg is not in PATH.',
      '',
      '  ⚠️  Legacy integration — for new setups use iMessage (BlueBubbles)',
      '  🔗 github.com/steipete/imsg'
    ],
    status: os.platform() === 'darwin' ? 'available' : 'unavailable',
    notes: 'Legacy — gateway spawns imsg rpc over JSON-RPC stdio. For new setups prefer BlueBubbles.'
  },
  {
    id: 'matrix',
    name: 'Matrix',
    emoji: '🔷',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Access Token (syt_...)',
    tokenHint: 'Or set userId + password instead',
    extraFields: [
      { name: 'homeserver', label: 'Homeserver URL', hint: 'e.g. https://matrix.example.org', required: true },
      { name: 'accessToken', label: 'Access Token (syt_...)', hint: 'Preferred; userId auto-fetched via /whoami', required: false },
      { name: 'userId', label: 'Matrix User ID', hint: '@bot:example.org — required only for password login', required: false },
      { name: 'password', label: 'Password (alternative to token)', hint: 'Token cached to credentials file on first login', required: false },
      { name: 'deviceName', label: 'Device display name', hint: 'Shown in Matrix clients', required: false },
      { name: 'encryption', label: 'Enable E2EE', hint: 'true | false — requires crypto native module', required: false },
      { name: 'threadReplies', label: 'Thread replies', hint: 'off | inbound (default) | always', required: false },
      { name: 'textChunkLimit', label: 'Text chunk limit (chars)', hint: 'Default: 16000', required: false },
      { name: 'mediaMaxMb', label: 'Media size limit (MB)', hint: 'Default: 10', required: false },
      { name: 'autoJoin', label: 'Auto-join invites', hint: 'always (default) | allowlist | off', required: false }
    ],
    setupSteps: [
      '1. Create a Matrix bot account on any homeserver (matrix.org has free accounts).',
      '2. Get an access token via the login API:',
      '     curl -X POST https://<homeserver>/_matrix/client/v3/login \\',
      '       -H "Content-Type: application/json" \\',
      '       -d \'{"type":"m.login.password","identifier":{"type":"m.id.user","user":"<username>"},"password":"<password>"}\'',
      '   Or set userId + password — HyperClaw will call the login API and cache the token.',
      '3. Invite the bot account to a room or DM it from any Matrix client (Element, Beeper, etc.).',
      '4. For Beeper, enable E2EE: set encryption: true and verify the device in Element.',
      '',
      '  🔗 matrix.org/ecosystem/hosting/ — element.io'
    ],
    status: 'available',
    notes: 'Supports DMs, rooms, threads, media, reactions, polls, location, E2EE, multi-account.',
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
      { name: 'server', label: 'Server (IRC_HOST)', hint: 'e.g. irc.libera.chat', required: true },
      { name: 'port', label: 'Port (IRC_PORT)', hint: 'Default: 6697 (TLS) or 6667', required: false },
      { name: 'tls', label: 'TLS (IRC_TLS)', hint: 'true / false — default: false', required: false },
      { name: 'nick', label: 'Nickname (IRC_NICK)', required: true },
      { name: 'username', label: 'Username / ident (IRC_USERNAME)', required: false },
      { name: 'realname', label: 'Real name (IRC_REALNAME)', required: false },
      { name: 'password', label: 'Server password (IRC_PASSWORD)', hint: 'Not NickServ — leave blank if none', required: false },
      { name: 'channels', label: 'Channels to join (IRC_CHANNELS)', hint: '#room1,#room2', required: false },
      { name: 'nickservPassword', label: 'NickServ password (IRC_NICKSERV_PASSWORD)', hint: 'Identify after connect', required: false },
      { name: 'groupPolicy', label: 'Group policy', hint: '"allowlist" (default) or "open"', required: false },
      { name: 'dmPolicy', label: 'DM policy', hint: '"pairing" (default) | "allowlist" | "open"', required: false }
    ],
    setupSteps: [
      '1. Choose an IRC server (e.g. irc.libera.chat, irc.oftc.net).',
      '2. Set a nickname for the bot and the channels it should join.',
      '3. Enable TLS (recommended): set port 6697 and tls: true.',
      '4. If your nick is registered, set nickservPassword to auto-identify.',
      '5. Access control defaults: groupPolicy=allowlist (bot only replies in',
      '   configured groups), dmPolicy=pairing (new DMs need pairing approval).',
      '6. To allow everyone in a channel without mention, set per-channel:',
      '   groups["#mychan"].requireMention = false, allowFrom = ["*"].',
      '',
      '  Env vars: IRC_HOST IRC_PORT IRC_TLS IRC_NICK IRC_USERNAME',
      '            IRC_REALNAME IRC_PASSWORD IRC_CHANNELS',
      '            IRC_NICKSERV_PASSWORD IRC_NICKSERV_REGISTER_EMAIL',
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
    tokenLabel: 'Bot Token (MATTERMOST_BOT_TOKEN)',
    tokenHint: 'System Console → Integrations → Bot Accounts → Add Bot Account',
    setupSteps: [
      '1. Create a Bot Account: System Console → Integrations → Bot Accounts → Add Bot Account.',
      '2. Copy the bot token shown after creation (not shown again).',
      '3. Note your Mattermost base URL (e.g. https://chat.example.com).',
      '4. The connector uses WebSocket events — no outgoing webhook needed.',
      '5. For slash commands: set commands.native=true and expose callbackUrl.',
      '6. For buttons: add capabilities: ["inlineButtons"] and set interactions.callbackBaseUrl.',
      '',
      '  Env vars: MATTERMOST_BOT_TOKEN  MATTERMOST_URL',
      '',
      '  Chat modes:',
      '    oncall (default) — reply only when @mentioned',
      '    onmessage        — reply to every channel message',
      '    onchar           — reply when message starts with a prefix (e.g. ">", "!")',
      '',
      '  Access control:',
      '    dmPolicy=pairing (default) | allowlist | open | none',
      '    groupPolicy=allowlist (default) | open',
      '    groupAllowFrom=[userId1, ...] — sender gate for channels',
      '',
      '  🔗 docs.mattermost.com — mattermost.com'
    ],
    extraFields: [
      { name: 'baseUrl', label: 'Base URL (MATTERMOST_URL)', hint: 'https://chat.example.com', required: true },
      { name: 'chatmode', label: 'Chat mode', hint: '"oncall" (default) | "onmessage" | "onchar"', required: false },
      { name: 'oncharPrefixes', label: 'onchar prefixes', hint: '>, ! (comma-separated, for chatmode=onchar)', required: false },
      { name: 'dmPolicy', label: 'DM policy', hint: '"pairing" (default) | "open" | "allowlist" | "none"', required: false },
      { name: 'groupPolicy', label: 'Group policy', hint: '"allowlist" (default) | "open"', required: false },
      { name: 'capabilities', label: 'Capabilities', hint: '"inlineButtons" — comma-separated', required: false }
    ],
    status: 'available',
    notes: 'WebSocket + REST. Supports DMs, channels, buttons, reactions, slash commands, multi-account.',
    npmPackage: 'ws'
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
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'App ID (Azure Bot)',
    extraFields: [
      { name: 'appPassword', label: 'App Password (client secret)', hint: 'From Azure Bot → Manage → Certificates & secrets', required: true }
    ],
    setupSteps: [
      '1. Create an Azure Bot: portal.azure.com → Create a resource → Azure Bot',
      '2. Type of App: Single Tenant. Create new Microsoft App ID.',
      '3. Configuration → copy App ID. Manage → Certificates & secrets → New client secret → copy Value (appPassword).',
      '4. Channels → Microsoft Teams → Configure. Set Messaging endpoint: https://<your-host>/webhook/msteams',
      '5. Build a Teams app manifest with botId = App ID. Upload to Teams.',
      '',
      '  🔗 docs/msteams.md — full setup guide'
    ],
    status: 'available',
    notes: 'Bot Framework. Text + DM. Channel/group files require Graph + SharePoint.'
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
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'LINE Channel access token',
    extraFields: [
      { name: 'channelSecret', label: 'Channel Secret', hint: 'From LINE Developers Console → Basic settings', required: true },
      { name: 'tokenFile', label: 'Token file path (optional)', hint: 'Alternative to pasting token directly', required: false },
      { name: 'secretFile', label: 'Secret file path (optional)', hint: 'Alternative to pasting secret directly', required: false },
      { name: 'webhookPath', label: 'Webhook path', hint: 'Default: /line/webhook', required: false },
      { name: 'mediaMaxMb', label: 'Media download limit (MB)', hint: 'Default: 10', required: false },
      { name: 'groupPolicy', label: 'Group policy', hint: 'open | allowlist | disabled (default: allowlist)', required: false }
    ],
    setupSteps: [
      '1. Go to developers.line.biz → Console → Create provider & Messaging API channel.',
      '2. Channel access token: Issue or Regenerate — copy it.',
      '3. Channel secret: from Basic settings — copy it.',
      '4. Enable "Use webhook" in Messaging API settings.',
      '5. Set webhook URL (HTTPS required):',
      '     https://<gateway-host>/line/webhook',
      '6. Paste token + secret below.',
      '',
      '  🔗 developers.line.biz'
    ],
    status: 'available',
    notes: 'Webhook receiver. Supports DMs, groups, media, Flex messages, quick replies, locations.',
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
    emoji: '💬',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Outgoing Webhook Token (SYNOLOGY_CHAT_TOKEN)',
    tokenHint: 'From Synology Chat Integrations Outgoing Webhook',
    extraFields: [
      { name: 'incomingUrl', label: 'Incoming Webhook URL (SYNOLOGY_CHAT_INCOMING_URL)', hint: 'From Synology Chat Integrations Incoming Webhook', required: true },
      { name: 'webhookPath', label: 'Gateway inbound path', hint: '/webhook/synology (default)', required: false },
      { name: 'dmPolicy', label: 'DM policy', hint: '"allowlist" (default) | "open" | "pairing" | "disabled"', required: false },
      { name: 'allowedUserIds', label: 'Allowed user IDs (SYNOLOGY_ALLOWED_USER_IDS)', hint: 'Numeric Synology Chat user IDs, comma-separated', required: false },
      { name: 'rateLimitPerMinute', label: 'Rate limit per sender/min (SYNOLOGY_RATE_LIMIT)', hint: '30 (default)', required: false },
      { name: 'allowInsecureSsl', label: 'Allow insecure SSL', hint: 'false (default) — true only for self-signed NAS certs', required: false }
    ],
    setupSteps: [
      '1. Synology Chat Integrations Incoming Webhook Create copy URL.',
      '2. Synology Chat Integrations Outgoing Webhook Create:',
      '     Outgoing URL: https://<gateway>/webhook/synology',
      '     Copy the generated token.',
      '3. Set token + incomingUrl in config (or env vars).',
      '4. dmPolicy=allowlist requires at least one allowedUserId.',
      '',
      '  Env vars: SYNOLOGY_CHAT_TOKEN  SYNOLOGY_CHAT_INCOMING_URL',
      '            SYNOLOGY_ALLOWED_USER_IDS  SYNOLOGY_RATE_LIMIT  OPENCLAW_BOT_NAME',
      '',
      '  Multi-account: channels.synology-chat.accounts.{ default, alerts }',
      '  Targets: <numericId>, synology-chat:<id>, user:<id>',
      '',
      '  🔗 kb.synology.com'
    ],
    status: 'available',
    notes: 'Gateway webhooks. Token verify, rate limiting, multi-account, allowInsecureSsl.'
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
      { name: 'username', label: 'Bot username', required: true },
      { name: 'channels', label: 'Channels (comma-separated)', hint: 'vevisk,secondchannel', required: true },
      { name: 'commandPrefix', label: 'Command prefix', hint: '! (default)', required: false }
    ],
    setupSteps: [
      '1. Create Twitch bot account. Generate OAuth: twitchapps.com/tmi',
      '2. Config: username, oauthToken, channels (required).',
      '3. Add allowFrom (recommended) to restrict who can trigger.',
      '4. Public chat: prefix required (default !). Whispers: no prefix.',
      '',
      '  🔗 docs/twitch.md — dev.twitch.tv'
    ],
    status: 'available',
    notes: 'IRC over WebSocket. Channel chat + whispers. Pairing, allowlist, modsBypass.'
  },
  {
    id: 'tlon',
    name: 'Tlon (Urbit Groups)',
    emoji: '🌊',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Login Code',
    tokenHint: 'Ship login code from Landscape → Settings → Access key (e.g. lidlut-tabwed-pillex-ridrup)',
    extraFields: [
      { name: 'ship', label: 'Ship Name', hint: 'e.g. ~sampel-palnet', required: true },
      { name: 'url', label: 'Ship URL', hint: 'e.g. https://sampel-palnet.tlon.network or http://localhost:8080', required: true },
      { name: 'ownerShip', label: 'Owner Ship', hint: 'Your personal ship — always authorized, receives approval notifications', required: false },
      { name: 'allowPrivateNetwork', label: 'Allow Private Network', hint: 'Enable for localhost/LAN ships (SSRF opt-in)', required: false }
    ],
    setupSteps: [
      '1. Install plugin: hyperclaw plugins install @hyperclaw/extension-tlon',
      '2. Get your ship login code from Landscape (Settings → System → Access key).',
      '3. Configure channels.tlon with ship name, URL, and login code.',
      '4. Optionally set ownerShip to receive approval notifications.',
      '5. Restart gateway: hyperclaw gateway restart',
      '6. DM the bot ship in Tlon or mention it in a group channel.',
      '',
      '  Plugin required — connects via Urbit Eyre HTTP API + SSE stream.',
      '  See: docs/tlon.md'
    ],
    status: 'available',
    notes: 'Urbit Eyre HTTP API + SSE. DMs, groups, reactions, owner approval, auto-discovery. Plugin: @hyperclaw/extension-tlon'
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
    id: 'nextcloud-talk',
    name: 'Nextcloud Talk',
    emoji: '☁️',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Nextcloud instance URL',
    tokenHint: 'e.g. https://cloud.example.com',
    extraFields: [
      { name: 'botSecret', label: 'Bot shared secret', hint: 'From: occ talk:bot:install', required: true },
      { name: 'botSecretFile', label: 'Bot secret file path (optional)', hint: 'Alternative to inline secret', required: false },
      { name: 'apiUser', label: 'API username (optional)', hint: 'For DM detection + fallback send via OCS API', required: false },
      { name: 'apiPassword', label: 'API/app password (optional)', hint: 'Nextcloud app password for apiUser', required: false },
      { name: 'webhookPort', label: 'Webhook listener port', hint: 'Default: 8788', required: false },
      { name: 'webhookPath', label: 'Webhook path', hint: 'Default: /nextcloud-talk-webhook', required: false },
      { name: 'webhookPublicUrl', label: 'Webhook public URL', hint: 'If behind a proxy — set this in occ talk:bot:install', required: false },
      { name: 'groupPolicy', label: 'Room policy', hint: 'allowlist (default) | open | disabled', required: false },
      { name: 'textChunkLimit', label: 'Text chunk limit (chars)', hint: 'Default: 32000', required: false }
    ],
    setupSteps: [
      '1. On your Nextcloud server, create the bot:',
      '     ./occ talk:bot:install "HyperClaw" "<shared-secret>" "<webhook-url>" --feature reaction',
      '   Replace <webhook-url> with your gateway URL, e.g. https://yourhost/nextcloud-talk-webhook',
      '2. Enable the bot in the target room settings (room → ⋯ → Bots).',
      '3. Enter the Nextcloud URL (token field) and the shared secret below.',
      '4. (Optional) Add apiUser + app password to enable DM detection via OCS API.',
      '',
      '  🔗 nextcloud.com — docs.nextcloud.com/server/latest/admin_manual/talk_bots.html'
    ],
    status: 'available',
    notes: 'Webhook bot. Supports DMs (with apiUser), rooms, reactions. No media uploads.'
  },
  {
    id: 'zalo',
    name: 'Zalo',
    emoji: '🔵',
    requiresGateway: true,
    supportsDM: true,
    platforms: ['all'],
    tokenLabel: 'Zalo Bot Token (12345689:abc-xyz)',
    tokenHint: 'From bot.zaloplatforms.com',
    extraFields: [
      { name: 'tokenFile', label: 'Token file path (optional)', hint: 'Alternative to inline token', required: false },
      { name: 'groupPolicy', label: 'Group policy', hint: 'allowlist (default) | open | disabled', required: false },
      { name: 'webhookUrl', label: 'Webhook URL (optional)', hint: 'HTTPS required — leave blank for long-polling', required: false },
      { name: 'webhookSecret', label: 'Webhook secret (optional)', hint: '8-256 chars — required if webhookUrl is set', required: false },
      { name: 'mediaMaxMb', label: 'Media size limit (MB)', hint: 'Default: 5', required: false }
    ],
    setupSteps: [
      '1. Go to https://bot.zaloplatforms.com and sign in.',
      '2. Create a new bot and configure its settings.',
      '3. Copy the bot token (format: 12345689:abc-xyz).',
      '4. Paste the token below.',
      '5. (Optional) Set webhookUrl for webhook mode (HTTPS required).',
      '   Leave blank to use long-polling (no public URL needed).',
      '',
      '  🔗 bot.zaloplatforms.com'
    ],
    status: 'available',
    notes: 'Experimental. DMs supported; groups with allowlist policy. Long-polling by default.'
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
  tokenLabel: 'Cookie (from chat.zalo.me)',
  tokenHint: 'DevTools → Application → Cookies',
  extraFields: [
    { name: 'dmPolicy', label: 'DM policy', hint: 'pairing (default) | allowlist | open | disabled', required: false }
  ],
  setupSteps: [
    '1. ⚠️ Experimental — unofficial. Account ban risk. Use at your own risk.',
    '2. Open chat.zalo.me, log in. DevTools → Application → Cookies → copy.',
    '3. Add channel, set cookie (or ZALO_PERSONAL_COOKIE env).',
    '4. hyperclaw gateway → hyperclaw pairing approve zalo-personal <CODE>',
    '',
    '  🔗 docs/zalo-personal.md — full setup'
  ],
  status: 'available',
  notes: 'Zalo Web cookie auth. DMs only. No groups. Text chunked ~2000 chars.'
};

// Add to CHANNELS array
CHANNELS.push(ZALO_PERSONAL);
