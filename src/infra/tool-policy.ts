/**
 * src/infra/tool-policy.ts
 * Tool profiles, allow/deny lists, and groups — OpenClaw-style granular control.
 * Config: tools.profile, tools.allow, tools.deny, tools.byProvider.
 */

import type { Tool } from '../../packages/core/src/agent/inference';

export type ToolProfile = 'full' | 'messaging' | 'coding' | 'minimal';

const TOOL_GROUPS: Record<string, string[]> = {
  'group:fs': ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_directory'],
  'group:runtime': ['run_shell', 'kill_process'],
  'group:sessions': ['sessions_list', 'sessions_send', 'sessions_history'],
  'group:memory': ['read_memory', 'write_memory', 'memory_graph_add', 'memory_graph_query'],
  'group:ui': ['canvas_add', 'browser_snapshot', 'browser_action'],
  'group:messaging': ['sessions_send', 'sessions_list', 'sessions_history'],
  'group:automation': ['add_reminder', 'list_reminders', 'complete_reminder', 'watch_website_add', 'watch_website_check', 'watch_website_list'],
  'group:pc': ['run_shell', 'read_file', 'write_file', 'edit_file', 'list_directory', 'delete_file', 'kill_process', 'system_info', 'open', 'clipboard', 'search_files', 'screenshot', 'camera_capture', 'screen_record', 'contacts_list', 'calendar_events', 'photos_recent', 'app_updates', 'notify'],
  'group:extraction': ['extract_pdf', 'extract_spreadsheet'],
  'group:vision': ['analyze_image']
};

const PROFILE_TOOLS: Record<ToolProfile, string[]> = {
  full: [], // empty = no restriction (all tools)
  messaging: ['get_current_time', 'sessions_list', 'sessions_history', 'sessions_send', 'read_memory', 'write_memory'],
  coding: [
    ...TOOL_GROUPS['group:fs'],
    ...TOOL_GROUPS['group:runtime'],
    ...TOOL_GROUPS['group:sessions'],
    ...TOOL_GROUPS['group:memory'],
    'http_get', 'canvas_add', 'create_skill', 'get_current_time'
  ],
  minimal: ['get_current_time', 'sessions_list', 'read_memory']
};

function expandToToolNames(entries: string[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    const key = e.toLowerCase().trim();
    if (key === '*' || key === '') continue;
    if (key.startsWith('group:')) {
      const group = TOOL_GROUPS[key];
      if (group) group.forEach(t => out.add(t));
    } else {
      out.add(key);
    }
  }
  return out;
}

function matchesPattern(toolName: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const t = toolName.toLowerCase();
  if (p === '*' || p === t) return true;
  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1);
    return t.startsWith(prefix);
  }
  return false;
}

function isAllowed(
  toolName: string,
  allowSet: Set<string>,
  denySet: Set<string>,
  profileAllowSet: Set<string> | null
): boolean {
  if (denySet.size > 0) {
    for (const d of denySet) {
      if (matchesPattern(toolName, d)) return false;
    }
  }
  if (profileAllowSet && profileAllowSet.size > 0) {
    let inProfile = false;
    for (const a of profileAllowSet) {
      if (matchesPattern(toolName, a)) { inProfile = true; break; }
    }
    if (!inProfile) return false;
  }
  if (allowSet.size > 0) {
    for (const a of allowSet) {
      if (matchesPattern(toolName, a)) return true;
    }
    return false;
  }
  return true;
}

export interface ToolPolicyConfig {
  profile?: ToolProfile;
  allow?: string[];
  deny?: string[];
  byProvider?: Record<string, { profile?: ToolProfile; allow?: string[]; deny?: string[] }>;
}

export interface ToolPolicyContext {
  provider?: string;
  model?: string;
  agentId?: string;
}

export function applyToolPolicy(
  tools: Tool[],
  config: ToolPolicyConfig | null | undefined,
  context?: ToolPolicyContext
): Tool[] {
  if (!config) return tools;

  let profile = config.profile ?? 'full';
  let allow: string[] = config.allow ?? [];
  let deny: string[] = config.deny ?? [];

  // Provider-specific override
  if (context?.provider && config.byProvider) {
    const providerKey = context.provider + (context.model ? '/' + context.model : '');
    const exact = config.byProvider[providerKey] ?? config.byProvider[context.provider];
    if (exact) {
      if (exact.profile) profile = exact.profile as ToolProfile;
      if (exact.allow?.length) allow = [...allow, ...exact.allow];
      if (exact.deny?.length) deny = [...deny, ...exact.deny];
    }
  }

  const denySet = expandToToolNames(deny);
  const allowSet = expandToToolNames(allow);
  const profileTools = profile === 'full' ? null : new Set(PROFILE_TOOLS[profile]);

  return tools.filter(t => isAllowed(t.name, allowSet, denySet, profileTools));
}

/** For sandbox explain: return effective policy description. */
export function describeToolPolicy(
  config: ToolPolicyConfig | null | undefined,
  context?: ToolPolicyContext
): { profile: string; allow: string[]; deny: string[]; source: string } {
  if (!config) return { profile: 'full', allow: [], deny: [], source: 'default' };

  let profile = config.profile ?? 'full';
  let allow = config.allow ?? [];
  let deny = config.deny ?? [];
  let source = 'tools';

  if (context?.provider && config.byProvider) {
    const providerKey = context.provider + (context.model ? '/' + context.model : '');
    const exact = config.byProvider[providerKey] ?? config.byProvider[context.provider];
    if (exact) {
      if (exact.profile) { profile = exact.profile; source = `tools.byProvider[${context.provider}]`; }
      if (exact.allow?.length) allow = [...allow, ...exact.allow];
      if (exact.deny?.length) deny = [...deny, ...exact.deny];
    }
  }

  return { profile, allow, deny, source };
}

export { TOOL_GROUPS, PROFILE_TOOLS };
