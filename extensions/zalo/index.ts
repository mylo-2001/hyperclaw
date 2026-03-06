/**
 * extensions/zalo
 * HyperClaw channel extension: zalo
 * Loaded dynamically by the plugin registry.
 */

export const channelId = 'zalo';
export const displayName = 'zalo';

export async function configure(_token: string): Promise<void> {
  // Extension-specific configuration
}

export async function send(_target: string, _message: string): Promise<void> {
  // Send a message via zalo
}
