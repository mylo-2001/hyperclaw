/**
 * src/infra/channel-icons.ts
 * Real icons for all channels and AI providers.
 *
 * Source: Simple Icons CDN (simpleicons.org) — free, no API key, no hotlinking restrictions.
 * URL format: https://cdn.simpleicons.org/{slug}[/{hex-color}]
 *
 * Usage:
 *   import { channelIcon, providerIcon, iconUrl } from '../infra/channel-icons';
 *   channelIcon('telegram')          // → { slug, name, color, url }
 *   iconUrl('telegram', 'ffffff')    // → "https://cdn.simpleicons.org/telegram/ffffff"
 *
 * In the web dashboard (apps/web), use the url field directly in <img> tags.
 * In the terminal wizard, use the emoji field from channels.ts — SVGs can't render there.
 */

export interface ChannelIcon {
  /** Simple Icons slug — used in CDN URL */
  slug: string;
  /** Human-readable name */
  name: string;
  /** Official brand hex color (no #) */
  color: string;
  /** CDN URL for the SVG icon */
  url: string;
  /** Optional: dark-mode friendly alternative color */
  darkColor?: string;
}

const CDN = 'https://cdn.simpleicons.org';

function icon(slug: string, name: string, color: string, darkColor?: string): ChannelIcon {
  return { slug, name, color, url: `${CDN}/${slug}`, darkColor };
}

// ── Channel icons ─────────────────────────────────────────────────────────────

export const CHANNEL_ICONS: Record<string, ChannelIcon> = {
  'telegram':          icon('telegram',        'Telegram',           '26A5E4'),
  'discord':           icon('discord',         'Discord',            '5865F2'),
  'whatsapp':          icon('whatsapp',        'WhatsApp',           '25D366'),
  'whatsapp-baileys':  icon('whatsapp',        'WhatsApp (Baileys)', '25D366'),
  'slack':             icon('slack',           'Slack',              '4A154B'),
  'signal':            icon('signal',          'Signal',             '3A76F0', 'FFFFFF'),
  'imessage':          icon('imessage',        'iMessage',           '29CC40'),
  'imessage-native':   icon('imessage',        'iMessage (native)',  '29CC40'),
  'matrix':            icon('matrix',          'Matrix',             '000000', 'FFFFFF'),
  'email':             icon('gmail',           'Email',              'EA4335'),
  'feishu':            icon('lark',            'Feishu / Lark',      '00D6B9'),
  'msteams':           icon('microsoftteams',  'Microsoft Teams',    '6264A7'),
  'messenger':         icon('messenger',       'Facebook Messenger', '00B2FF'),
  'nostr':             icon('nostr',           'Nostr',              '8E44AD', 'C39BD3'),
  'line':              icon('line',            'LINE',               '00C300'),
  'viber':             icon('viber',           'Viber',              '7360F2'),
  'zalo':              icon('zalo',            'Zalo',               '0068FF'),
  'zalo-personal':     icon('zalo',            'Zalo Personal',      '0068FF'),
  'twitter':           icon('x',              'Twitter / X',        '000000', 'FFFFFF'),
  'irc':               icon('irc',             'IRC',                '1A3B5C', 'FFFFFF'),
  'mattermost':        icon('mattermost',      'Mattermost',         '0058CC'),
  'nextcloud':         icon('nextcloud',       'Nextcloud Talk',     '0082C9'),
  'googlechat':        icon('googlechat',      'Google Chat',        '00897B'),
  'instagram':         icon('instagram',       'Instagram',          'E4405F'),
  'synology-chat':     icon('synology',        'Synology Chat',      'B5B5B6', 'FFFFFF'),
  'tlon':              icon('urbit',           'Tlon (Urbit)',       '000000', 'FFFFFF'),
  'twitch':            icon('twitch',          'Twitch',             '9146FF'),
  'voice-call':        icon('webrtc',          'Voice Call',         '333333', 'FFFFFF'),
  'web':               icon('googlechrome',    'WebChat',            '4285F4'),
  'cli':               icon('gnubash',        'CLI / Terminal',     '4EAA25', 'FFFFFF'),
  'chrome-extension':  icon('googlechrome',    'Chrome Extension',   '4285F4'),
};

// ── AI Provider icons ─────────────────────────────────────────────────────────

export const PROVIDER_ICONS: Record<string, ChannelIcon> = {
  'anthropic':   icon('anthropic',   'Anthropic (Claude)',  'D4C5A9', '191919'),
  'openai':      icon('openai',      'OpenAI',             '000000', 'FFFFFF'),
  'openrouter':  icon('openrouter',  'OpenRouter',         '6467F2'),
  'groq':        icon('groq',        'Groq',               'F55036'),
  'xai':         icon('x',          'xAI (Grok)',         '000000', 'FFFFFF'),
  'custom':      icon('jsonwebtokens','Custom OpenAI API', 'A0A0A0'),
  'ollama':      icon('ollama',      'Ollama (local)',     '000000', 'FFFFFF'),
  'mistral':     icon('mistral',     'Mistral AI',         'FF7000'),
  'cohere':      icon('cohere',      'Cohere',             '39594D', 'FFFFFF'),
  'google':      icon('googlegemini','Google Gemini',      '8E75B2'),
  'deepseek':    icon('deepseek',    'DeepSeek',           '4D6BFE'),
  'together':    icon('togetherai',  'Together AI',        '000000', 'FFFFFF'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the icon for a channel ID, or a generic fallback.
 * Safe to call with any string — never throws.
 */
export function channelIcon(channelId: string): ChannelIcon {
  return CHANNEL_ICONS[channelId] ?? icon('chatbot', channelId, '888888');
}

/**
 * Returns the icon for an AI provider ID.
 */
export function providerIcon(providerId: string): ChannelIcon {
  return PROVIDER_ICONS[providerId] ?? icon('openai', providerId, '888888');
}

/**
 * Returns a CDN URL for the icon with an optional custom hex color.
 * @param idOrSlug  Channel ID, provider ID, or raw Simple Icons slug
 * @param hexColor  Optional override color (no #), defaults to brand color
 */
export function iconUrl(idOrSlug: string, hexColor?: string): string {
  const ch = CHANNEL_ICONS[idOrSlug] ?? PROVIDER_ICONS[idOrSlug];
  const slug = ch?.slug ?? idOrSlug;
  return hexColor ? `${CDN}/${slug}/${hexColor}` : `${CDN}/${slug}`;
}

/**
 * Returns an <img> tag string for use in HTML templates.
 * @param channelId  Channel or provider ID
 * @param size       Pixel size (default 24)
 * @param color      Optional hex override
 */
export function iconImg(channelId: string, size = 24, color?: string): string {
  const ic = CHANNEL_ICONS[channelId] ?? PROVIDER_ICONS[channelId];
  const slug = ic?.slug ?? channelId;
  const hex = color ?? ic?.color ?? '888888';
  const url = `${CDN}/${slug}/${hex}`;
  return `<img src="${url}" width="${size}" height="${size}" alt="${ic?.name ?? channelId}" style="vertical-align:middle">`;
}

/**
 * All channel icon entries as an array — useful for rendering icon grids.
 */
export function allChannelIcons(): Array<ChannelIcon & { channelId: string }> {
  return Object.entries(CHANNEL_ICONS).map(([channelId, ic]) => ({ channelId, ...ic }));
}

/**
 * All provider icon entries as an array.
 */
export function allProviderIcons(): Array<ChannelIcon & { providerId: string }> {
  return Object.entries(PROVIDER_ICONS).map(([providerId, ic]) => ({ providerId, ...ic }));
}
