/**
 * src/sdk/index.ts
 * HyperClaw Plugin SDK - public API for building extensions and skills.
 * Export this as @hyperclaw/sdk for plugin developers.
 *
 * Matches OpenClaw's plugin SDK pattern with full TypeScript DTS exports.
 */

// --- Core Types --------------------------------------------------------------

export interface HyperClawPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  capabilities: PluginCapability[];
  onLoad?: (ctx: PluginContext) => Promise<void>;
  onUnload?: () => Promise<void>;
}

export type PluginCapability =
  | 'message:send'
  | 'message:receive'
  | 'gateway:connect'
  | 'tools:register'
  | 'hooks:register'
  | 'canvas:write'
  | 'memory:read'
  | 'memory:write'
  | 'config:read'
  | 'secrets:read';

export interface PluginContext {
  config: PluginConfigAPI;
  gateway: PluginGatewayAPI;
  tools: PluginToolsAPI;
  hooks: PluginHooksAPI;
  canvas: PluginCanvasAPI;
  memory: PluginMemoryAPI;
  secrets: PluginSecretsAPI;
  log: PluginLogger;
}

// --- API Interfaces ----------------------------------------------------------

export interface PluginConfigAPI {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  getAll(): Record<string, unknown>;
}

export interface PluginGatewayAPI {
  send(channelId: string, target: string, message: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  isConnected(): boolean;
  getPort(): number;
}

export interface IncomingMessage {
  id: string;
  channelId: string;
  from: string;
  text: string;
  timestamp: string;
  threadId?: string;
  attachments?: Attachment[];
}

export interface Attachment {
  type: 'image' | 'file' | 'audio' | 'video';
  url: string;
  mimeType: string;
  name?: string;
  size?: number;
}

export interface PluginToolsAPI {
  register(tool: Tool): void;
  unregister(toolId: string): void;
  list(): Tool[];
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PluginHooksAPI {
  on(event: HookEvent, handler: HookHandler): void;
  off(event: HookEvent, handler: HookHandler): void;
  emit(event: HookEvent, payload: unknown): Promise<void>;
}

export type HookEvent =
  | 'session:start'
  | 'session:end'
  | 'message:sent'
  | 'message:received'
  | 'gateway:start'
  | 'gateway:stop'
  | 'cron:tick';

export type HookHandler = (payload: unknown) => Promise<void>;

export interface PluginCanvasAPI {
  add(type: string, title: string, data?: unknown): Promise<string>;
  update(componentId: string, data: unknown): Promise<void>;
  remove(componentId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface PluginMemoryAPI {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  appendToAgentsMd(content: string): Promise<void>;
  appendToMemoryMd(content: string): Promise<void>;
}

export interface PluginSecretsAPI {
  get(key: string): Promise<string | null>;
  require(key: string): Promise<string>; // throws if missing
}

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

// --- Channel Extension Interface ---------------------------------------------

export interface ChannelExtension {
  channelId: string;
  displayName: string;
  emoji: string;
  supportsDM: boolean;
  requiresGateway: boolean;
  platforms: ('linux' | 'darwin' | 'win32' | 'all')[];

  configure(config: ChannelConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(target: string, message: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}

export interface ChannelConfig {
  token?: string;
  webhookUrl?: string;
  [key: string]: unknown;
}

// --- SDK Utilities -----------------------------------------------------------

export function definePlugin(plugin: HyperClawPlugin): HyperClawPlugin {
  return plugin;
}

export function defineChannelExtension(ext: ChannelExtension): ChannelExtension {
  return ext;
}

export function defineTool(tool: Omit<Tool, 'id'> & { id?: string }): Tool {
  return {
    id: tool.id || tool.name.toLowerCase().replace(/\s+/g, '-'),
    ...tool
  } as Tool;
}

// --- Version -----------------------------------------------------------------

export const SDK_VERSION = '5.0.1';
export const SDK_COMPAT = '>=5.0.1';
