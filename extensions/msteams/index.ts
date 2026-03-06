/**
 * extensions/msteams
 * HyperClaw channel extension: msteams
 * Loaded dynamically by the plugin registry.
 */

export const channelId = 'msteams';
export const displayName = 'msteams';

export async function configure(_token: string): Promise<void> {
  // Extension-specific configuration
}

export async function send(_target: string, _message: string): Promise<void> {
  // Send a message via msteams
}
