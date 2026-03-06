/**
 * extensions/bluebubbles
 * HyperClaw channel extension: bluebubbles
 * Loaded dynamically by the plugin registry.
 */

export const channelId = 'bluebubbles';
export const displayName = 'bluebubbles';

export async function configure(_token: string): Promise<void> {
  // Extension-specific configuration
}

export async function send(_target: string, _message: string): Promise<void> {
  // Send a message via bluebubbles
}
