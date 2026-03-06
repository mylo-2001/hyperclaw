/**
 * extensions/imessage/src/connector.ts
 * iMessage channel bridge — re-exports BlueBubbles connector.
 *
 * The channel ID is "imessage" throughout the gateway and wizard.
 * The actual implementation lives in extensions/bluebubbles/.
 * This shim keeps the ID consistent without duplicating code.
 */
export { BlueBubblesConnector as IMessageConnector } from '../../bluebubbles/src/connector';
export type { BlueBubblesConfig as IMessageConfig } from '../../bluebubbles/src/connector';
