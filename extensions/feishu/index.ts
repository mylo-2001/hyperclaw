/**
 * extensions/feishu
 * HyperClaw channel extension: feishu
 * Loaded dynamically by the plugin registry.
 */

export const channelId = 'feishu';
export const displayName = 'feishu';

export async function configure(_token: string): Promise<void> {
  // Extension-specific configuration
}

export async function send(_target: string, _message: string): Promise<void> {
  // Send a message via feishu
}
