/**
 * extensions/irc/src/connector.ts
 * IRC connector — TLS, NickServ, groupPolicy, per-channel groups,
 * requireMention, toolsBySender, env-var fallbacks.
 */

import irc from 'irc';
import chalk from 'chalk';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Tool-policy types
// ---------------------------------------------------------------------------

export interface ToolPolicy {
  allow?: string[];
  deny?: string[];
}

export interface ToolsBySender {
  [senderPattern: string]: ToolPolicy;
}

// ---------------------------------------------------------------------------
// Per-channel group config
// ---------------------------------------------------------------------------

export interface IrcChannelGroupConfig {
  /** Who may trigger the bot in this channel ('*' = anyone). */
  allowFrom?: string[];
  /** If false, bot replies without needing a mention. Default: true */
  requireMention?: boolean;
  /** Tools allowed/denied for everyone in the channel. */
  tools?: ToolPolicy;
  /** Per-sender tool overrides. Keys: 'id:<nick>' or '*'. First match wins. */
  toolsBySender?: ToolsBySender;
}

// ---------------------------------------------------------------------------
// NickServ config
// ---------------------------------------------------------------------------

export interface NickServConfig {
  enabled?: boolean;
  service?: string;
  password?: string;
  register?: boolean;
  registerEmail?: string;
}

// ---------------------------------------------------------------------------
// Main IrcConfig
// ---------------------------------------------------------------------------

export interface IrcConfig {
  /** IRC server hostname. Env: IRC_HOST */
  server: string;
  /** Server port. Env: IRC_PORT. Default: tls ? 6697 : 6667 */
  port?: number;
  /** Enable TLS. Env: IRC_TLS. Default: false */
  tls?: boolean;
  /** Bot nick. Env: IRC_NICK */
  nick: string;
  /** IRC username (ident). Env: IRC_USERNAME */
  username?: string;
  /** Real name. Env: IRC_REALNAME */
  realname?: string;
  /** Server password (not NickServ). Env: IRC_PASSWORD */
  password?: string;
  /** Channels to join on connect. Env: IRC_CHANNELS (comma-separated) */
  channels?: string[];

  /** DM access policy. Default: 'pairing' */
  dmPolicy?: 'open' | 'allowlist' | 'pairing';
  /** Allowed DM senders (nick!user@host or bare nick). */
  allowFrom?: string[];

  /**
   * Whether unconfigured channels are accepted.
   * 'open'      = any channel the bot joins is accepted.
   * 'allowlist' = only channels listed in groups{} are accepted. Default.
   */
  groupPolicy?: 'open' | 'allowlist';

  /** Global sender allowlist applied to all channels. */
  groupAllowFrom?: string[];

  /** Per-channel overrides. Key: '#channel' or '*' (wildcard for groupPolicy=open). */
  groups?: Record<string, IrcChannelGroupConfig>;

  /** NickServ authentication. Env: IRC_NICKSERV_PASSWORD */
  nickserv?: NickServConfig;

  /**
   * Allow bare nick matching in allowFrom (mutable — not recommended).
   * Default: false (use nick!user@host stable identities).
   */
  dangerouslyAllowNameMatching?: boolean;
}

// ---------------------------------------------------------------------------
// Message event payload
// ---------------------------------------------------------------------------

export interface IrcMessage {
  chatId: string;
  text: string;
  from: string;
  to: string;
  isChannel: boolean;
  /** Resolved tool policy for this sender+channel combination (if any). */
  toolPolicy?: ToolPolicy;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEnvConfig(cfg: IrcConfig): IrcConfig {
  return {
    server: cfg.server || process.env['IRC_HOST'] || '',
    port: cfg.port ?? (process.env['IRC_PORT'] ? parseInt(process.env['IRC_PORT']!, 10) : undefined),
    tls: cfg.tls ?? (process.env['IRC_TLS'] === 'true' || process.env['IRC_TLS'] === '1'),
    nick: cfg.nick || process.env['IRC_NICK'] || 'hyperclaw-bot',
    username: cfg.username || process.env['IRC_USERNAME'],
    realname: cfg.realname || process.env['IRC_REALNAME'],
    password: cfg.password || process.env['IRC_PASSWORD'],
    channels: cfg.channels?.length
      ? cfg.channels
      : process.env['IRC_CHANNELS']?.split(',').map(c => c.trim()).filter(Boolean) ?? [],
    nickserv: cfg.nickserv ?? (process.env['IRC_NICKSERV_PASSWORD']
      ? {
          enabled: true,
          service: 'NickServ',
          password: process.env['IRC_NICKSERV_PASSWORD'],
          registerEmail: process.env['IRC_NICKSERV_REGISTER_EMAIL']
        }
      : undefined),
    dmPolicy: cfg.dmPolicy ?? 'pairing',
    allowFrom: cfg.allowFrom ?? [],
    groupPolicy: cfg.groupPolicy ?? 'allowlist',
    groupAllowFrom: cfg.groupAllowFrom ?? [],
    groups: cfg.groups ?? {},
    dangerouslyAllowNameMatching: cfg.dangerouslyAllowNameMatching ?? false
  };
}

/** Match a sender (nick!user@host or bare nick) against an allowFrom entry. */
function matchSender(sender: string, pattern: string, allowBareNick: boolean): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('id:')) {
    const id = pattern.slice(3);
    return sender === id || sender.startsWith(id + '!');
  }
  if (pattern === sender) return true;
  if (allowBareNick) {
    const nick = sender.split('!')[0];
    return nick === pattern;
  }
  return false;
}

function senderAllowed(sender: string, allowList: string[], allowBareNick: boolean): boolean {
  if (!allowList.length) return false;
  return allowList.some(p => matchSender(sender, p, allowBareNick));
}

/** Return the first matching ToolsBySender policy for a sender. */
function resolveToolsBySender(sender: string, toolsBySender: ToolsBySender, allowBareNick: boolean): ToolPolicy | undefined {
  for (const [pattern, policy] of Object.entries(toolsBySender)) {
    const pat = pattern.startsWith('id:') ? pattern : `id:${pattern}`;
    if (matchSender(sender, pat === 'id:*' ? '*' : pat, allowBareNick)) {
      return policy;
    }
  }
  return undefined;
}

/** Resolve effective tool policy for a sender in a channel. */
function resolveToolPolicy(
  sender: string,
  channelCfg: IrcChannelGroupConfig | undefined,
  allowBareNick: boolean
): ToolPolicy | undefined {
  if (!channelCfg) return undefined;
  if (channelCfg.toolsBySender) {
    const byS = resolveToolsBySender(sender, channelCfg.toolsBySender, allowBareNick);
    if (byS) return byS;
  }
  return channelCfg.tools;
}

/** Find the best group config for a channel name. */
function getGroupConfig(
  channel: string,
  groups: Record<string, IrcChannelGroupConfig>
): IrcChannelGroupConfig | undefined {
  return groups[channel] ?? groups['*'];
}

// ---------------------------------------------------------------------------
// IrcConnector
// ---------------------------------------------------------------------------

export class IrcConnector extends EventEmitter {
  private client: irc.Client | null = null;
  config: IrcConfig;

  constructor(rawConfig: IrcConfig) {
    super();
    this.config = resolveEnvConfig(rawConfig);
  }

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cfg = this.config;
      const useTls = cfg.tls ?? false;
      const port = cfg.port ?? (useTls ? 6697 : 6667);

      const channels = (cfg.channels ?? []).map(c => c.startsWith('#') ? c : `#${c}`);

      this.client = new irc.Client(cfg.server, cfg.nick, {
        port,
        secure: useTls,
        channels,
        userName: cfg.username ?? cfg.nick,
        realName: cfg.realname ?? 'HyperClaw IRC Bot',
        password: cfg.password,
        autoConnect: true,
        debug: false,
        showErrors: true,
        stripColors: true
      });

      // ----- registered → NickServ -----
      this.client.on('registered', () => {
        console.log(chalk.green(`  🦅 IRC: ${cfg.nick} on ${cfg.server}:${port}${useTls ? ' (TLS)' : ''} connected`));
        this._handleNickServ();
        this.emit('connected', { server: cfg.server, nick: cfg.nick, port, tls: useTls });
        resolve();
      });

      this.client.on('error', (err: Error) => {
        console.log(chalk.yellow(`  ⚠ IRC error: ${err.message}`));
        reject(err);
      });

      // ----- channel messages -----
      this.client.on('message', (from: string, to: string, message: string) => {
        const isChannel = to.startsWith('#');
        if (isChannel) {
          this._handleChannelMessage(from, to, message);
        } else {
          this._handleDm(from, message);
        }
      });

      // ----- explicit PM event (some irc libs fire both) -----
      this.client.on('pm', (from: string, message: string) => {
        this._handleDm(from, message);
      });
    });
  }

  // -------------------------------------------------------------------------
  // NickServ
  // -------------------------------------------------------------------------

  private _handleNickServ(): void {
    const ns = this.config.nickserv;
    if (!ns?.enabled) return;
    const service = ns.service ?? 'NickServ';
    const nsPassword = ns.password ?? process.env['IRC_NICKSERV_PASSWORD'];

    if (ns.register && ns.registerEmail) {
      console.log(chalk.gray(`  IRC NickServ: attempting REGISTER`));
      this.client!.say(service, `REGISTER ${nsPassword} ${ns.registerEmail}`);
    } else if (nsPassword) {
      console.log(chalk.gray(`  IRC NickServ: identifying`));
      this.client!.say(service, `IDENTIFY ${nsPassword}`);
    }
  }

  // -------------------------------------------------------------------------
  // Channel message gate
  // -------------------------------------------------------------------------

  private _handleChannelMessage(from: string, channel: string, message: string): void {
    const cfg = this.config;
    const text = message.trim();
    if (!text) return;

    const groupCfg = getGroupConfig(channel, cfg.groups ?? {});

    // --- Channel gate (groupPolicy) ---
    if (cfg.groupPolicy === 'allowlist') {
      const defined = cfg.groups && (cfg.groups[channel] !== undefined || cfg.groups['*'] !== undefined);
      if (!defined) {
        console.log(chalk.gray(`  irc: drop channel ${channel} (groupPolicy=allowlist, not in groups)`));
        return;
      }
    }

    // --- Sender gate ---
    const allowBareNick = cfg.dangerouslyAllowNameMatching ?? false;

    // Build effective allowFrom: per-channel > global groupAllowFrom
    const perChannelAllow = groupCfg?.allowFrom ?? [];
    const globalGroupAllow = cfg.groupAllowFrom ?? [];
    const effectiveAllow = perChannelAllow.length ? perChannelAllow : globalGroupAllow;

    if (effectiveAllow.length && !senderAllowed(from, effectiveAllow, allowBareNick)) {
      console.log(chalk.gray(`  irc: drop group sender ${from} (policy=allowlist)`));
      return;
    }

    // --- Mention gate (requireMention defaults to true) ---
    const requireMention = groupCfg?.requireMention ?? true;
    if (requireMention) {
      const mentionPatterns = [
        cfg.nick,
        `${cfg.nick}:`,
        `@${cfg.nick}`,
        `${cfg.nick},`
      ];
      const mentioned = mentionPatterns.some(p => text.toLowerCase().startsWith(p.toLowerCase()));
      if (!mentioned) {
        console.log(chalk.gray(`  irc: drop channel ${channel} (missing-mention)`));
        return;
      }
    }

    const toolPolicy = resolveToolPolicy(from, groupCfg, allowBareNick);

    const payload: IrcMessage = {
      chatId: channel,
      text,
      from,
      to: channel,
      isChannel: true,
      ...(toolPolicy ? { toolPolicy } : {})
    };
    this.emit('message', payload);
  }

  // -------------------------------------------------------------------------
  // DM gate
  // -------------------------------------------------------------------------

  private _handleDm(from: string, message: string): void {
    const cfg = this.config;
    const text = message.trim();
    if (!text) return;

    if ((cfg.dmPolicy as string) === 'none') return;

    if (cfg.dmPolicy === 'allowlist') {
      const allowBareNick = cfg.dangerouslyAllowNameMatching ?? false;
      const allowList = cfg.allowFrom ?? [];
      if (!senderAllowed(from, allowList, allowBareNick)) {
        console.log(chalk.gray(`  irc: drop DM from ${from} (dmPolicy=allowlist)`));
        return;
      }
    }

    const payload: IrcMessage = {
      chatId: from,
      text,
      from,
      to: from,
      isChannel: false
    };
    this.emit('message', payload);
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('IRC not connected');
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      this.client.say(chatId, line);
    }
  }

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  // -------------------------------------------------------------------------
  // Utility: get effective tool policy for a sender/channel (for gateway use)
  // -------------------------------------------------------------------------

  getToolPolicy(sender: string, channel: string): ToolPolicy | undefined {
    const groupCfg = getGroupConfig(channel, this.config.groups ?? {});
    return resolveToolPolicy(sender, groupCfg, this.config.dangerouslyAllowNameMatching ?? false);
  }
}
