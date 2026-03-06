/**
 * src/agent/surface-parity.ts
 * Shared help and response formatting so CLI, gateway, and bots feel the same.
 */

export type Surface = 'telegram' | 'discord' | 'cli' | 'gateway';

const COMMANDS = [
  { cmd: '/status', desc: 'Gateway status' },
  { cmd: '/restart', desc: 'Restart gateway' },
  { cmd: '/logs [n]', desc: 'Last N log lines (default 20)' },
  { cmd: '/approve <channel> <code>', desc: 'Approve DM pairing' },
  { cmd: '/channels', desc: 'List active channels' },
  { cmd: '/hook list', desc: 'List hooks' },
  { cmd: '/hook on <id>', desc: 'Enable hook' },
  { cmd: '/hook off <id>', desc: 'Disable hook' },
  { cmd: '/agent <message>', desc: 'Talk to your AI' },
  { cmd: 'Voice note', desc: 'Transcribe + send to AI' },
  { cmd: '/secrets', desc: 'Secrets audit summary' },
  { cmd: '/security', desc: 'Security audit summary' },
  { cmd: '/help', desc: 'This help message' }
];

/** Single source of truth for bot/CLI help. */
export function getAgentHelp(surface: Surface): string {
  const lines = COMMANDS.map(c => `${c.cmd} — ${c.desc}`);
  if (surface === 'telegram') {
    return `🦅 *HyperClaw Commands*\n\n${lines.join('\n')}\n\nGroups: @mention or reply to bot to activate.`;
  }
  if (surface === 'discord') {
    return `🦅 **HyperClaw Commands**\n\n${lines.join('\n')}\n\nGroups: mention or reply to activate.`;
  }
  return `🦅 HyperClaw Commands\n\n${lines.join('\n')}`;
}

/** Format agent response for display (optional header). */
export function formatAgentResponse(text: string, surface: Surface): string {
  if (!text || text.startsWith('Error:')) return text;
  if (surface === 'telegram') return `🦅 *Agent*\n\n${text}`;
  if (surface === 'discord') return `🦅 **Agent**\n\n${text}`;
  return text;
}
