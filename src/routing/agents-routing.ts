/**
 * src/routing/agents-routing.ts
 * Multi-agent routing — deterministic channel → agent resolution.
 *
 * Routing priority (first match wins):
 *   1. Exact peer match        (peer.kind + peer.id)
 *   2. Parent peer match       (thread → parent peer)
 *   3. Guild + roles match     (Discord: guildId + roles)
 *   4. Guild match             (Discord: guildId)
 *   5. Team match              (Slack: teamId)
 *   6. Account match           (accountId on channel)
 *   7. Channel match           (any account: accountId "*")
 *   8. Default agent           (agents.list[].default, else first, else "main")
 *
 * Multi-field bindings: all provided match fields must match.
 * Broadcast groups: run multiple agents for the same peer.
 * Session keys: see session-key.ts.
 * DM scope pinning: skip lastRoute update for non-owner DMs when allowFrom has
 *                   exactly one non-wildcard entry.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { computeSessionKey, SessionContext } from './session-key';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface PeerMatch {
  kind: 'dm' | 'group' | 'channel' | 'room';
  id: string;
}

export interface BindingMatch {
  channel?: string;
  accountId?: string;
  /** Exact peer (group, DM, channel) */
  peer?: PeerMatch;
  /** Discord guild ID */
  guildId?: string;
  /** Discord roles (all must match) */
  roles?: string[];
  /** Slack team ID */
  teamId?: string;
}

export interface AgentBinding {
  match: BindingMatch;
  agentId: string;
  createdAt?: string;
}

export interface AgentDef {
  id: string;
  name: string;
  workspace: string;
  model?: string;
  /** Mark as default agent for fallback routing */
  default?: boolean;
}

export interface BroadcastConfig {
  strategy: 'parallel' | 'sequential';
  /** Map of peerId → agentId[] */
  [peerId: string]: string[] | 'parallel' | 'sequential';
}

export interface RoutingConfig {
  agents: {
    list: AgentDef[];
  };
  bindings?: AgentBinding[];
  broadcast?: BroadcastConfig;
  /** session.dmScope: 'main' collapses all DMs to one session */
  session?: {
    dmScope?: 'main' | 'isolated';
    store?: string;
  };
  channels?: Record<string, {
    defaultAccount?: string;
    allowFrom?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Inbound message context
// ---------------------------------------------------------------------------

export interface InboundMessageContext {
  channel: string;
  accountId?: string;
  peer: PeerMatch;
  isDM: boolean;
  senderId: string;
  /** Discord guild ID */
  guildId?: string;
  /** Discord roles of sender */
  roles?: string[];
  /** Slack team ID */
  teamId?: string;
  /** Thread ID (Slack/Discord) */
  threadId?: string;
  /** Telegram forum topic ID */
  topicId?: string;
  /** Parent peer for thread inheritance */
  parentPeer?: PeerMatch;
}

// ---------------------------------------------------------------------------
// Routing result
// ---------------------------------------------------------------------------

export interface RouteResult {
  agentId: string;
  agentDef: AgentDef;
  sessionKey: string;
  matchedBy: string;
  /** Additional agents for broadcast */
  broadcast?: string[];
  /** Whether to skip updating main session lastRoute (DM pinning) */
  skipLastRoute?: boolean;
}

// ---------------------------------------------------------------------------
// AgentRouter
// ---------------------------------------------------------------------------

const STATE_FILE = path.join(os.homedir(), '.hyperclaw', 'routing.json');
const DEFAULT_AGENT: AgentDef = {
  id: 'main',
  name: 'main',
  workspace: path.join(os.homedir(), '.hyperclaw', 'workspace'),
  default: true
};

export class AgentRouter {
  private config: RoutingConfig;

  constructor(config?: RoutingConfig) {
    this.config = config ?? this._loadConfig();
  }

  private _loadConfig(): RoutingConfig {
    try {
      return fs.readJsonSync(STATE_FILE) as RoutingConfig;
    } catch {
      return {
        agents: { list: [DEFAULT_AGENT] },
        bindings: [],
        session: { dmScope: 'main' }
      };
    }
  }

  private _saveConfig(): void {
    fs.ensureDirSync(path.dirname(STATE_FILE));
    fs.writeJsonSync(STATE_FILE, this.config, { spaces: 2 });
  }

  // ---- Main routing entry point -------------------------------------------

  route(msg: InboundMessageContext): RouteResult {
    const agents = this.config.agents?.list ?? [DEFAULT_AGENT];
    const bindings = this.config.bindings ?? [];

    // ── 1. Check broadcast groups ─────────────────────────────────────────
    const broadcastAgents = this._resolveBroadcast(msg);

    // ── 2. Match bindings ─────────────────────────────────────────────────
    const matched = this._matchBinding(msg, bindings, agents);

    const agentDef = matched.agentDef;
    const sessionKey = this._computeKey(msg, agentDef.id);

    // ── 3. DM scope pinning ───────────────────────────────────────────────
    const skipLastRoute = msg.isDM ? this._shouldSkipLastRoute(msg) : false;

    return {
      agentId: agentDef.id,
      agentDef,
      sessionKey,
      matchedBy: matched.matchedBy,
      ...(broadcastAgents.length > 1 ? { broadcast: broadcastAgents } : {}),
      ...(skipLastRoute ? { skipLastRoute: true } : {})
    };
  }

  // ---- Binding matching ---------------------------------------------------

  private _matchBinding(
    msg: InboundMessageContext,
    bindings: AgentBinding[],
    agents: AgentDef[]
  ): { agentDef: AgentDef; matchedBy: string } {
    const find = (id: string) => agents.find(a => a.id === id) ?? DEFAULT_AGENT;

    for (const b of bindings) {
      if (!this._matchesFilter(msg, b.match)) continue;
      return { agentDef: find(b.agentId), matchedBy: this._describeMatch(b.match) };
    }

    // Fallback: default agent
    const defaultAgent = agents.find(a => a.default) ?? agents[0] ?? DEFAULT_AGENT;
    return { agentDef: defaultAgent, matchedBy: 'default' };
  }

  private _matchesFilter(msg: InboundMessageContext, match: BindingMatch): boolean {
    // Channel must match if specified
    if (match.channel && match.channel !== msg.channel) return false;

    // Account must match if specified
    if (match.accountId && match.accountId !== '*' && match.accountId !== msg.accountId) return false;

    // Peer exact match
    if (match.peer) {
      if (match.peer.kind !== msg.peer.kind) return false;
      if (match.peer.id !== msg.peer.id) return false;
    }

    // Guild + roles (Discord): all provided roles must be present
    if (match.guildId && match.guildId !== msg.guildId) return false;
    if (match.roles?.length) {
      const senderRoles = msg.roles ?? [];
      if (!match.roles.every(r => senderRoles.includes(r))) return false;
    }

    // Team (Slack)
    if (match.teamId && match.teamId !== msg.teamId) return false;

    return true;
  }

  private _describeMatch(m: BindingMatch): string {
    const parts: string[] = [];
    if (m.channel) parts.push(`channel=${m.channel}`);
    if (m.peer) parts.push(`peer=${m.peer.kind}:${m.peer.id}`);
    if (m.guildId) parts.push(`guild=${m.guildId}`);
    if (m.teamId) parts.push(`team=${m.teamId}`);
    if (m.accountId) parts.push(`account=${m.accountId}`);
    return parts.join(' ') || 'channel-match';
  }

  // ---- Session key --------------------------------------------------------

  private _computeKey(msg: InboundMessageContext, agentId: string): string {
    const dmScope = this.config.session?.dmScope ?? 'main';
    const ctx: SessionContext = {
      agentId,
      channel: msg.channel,
      peerKind: msg.isDM ? 'dm' : msg.peer.kind,
      peerId: msg.peer.id,
      threadId: msg.threadId,
      topicId: msg.topicId,
      dmScope: msg.isDM ? dmScope : undefined
    };
    return computeSessionKey(ctx);
  }

  // ---- Broadcast groups ---------------------------------------------------

  private _resolveBroadcast(msg: InboundMessageContext): string[] {
    const bc = this.config.broadcast;
    if (!bc) return [];
    const agentIds = bc[msg.peer.id] ?? bc[msg.senderId];
    if (Array.isArray(agentIds)) return agentIds;
    return [];
  }

  // ---- DM scope pinning ---------------------------------------------------

  /**
   * Returns true when the inbound DM sender is not the pinned owner.
   * Pinned owner = the single non-wildcard allowFrom entry for this channel.
   */
  private _shouldSkipLastRoute(msg: InboundMessageContext): boolean {
    const chanCfg = this.config.channels?.[msg.channel];
    if (!chanCfg?.allowFrom) return false;
    const nonWild = chanCfg.allowFrom.filter(id => id !== '*' && id !== '**');
    if (nonWild.length !== 1) return false;
    const pinnedOwner = nonWild[0];
    return msg.senderId !== pinnedOwner;
  }

  // ---- Effective account for a channel ------------------------------------

  resolveDefaultAccount(channelId: string): string | undefined {
    return this.config.channels?.[channelId]?.defaultAccount;
  }

  // ---- CLI — listBindings -------------------------------------------------

  listBindings(): void {
    const agents = this.config.agents?.list ?? [];
    const bindings = this.config.bindings ?? [];

    console.log(chalk.bold.cyan('\n  🦅 AGENT BINDINGS\n'));

    if (agents.length === 0) {
      console.log(chalk.gray('  No agents configured.\n'));
      return;
    }

    // Show agents
    for (const a of agents) {
      const def = a.default ? chalk.green(' [default]') : '';
      const model = a.model ? chalk.gray(` model:${a.model}`) : '';
      console.log(`  ${chalk.bold(a.id)}${def}  ${chalk.gray(a.workspace)}${model}`);
    }
    console.log();

    // Show bindings
    if (bindings.length === 0) {
      console.log(chalk.gray('  No explicit bindings — all traffic → default agent.\n'));
      return;
    }

    console.log(chalk.bold('  Bindings:\n'));
    for (const b of bindings) {
      const m = b.match;
      const parts: string[] = [];
      if (m.channel) parts.push(chalk.cyan(m.channel));
      if (m.peer) parts.push(`peer:${m.peer.kind}/${chalk.white(m.peer.id)}`);
      if (m.guildId) parts.push(`guild:${chalk.white(m.guildId)}`);
      if (m.teamId) parts.push(`team:${chalk.white(m.teamId)}`);
      if (m.roles?.length) parts.push(`roles:[${m.roles.join(',')}]`);
      if (m.accountId) parts.push(`account:${m.accountId}`);
      console.log(`  ${parts.join('  ')} ${chalk.gray('→')} ${chalk.bold(b.agentId)}`);
    }

    // Show broadcast groups
    const bc = this.config.broadcast;
    if (bc) {
      console.log(chalk.bold('\n  Broadcast groups:\n'));
      const strat = bc.strategy ?? 'parallel';
      for (const [peerId, agents] of Object.entries(bc)) {
        if (peerId === 'strategy') continue;
        if (Array.isArray(agents)) {
          console.log(`  ${chalk.white(peerId)}  ${chalk.gray(`→ [${agents.join(', ')}]`)}  ${chalk.gray(`(${strat})`)}`);
        }
      }
    }
    console.log();
  }

  // ---- CLI — bind (interactive) ------------------------------------------

  async bind(): Promise<void> {
    console.log(chalk.cyan('\n  Bind a channel/peer to an agent\n'));

    const { channel, matchType } = await inquirer.prompt([
      {
        type: 'input',
        name: 'channel',
        message: 'Channel ID (e.g. telegram, discord, slack, whatsapp):',
        validate: (v: string) => v.trim().length > 0 || 'Required'
      },
      {
        type: 'list',
        name: 'matchType',
        message: 'Match by:',
        choices: [
          { name: 'Any message on this channel', value: 'channel' },
          { name: 'Specific peer (group ID, user ID, channel ID)', value: 'peer' },
          { name: 'Discord guild', value: 'guild' },
          { name: 'Slack team', value: 'team' },
          { name: 'Account ID', value: 'account' }
        ]
      }
    ]);

    const match: BindingMatch = { channel };

    if (matchType === 'peer') {
      const { kind, peerId } = await inquirer.prompt([
        { type: 'list', name: 'kind', message: 'Peer type:', choices: ['group', 'channel', 'dm', 'room'] },
        { type: 'input', name: 'peerId', message: 'Peer ID:', validate: (v: string) => v.trim().length > 0 || 'Required' }
      ]);
      match.peer = { kind, id: peerId };
    } else if (matchType === 'guild') {
      const { guildId } = await inquirer.prompt([
        { type: 'input', name: 'guildId', message: 'Discord guild ID:', validate: (v: string) => v.trim().length > 0 || 'Required' }
      ]);
      match.guildId = guildId;
    } else if (matchType === 'team') {
      const { teamId } = await inquirer.prompt([
        { type: 'input', name: 'teamId', message: 'Slack team ID:', validate: (v: string) => v.trim().length > 0 || 'Required' }
      ]);
      match.teamId = teamId;
    } else if (matchType === 'account') {
      const { accountId } = await inquirer.prompt([
        { type: 'input', name: 'accountId', message: 'Account ID:', validate: (v: string) => v.trim().length > 0 || 'Required' }
      ]);
      match.accountId = accountId;
    }

    const agentIds = (this.config.agents?.list ?? []).map(a => a.id);
    const { agentId } = await inquirer.prompt([{
      type: agentIds.length > 1 ? 'list' : 'input',
      name: 'agentId',
      message: 'Route to agent ID:',
      choices: agentIds.length > 1 ? agentIds : undefined,
      default: agentIds[0] ?? 'main'
    }]);

    if (!this.config.bindings) this.config.bindings = [];
    this.config.bindings.unshift({ match, agentId, createdAt: new Date().toISOString() });
    this._saveConfig();
    console.log(chalk.green(`\n  ✔  Binding added: ${channel}/${matchType} → ${agentId}\n`));
  }

  // ---- CLI — unbind (interactive) ----------------------------------------

  async unbind(): Promise<void> {
    const bindings = this.config.bindings ?? [];
    if (bindings.length === 0) {
      console.log(chalk.gray('\n  No bindings to remove.\n'));
      return;
    }

    const { toRemove } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'toRemove',
      message: 'Select bindings to remove:',
      choices: bindings.map((b, i) => ({
        name: `${this._describeMatch(b.match)} → ${b.agentId}`,
        value: i
      }))
    }]);

    // Remove in reverse order to keep indices stable
    for (const idx of (toRemove as number[]).sort((a, b) => b - a)) {
      bindings.splice(idx, 1);
    }
    this.config.bindings = bindings;
    this._saveConfig();
    console.log(chalk.green(`\n  ✔  Removed ${toRemove.length} binding(s)\n`));
  }

  // ---- Expose config for gateway use -------------------------------------

  getConfig(): RoutingConfig { return this.config; }
  getAgents(): AgentDef[] { return this.config.agents?.list ?? [DEFAULT_AGENT]; }
  getBindings(): AgentBinding[] { return this.config.bindings ?? []; }
}
