/**
 * src/auto-reply/rules.ts
 * Auto-reply rule engine.
 * Rules fire when an incoming message matches a condition,
 * before the message reaches the AI model.
 *
 * Priority: auto-reply rules > DM guard > agent routing > model
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const RULES_FILE = path.join(os.homedir(), '.hyperclaw', 'auto-reply-rules.json');

export type RuleConditionType =
  | 'contains'      // message contains text (case-insensitive)
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'from'          // from specific sender
  | 'channel'       // on specific channel
  | 'always';       // fires for every message

export type RuleActionType =
  | 'reply'         // send fixed reply
  | 'forward'       // forward to another channel/target
  | 'ignore'        // silently drop message
  | 'queue'         // add to delivery queue for later
  | 'notify';       // send OS/gateway notification

export interface AutoReplyCondition {
  type: RuleConditionType;
  value?: string;        // text, regex pattern, sender id, or channel id
  flags?: string;        // regex flags, e.g. 'i'
}

export interface AutoReplyAction {
  type: RuleActionType;
  reply?: string;        // for type='reply'
  target?: string;       // for type='forward'
  channelId?: string;    // for type='forward'
}

export interface AutoReplyRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;       // lower = higher priority
  stopOnMatch: boolean;   // if true, don't run later rules
  conditions: AutoReplyCondition[];
  conditionLogic: 'AND' | 'OR';
  action: AutoReplyAction;
  createdAt: string;
  hitCount: number;
  lastHitAt?: string;
}

export interface IncomingMessageContext {
  content: string;
  from: string;
  channelId: string;
  timestamp: string;
}

function matchCondition(cond: AutoReplyCondition, msg: IncomingMessageContext): boolean {
  const text = msg.content.toLowerCase();
  const val  = (cond.value || '').toLowerCase();

  switch (cond.type) {
    case 'always':     return true;
    case 'contains':   return text.includes(val);
    case 'startsWith': return text.startsWith(val);
    case 'endsWith':   return text.endsWith(val);
    case 'from':       return msg.from === cond.value;
    case 'channel':    return msg.channelId === cond.value;
    case 'regex': {
      try {
        const re = new RegExp(cond.value || '', cond.flags || 'i');
        return re.test(msg.content);
      } catch { return false; }
    }
    default: return false;
  }
}

function matchRule(rule: AutoReplyRule, msg: IncomingMessageContext): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return false;

  const results = rule.conditions.map(c => matchCondition(c, msg));
  return rule.conditionLogic === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);
}

export class AutoReplyEngine {
  private rules: AutoReplyRule[] = [];

  async load(): Promise<void> {
    try { this.rules = await fs.readJson(RULES_FILE); }
    catch { this.rules = []; }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(RULES_FILE));
    await fs.writeJson(RULES_FILE, this.rules, { spaces: 2 });
  }

  async evaluate(msg: IncomingMessageContext): Promise<AutoReplyAction | null> {
    await this.load();

    const sorted = [...this.rules].sort((a, b) => a.priority - b.priority);
    for (const rule of sorted) {
      if (matchRule(rule, msg)) {
        rule.hitCount++;
        rule.lastHitAt = new Date().toISOString();
        await this.save();
        return rule.action;
      }
    }
    return null;
  }

  async add(rule: Omit<AutoReplyRule, 'id' | 'createdAt' | 'hitCount'>): Promise<AutoReplyRule> {
    await this.load();
    const full: AutoReplyRule = {
      ...rule,
      id: Math.random().toString(36).slice(2, 10),
      createdAt: new Date().toISOString(),
      hitCount: 0
    };
    this.rules.push(full);
    await this.save();
    return full;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    this.rules = this.rules.filter(r => r.id !== id);
    await this.save();
  }

  async toggle(id: string): Promise<void> {
    await this.load();
    const rule = this.rules.find(r => r.id === id);
    if (rule) { rule.enabled = !rule.enabled; await this.save(); }
  }

  showList(): void {
    console.log(chalk.bold.cyan('\n  🦅 AUTO-REPLY RULES\n'));
    if (this.rules.length === 0) {
      console.log(chalk.gray('  No rules configured.\n'));
      console.log(chalk.gray('  Add a rule: hyperclaw auto-reply add\n'));
      return;
    }

    for (const rule of [...this.rules].sort((a, b) => a.priority - b.priority)) {
      const dot = rule.enabled ? chalk.green('●') : chalk.gray('○');
      console.log(`  ${dot} ${chalk.white(rule.name)} ${chalk.gray(`#${rule.id}`)}`);
      console.log(`    ${chalk.gray(`Priority: ${rule.priority}  Hits: ${rule.hitCount}  Logic: ${rule.conditionLogic}`)}`);
      for (const c of rule.conditions) {
        console.log(`    ${chalk.cyan('if')} ${c.type} ${chalk.yellow(c.value || '*')}`);
      }
      console.log(`    ${chalk.cyan('then')} ${rule.action.type}${rule.action.reply ? `: "${rule.action.reply.slice(0, 40)}"` : ''}`);
      if (rule.stopOnMatch) console.log(`    ${chalk.gray('(stop on match)')}`);
      console.log();
    }
  }
}
