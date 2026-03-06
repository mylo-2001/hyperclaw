/**
 * packages/gateway/src/deps.ts
 * Dependency injection interfaces. Host app provides implementations.
 */

export interface SessionStoreLike {
  append(key: string, role: string, content: string, source?: string): Promise<void>;
  get(key: string): Promise<{ transcript?: Array<{ role: string; content: string }> } | null>;
}

export interface ChannelRunner {
  stop: () => Promise<void>;
  handleWebhook?: (channelId: string, body: string, opts?: { signature?: string; timestamp?: string; lineSignature?: string; twilioSignature?: string; webhookUrl?: string }) => Promise<string | void>;
  verifyWebhook?: (channelId: string, mode: string, token: string, challenge: string) => string | null;
}

export interface HookLoaderLike {
  execute(event: string, payload: object): Promise<void>;
  startCronScheduler(): () => void;
}

export interface AgentCallOpts {
  currentSessionId?: string;
  source?: string;
  onToken?: (token: string) => void;
  onDone?: (response: string) => void;
}

export interface GatewayDeps {
  getHyperClawDir: () => string;
  getConfigPath: () => string;
  loadConfig?: () => unknown;
  resolveGatewayToken: (authToken: string) => string | undefined;
  /** Validate API key (e.g. developer key). When provided, Bearer tokens can be gateway token OR valid api key. */
  validateApiAuth?: (bearer: string) => Promise<boolean>;
  createSessionStore: (baseDir: string) => Promise<SessionStoreLike | null>;
  startChannelRunners: (opts: { port: number; bind: string; authToken?: string }) => Promise<ChannelRunner>;
  createHookLoader?: () => HookLoaderLike;
  runAgentEngine: (msg: string, opts: AgentCallOpts & Record<string, unknown>) => Promise<{ text: string }>;
  createPiRPCHandler: (callAgent: (msg: string, opts?: AgentCallOpts) => Promise<string>, getSessions: () => unknown[]) => (req: object) => Promise<object>;
  listTraces?: (baseDir: string, limit: number) => Promise<unknown[]>;
  getSessionSummary?: (baseDir: string, sessionId: string) => Promise<object>;
  getGlobalSummary?: (baseDir: string) => Promise<object>;
  recordUsage?: (baseDir: string, sessionId: string, usage: { input: number; output: number; cacheRead?: number }, opts?: { source?: string; model?: string }) => Promise<void>;
  textToSpeech?: (text: string, opts: Record<string, unknown>) => Promise<Buffer | string | null>;
  getRunMainPath?: () => string;
  getPending?: (sessionId: string) => { execute: () => Promise<string> } | undefined;
  clearPending?: (sessionId: string) => boolean;
  createRunTracer?: (sessionId?: string, source?: string) => {
    onToolCall: (name: string, input: unknown) => void;
    onToolResult: (name: string, result: string) => void;
    onRunEnd: (usage?: object, err?: string) => void;
    trace: object;
  };
  writeTraceToFile?: (baseDir: string, trace: object) => Promise<string | null>;
  NodeRegistry?: {
    register: (node: object) => void;
    unregister: (id: string) => void;
    updateLastSeen?: (nodeId: string) => void;
    getNodes: () => Array<{ nodeId: string; platform?: string; capabilities?: unknown; deviceName?: string; connectedAt?: string; lastSeenAt?: string }>;
  };
  /** Returns canvas state JSON when canvas is available */
  getCanvasState?: () => Promise<object>;
  /** Returns A2UI JSONL string when canvas is available */
  getCanvasA2UI?: () => Promise<string>;
}
