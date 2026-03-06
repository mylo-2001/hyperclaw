/**
 * src/services/nodes-registry.ts
 * Mobile nodes (iOS/Android) registry — Connect tab.
 * Paired devices register via WebSocket and receive device commands from the agent.
 */

import { EventEmitter } from 'events';

export type NodePlatform = 'ios' | 'android';

export interface NodeCapabilities {
  camera?: boolean;
  screenRecord?: boolean;
  location?: boolean;
  contacts?: boolean;
  calendar?: boolean;
  photos?: boolean;
  sms?: boolean;
  motion?: boolean;
  notifications?: boolean;
}

export interface RegisteredNode {
  nodeId: string;
  platform: NodePlatform;
  capabilities: NodeCapabilities;
  deviceName?: string;
  connectedAt: string;
  lastSeenAt: string;
  /** WebSocket-like interface for sending commands */
  send: (cmd: NodeCommand) => Promise<NodeCommandResult>;
}

export interface NodeCommand {
  id: string;
  type: 'camera_capture' | 'screen_record' | 'location' | 'contacts_list' | 'calendar_events' | 'photos_recent' | 'sms_send' | 'notify' | 'motion' | 'volume_up' | 'volume_down' | 'brightness' | 'wifi_toggle';
  params?: Record<string, unknown>;
}

export interface NodeCommandResult {
  ok: boolean;
  data?: string | Record<string, unknown>;
  error?: string;
}

class NodeRegistryImpl extends EventEmitter {
  private nodes = new Map<string, RegisteredNode>();
  private pendingCommands = new Map<string, { resolve: (r: NodeCommandResult) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }>();

  register(node: RegisteredNode): void {
    this.nodes.set(node.nodeId, node);
    this.emit('node:registered', node);
  }

  unregister(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.emit('node:unregistered', nodeId);
  }

  getNodes(): RegisteredNode[] {
    return Array.from(this.nodes.values());
  }

  getNode(nodeId: string): RegisteredNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** Send a command to a node. Returns result or error. */
  async sendCommand(nodeId: string, cmd: NodeCommand): Promise<NodeCommandResult> {
    const node = this.nodes.get(nodeId);
    if (!node) return { ok: false, error: `Node ${nodeId} not connected` };
    return node.send(cmd);
  }

  /** Handle response from a node (called when node replies to a command). */
  handleCommandResponse(cmdId: string, result: NodeCommandResult): void {
    const pending = this.pendingCommands.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(cmdId);
      pending.resolve(result);
    }
  }

  updateLastSeen(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      (node as any).lastSeenAt = new Date().toISOString();
    }
  }
}

export const NodeRegistry = new NodeRegistryImpl();
