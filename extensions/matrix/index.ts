/**
 * extensions/matrix
 * HyperClaw channel extension: matrix
 * Loaded dynamically by the plugin registry.
 */

export const channelId = 'matrix';
export const displayName = 'matrix';

export async function configure(_token: string): Promise<void> {
  // Extension-specific configuration
}

export async function send(_target: string, _message: string): Promise<void> {
  // Send a message via matrix
}
