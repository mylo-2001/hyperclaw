/**
 * extensions/nostr
 * HyperClaw channel extension: nostr
 * Loaded dynamically by the plugin registry.
 */

export const channelId = 'nostr';
export const displayName = 'nostr';

export async function configure(_token: string): Promise<void> {
  // Extension-specific configuration
}

export async function send(_target: string, _message: string): Promise<void> {
  // Send a message via nostr
}
