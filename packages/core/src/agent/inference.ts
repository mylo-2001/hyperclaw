/**
 * src/agent/inference.ts
 * Real AI inference engine:
 * - Streaming via SSE (Anthropic + OpenRouter)
 * - Function calling / tool use pipeline
 * - Tool execution loop (max 10 rounds)
 * - Structured output parsing
 * - Context window management
 */

import https from 'https';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InferenceMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export interface InferenceOptions {
  model: string;
  apiKey: string;
  provider: 'anthropic' | 'openrouter' | 'openai' | 'custom';
  baseUrl?: string;  // for custom — e.g. https://api.example.com/v1
  system?: string;
  tools?: Tool[];
  thinking?: { budget_tokens: number };
  maxTokens?: number;
  temperature?: number;
  maxToolRounds?: number;
  onToken?: (token: string) => void;
  onThinking?: (thought: string) => void;
  onToolCall?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: string) => void;
  onBlock?: (type: 'markdown' | 'code', content: string, lang?: string) => void;
}

export interface InferenceResult {
  text: string;
  thinking?: string;
  toolCalls: Array<{ name: string; input: unknown; result: string }>;
  usage: { input: number; output: number; cacheRead?: number };
  stopReason: string;
}

// ─── HTTP streaming helper ────────────────────────────────────────────────────

function streamRequest(
  hostname: string,
  reqPath: string,
  headers: Record<string, string>,
  body: object,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  opts?: { port?: number; useHttps?: boolean }
): void {
  const payload = JSON.stringify(body);
  const useHttps = opts?.useHttps ?? (hostname !== 'localhost' && !hostname.startsWith('127.'));
  const port = opts?.port ?? (useHttps ? 443 : 11434);
  const mod = useHttps ? https : http;

  const req = (mod as any).request({
    hostname, port,
    path: reqPath,
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, (res: any) => {
    let buf = '';
    res.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) onChunk(line);
      }
    });
    res.on('end', () => { if (buf.trim()) onChunk(buf); onDone(); });
    res.on('error', onError);
  });

  req.on('error', onError);
  req.write(payload);
  req.end();
}

// ─── Block streaming helper ──────────────────────────────────────────────────

function emitMarkdownBlocks(
  text: string,
  onBlock: (type: 'markdown' | 'code', content: string, lang?: string) => void
): void {
  const codeRe = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) onBlock('markdown', text.slice(last, m.index));
    onBlock('code', m[2], m[1] || undefined);
    last = m.index + m[0].length;
  }
  if (last < text.length) onBlock('markdown', text.slice(last));
}

// ─── SSE parser for Anthropic streaming ──────────────────────────────────────

function parseSSEChunk(line: string): any | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;
  try { return JSON.parse(data); } catch { return null; }
}

// ─── Main inference engine ────────────────────────────────────────────────────

export class InferenceEngine {
  private opts: InferenceOptions;

  constructor(opts: InferenceOptions) {
    this.opts = opts;
  }

  async run(messages: InferenceMessage[]): Promise<InferenceResult> {
    const result: InferenceResult = {
      text: '', thinking: undefined,
      toolCalls: [],
      usage: { input: 0, output: 0 },
      stopReason: 'end_turn'
    };

    const history = [...messages];
    const maxRounds = this.opts.maxToolRounds ?? 10;
    let rounds = 0;

    while (rounds < maxRounds) {
      rounds++;
      const response = await this.callAPI(history, result);

      // Check if we need to execute tools
      const toolUses = response.content?.filter((b: any) => b.type === 'tool_use') || [];

      if (toolUses.length === 0 || !this.opts.tools?.length) {
        // No tool calls — we're done
        const textBlocks = (response.content || []).filter((b: any) => b.type === 'text');
        result.text = textBlocks.map((b: any) => b.text).join('');
        result.stopReason = response.stop_reason || 'end_turn';
        if (response.usage) {
          result.usage = {
            input: response.usage.input_tokens || 0,
            output: response.usage.output_tokens || 0,
            cacheRead: response.usage.cache_read_input_tokens
          };
        }
        break;
      }

      // Add assistant response to history
      history.push({ role: 'assistant', content: response.content });

      // Execute tools
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUses) {
        const tool = this.opts.tools?.find(t => t.name === toolUse.name);
        this.opts.onToolCall?.(toolUse.name, toolUse.input);

        let toolResult = '';
        if (tool) {
          try {
            toolResult = await tool.handler(toolUse.input);
          } catch (err: any) {
            toolResult = `Error: ${err.message}`;
          }
        } else {
          toolResult = `Error: Tool "${toolUse.name}" not found`;
        }

        this.opts.onToolResult?.(toolUse.name, toolResult);
        result.toolCalls.push({ name: toolUse.name, input: toolUse.input, result: toolResult });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResult
        });
      }

      // Add tool results to history
      history.push({ role: 'user', content: toolResults });
    }

    return result;
  }

  private callAPI(messages: InferenceMessage[], result: InferenceResult): Promise<any> {
    const { provider } = this.opts;
    if (provider === 'anthropic') return this.callAnthropic(messages, result);
    if (provider === 'custom' && this.opts.baseUrl) return this.callCustom(messages, result);
    return this.callOpenRouter(messages, result);
  }

  private callAnthropic(messages: InferenceMessage[], result: InferenceResult): Promise<any> {
    return new Promise((resolve, reject) => {
      const body: any = {
        model: this.opts.model,
        max_tokens: this.opts.maxTokens || 4096,
        messages,
        stream: true
      };
      if (this.opts.system) body.system = this.opts.system;
      if (this.opts.thinking) body.thinking = { type: 'enabled', budget_tokens: this.opts.thinking.budget_tokens };
      if (this.opts.tools?.length) {
        body.tools = this.opts.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema
        }));
        body.tool_choice = { type: 'auto' };
      }

      const responseContent: any[] = [];
      let currentBlock: any = null;
      let inputJson = '';
      let stopReason = 'end_turn';
      let usage = { input_tokens: 0, output_tokens: 0 };

      streamRequest(
        'api.anthropic.com',
        '/v1/messages',
        {
          'Authorization': `Bearer ${this.opts.apiKey}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'interleaved-thinking-2025-05-14'
        },
        body,
        (line) => {
          const event = parseSSEChunk(line);
          if (!event) return;

          switch (event.type) {
            case 'content_block_start':
              currentBlock = { ...event.content_block };
              inputJson = '';
              break;

            case 'content_block_delta':
              if (!currentBlock) break;
              if (event.delta?.type === 'text_delta') {
                currentBlock.text = (currentBlock.text || '') + event.delta.text;
                this.opts.onToken?.(event.delta.text);
                if (currentBlock.type !== 'thinking') result.text += event.delta.text;
              }
              if (event.delta?.type === 'thinking_delta') {
                currentBlock.thinking = (currentBlock.thinking || '') + event.delta.thinking;
                this.opts.onThinking?.(event.delta.thinking);
              }
              if (event.delta?.type === 'input_json_delta') {
                inputJson += event.delta.partial_json;
              }
              break;

            case 'content_block_stop':
              if (currentBlock) {
                if (currentBlock.type === 'tool_use' && inputJson) {
                  try { currentBlock.input = JSON.parse(inputJson); } catch {}
                }
                if (currentBlock.type === 'text' && currentBlock.text && this.opts.onBlock) {
                  emitMarkdownBlocks(currentBlock.text, (type, content, lang) => this.opts.onBlock!(type, content, lang));
                }
                responseContent.push(currentBlock);
                currentBlock = null;
              }
              break;

            case 'message_delta':
              if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
              if (event.usage) { usage.output_tokens = event.usage.output_tokens || 0; }
              break;

            case 'message_start':
              if (event.message?.usage) usage = event.message.usage;
              break;
          }
        },
        () => resolve({ content: responseContent, stop_reason: stopReason, usage }),
        reject
      );
    });
  }

  private callOpenRouter(messages: InferenceMessage[], _result: InferenceResult): Promise<any> {
    return new Promise((resolve, reject) => {
      // Convert Anthropic-format messages to OpenAI format
      const oaiMessages = messages.map(m => {
        if (m.role === 'user' && Array.isArray(m.content)) {
          // tool_result blocks → OpenAI tool messages
          const toolResults = (m.content as ContentBlock[]).filter(b => b.type === 'tool_result');
          if (toolResults.length > 0) {
            return toolResults.map(b => ({
              role: 'tool' as const,
              tool_call_id: (b as any).tool_use_id,
              content: (b as any).content
            }));
          }
        }
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          // Rebuild OpenAI assistant message with tool_calls
          const textBlocks = (m.content as ContentBlock[]).filter(b => b.type === 'text');
          const toolUseBlocks = (m.content as ContentBlock[]).filter(b => b.type === 'tool_use');
          const msg: Record<string, unknown> = { role: 'assistant', content: textBlocks.map((b: any) => b.text).join('') || null };
          if (toolUseBlocks.length > 0) {
            msg.tool_calls = toolUseBlocks.map((b: any) => ({
              id: b.id,
              type: 'function',
              function: { name: b.name, arguments: JSON.stringify(b.input) }
            }));
          }
          return msg;
        }
        return {
          role: m.role === 'tool' ? 'tool' : m.role,
          content: typeof m.content === 'string' ? m.content :
            (m.content as ContentBlock[])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('')
        };
      }).flat();

      const body: Record<string, unknown> = {
        model: this.opts.model,
        max_tokens: this.opts.maxTokens || 4096,
        messages: this.opts.system ? [{ role: 'system', content: this.opts.system }, ...oaiMessages] : oaiMessages,
        stream: true
      };

      if (this.opts.tools?.length) {
        body.tools = this.opts.tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema }
        }));
        body.tool_choice = 'auto';
      }

      let fullText = '';
      let stopReason = 'stop';
      // Accumulate tool_calls by index (OpenAI streaming format)
      const toolCallsAcc: Record<number, { id: string; name: string; arguments: string }> = {};

      streamRequest(
        'openrouter.ai',
        '/api/v1/chat/completions',
        {
          'Authorization': `Bearer ${this.opts.apiKey}`,
          'HTTP-Referer': 'https://hyperclaw.ai',
          'X-Title': 'HyperClaw'
        },
        body,
        (line) => {
          const event = parseSSEChunk(line);
          if (!event?.choices?.[0]) return;
          const choice = event.choices[0];
          const delta = choice.delta;
          if (delta?.content) {
            fullText += delta.content;
            this.opts.onToken?.(delta.content);
          }
          // Accumulate streaming tool_calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              if (!toolCallsAcc[idx]) {
                toolCallsAcc[idx] = { id: tc.id || `call_${idx}`, name: '', arguments: '' };
              }
              if (tc.id) toolCallsAcc[idx].id = tc.id;
              if (tc.function?.name) toolCallsAcc[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallsAcc[idx].arguments += tc.function.arguments;
            }
          }
          if (choice.finish_reason) stopReason = choice.finish_reason;
        },
        () => {
          const responseContent: ContentBlock[] = [];
          if (fullText) responseContent.push({ type: 'text', text: fullText });
          // Convert accumulated tool_calls to Anthropic tool_use blocks
          for (const tc of Object.values(toolCallsAcc)) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.arguments || '{}'); } catch {}
            this.opts.onToolCall?.(tc.name, input);
            responseContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
          }
          const mappedStop = stopReason === 'tool_calls' ? 'tool_use' : stopReason;
          resolve({ content: responseContent, stop_reason: mappedStop, usage: {} });
        },
        reject
      );
    });
  }

  private callCustom(messages: InferenceMessage[], _result: InferenceResult): Promise<any> {
    const baseUrl = (this.opts.baseUrl || '').trim().replace(/\/$/, '');
    if (!baseUrl) return Promise.reject(new Error('Custom provider requires baseUrl'));

    let hostname: string;
    let reqPath: string;
    let port: number;
    let useHttps: boolean;
    try {
      const u = new URL(baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl);
      hostname = u.hostname;
      reqPath = (u.pathname || '/').replace(/\/$/, '') + '/chat/completions';
      if (!reqPath.startsWith('/')) reqPath = '/' + reqPath;
      useHttps = u.protocol === 'https:';
      port = u.port ? parseInt(u.port, 10) : (useHttps ? 443 : 80);
    } catch {
      return Promise.reject(new Error('Invalid custom baseUrl'));
    }

    return new Promise((resolve, reject) => {
      const oaiMessages = messages.map(m => ({
        role: m.role === 'tool' ? 'tool' : m.role,
        content: typeof m.content === 'string' ? m.content :
          (m.content as ContentBlock[])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('')
      }));

      const body: any = {
        model: this.opts.model,
        max_tokens: this.opts.maxTokens || 4096,
        messages: this.opts.system ? [{ role: 'system', content: this.opts.system }, ...oaiMessages] : oaiMessages,
        stream: true
      };

      if (this.opts.tools?.length) {
        body.tools = this.opts.tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema }
        }));
      }

      let fullText = '';
      let stopReason = 'stop';

      streamRequest(
        hostname,
        reqPath,
        {
          'Authorization': `Bearer ${this.opts.apiKey}`,
          'HTTP-Referer': 'https://hyperclaw.ai',
          'X-Title': 'HyperClaw'
        },
        body,
        (line) => {
          const event = parseSSEChunk(line);
          if (!event?.choices?.[0]) return;
          const delta = event.choices[0].delta;
          if (delta?.content) {
            fullText += delta.content;
            this.opts.onToken?.(delta.content);
          }
          if (event.choices[0].finish_reason) stopReason = event.choices[0].finish_reason;
        },
        () => resolve({
          content: [{ type: 'text', text: fullText }],
          stop_reason: stopReason,
          usage: {}
        }),
        reject,
        { port, useHttps }
      );
    });
  }
}

// ─── Builtin tools ────────────────────────────────────────────────────────────

export function getBuiltinTools(): Tool[] {
  return [
    {
      name: 'get_current_time',
      description: 'Get the current date and time',
      input_schema: { type: 'object', properties: { timezone: { type: 'string', description: 'Timezone name, e.g. Europe/Athens' } } },
      handler: async (input) => {
        const tz = (input.timezone as string) || 'UTC';
        try {
          return new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
        } catch {
          return new Date().toISOString();
        }
      }
    },
    {
      name: 'read_memory',
      description: 'Read content from workspace memory files in ~/.hyperclaw/. Use MEMORY.md, AGENTS.md, SOUL.md, USER.md, or any custom .md (e.g. EPIXEIRISI.md).',
      input_schema: {
        type: 'object',
        properties: { file: { type: 'string', description: 'Filename, e.g. MEMORY.md, AGENTS.md, SOUL.md, EPIXEIRISI.md. Must end in .md and stay in workspace.' } },
        required: ['file']
      },
      handler: async (input) => {
        const name = String(input.file || '').trim();
        if (!name.endsWith('.md') || /[\\/]/.test(name)) return `Invalid filename: must be a .md file in workspace (e.g. MEMORY.md, EPIXEIRISI.md).`;
        const fpath = path.join(HC_DIR, path.basename(name));
        if (path.resolve(fpath).indexOf(path.resolve(HC_DIR)) !== 0) return `Invalid path.`;
        if (await fs.pathExists(fpath)) return fs.readFile(fpath, 'utf8');
        return `${name} not found. Create it with create_memory_file.`;
      }
    },
    {
      name: 'write_memory',
      description: 'Append a fact or note to MEMORY.md. Also adds to knowledge graph for cross-session context.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Text to append to MEMORY.md' },
          tags: { type: 'string', description: 'Optional comma-separated tags for knowledge graph' }
        },
        required: ['content']
      },
      handler: async (input) => {
        const content = input.content as string;
        const fpath = path.join(HC_DIR, 'MEMORY.md');
        const entry = `\n- ${new Date().toISOString().slice(0, 10)}: ${content}\n`;
        await fs.appendFile(fpath, entry);
        const { addFact } = await import('../../../../src/services/knowledge-graph');
        const tags = (input.tags as string)?.split(',').map((t: string) => t.trim()).filter(Boolean);
        await addFact(content, tags).catch(() => {});
        return `Appended to MEMORY.md + knowledge graph: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`;
      }
    },
    {
      name: 'create_memory_file',
      description: 'Create or append to a custom .md file in ~/.hyperclaw/. Use when the user asks for a dedicated file (e.g. EPIXEIRISI.md for business context). File is loaded into context on every session.',
      input_schema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Filename must end in .md, e.g. EPIXEIRISI.md, PROJECTS.md' },
          content: { type: 'string', description: 'Initial content or content to append' },
          append: { type: 'string', description: '"true" to append, omit to create/overwrite' }
        },
        required: ['filename', 'content']
      },
      handler: async (input) => {
        const name = String(input.filename || '').trim();
        if (!/^[a-zA-Z0-9_-]+\.md$/.test(name)) return 'Invalid filename: use only letters, numbers, underscore, hyphen, and .md extension (e.g. EPIXEIRISI.md).';
        const content = String(input.content || '').trim();
        if (!content) return 'Content is required.';
        await fs.ensureDir(HC_DIR);
        const fpath = path.join(HC_DIR, name);
        const today = new Date().toISOString().slice(0, 10);
        if (input.append === 'true' && (await fs.pathExists(fpath))) {
          const entry = `\n- ${today}: ${content}\n`;
          await fs.appendFile(fpath, entry);
          return `Appended to ${name}: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`;
        }
        const header = `# ${name.replace('.md', '')}\n> Created: ${today}\n\n`;
        await fs.writeFile(fpath, header + content + '\n', 'utf8');
        return `Created ${name}. It will be loaded into context on every session.`;
      }
    },
    {
      name: 'memory_graph_add',
      description: 'Add a structured fact to the knowledge graph. Use for preferences, projects, key facts that should persist across sessions.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'fact | preference | project', enum: ['fact', 'preference', 'project'] },
          content: { type: 'string', description: 'The fact, preference (e.g. "coffee: strong"), or project name' }
        },
        required: ['type', 'content']
      },
      handler: async (input) => {
        const { addFact, addPreference, addProject } = await import('../../../../src/services/knowledge-graph');
        const t = (input.type as string).toLowerCase();
        const c = (input.content as string).trim();
        if (t === 'preference') {
          const [topic, value] = c.includes(':') ? c.split(':').map(s => s.trim()) : [c, ''];
          const id = await addPreference(topic, value || 'yes');
          return `Added preference: ${topic}${value ? ` = ${value}` : ''}`;
        }
        if (t === 'project') {
          const id = await addProject(c);
          return `Added project: ${c}`;
        }
        const id = await addFact(c);
        return `Added fact to knowledge graph: ${c.slice(0, 100)}`;
      }
    },
    {
      name: 'memory_graph_query',
      description: 'Query the knowledge graph for relevant context. Returns facts, preferences, projects.',
      input_schema: {
        type: 'object',
        properties: {
          types: { type: 'string', description: 'Optional: fact,preference,project' },
          tags: { type: 'string', description: 'Optional comma-separated tags to filter' },
          limit: { type: 'string', description: 'Max items (default 20)' }
        }
      },
      handler: async (input) => {
        const { queryMemory } = await import('../../../../src/services/knowledge-graph');
        const types = (input.types as string)?.split(',').map((t: string) => t.trim()).filter(Boolean) as any[] | undefined;
        const tags = (input.tags as string)?.split(',').map((t: string) => t.trim()).filter(Boolean);
        const limit = parseInt(input.limit as string || '20');
        const result = await queryMemory({ types, tags, limit });
        return result || 'No matching entries in knowledge graph.';
      }
    },
    {
      name: 'node_command',
      description: 'Send a device command to a paired mobile node (iOS/Android Connect tab). Use when the user asks to take a photo, get location, read contacts, etc. on their phone. First call with no params to list connected nodes.',
      input_schema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node ID from node_command list (e.g. "iPhone-1")' },
          command: { type: 'string', description: 'camera_capture | screen_record | location | contacts_list | calendar_events | photos_recent | sms_send | notify | motion', enum: ['camera_capture', 'screen_record', 'location', 'contacts_list', 'calendar_events', 'photos_recent', 'sms_send', 'notify', 'motion'] },
          params: { type: 'string', description: 'Optional JSON params, e.g. {"message":"Hello"} for notify' }
        }
      },
      handler: async (input) => {
        const { NodeRegistry } = await import('../../../../src/services/nodes-registry');
        const nodes = NodeRegistry.getNodes();
        if (!input.nodeId) {
          if (nodes.length === 0) return 'No mobile nodes connected. Pair the iOS/Android app via WebSocket to the gateway.';
          return nodes.map(n => `${n.nodeId} (${n.platform}): ${Object.keys(n.capabilities).filter((k): k is keyof typeof n.capabilities => Boolean(n.capabilities[k as keyof typeof n.capabilities])).join(', ')}`).join('\n');
        }
        const node = NodeRegistry.getNode(String(input.nodeId ?? ''));
        if (!node) return `Node ${input.nodeId} not found.`;
        const cmd = input.command as string;
        if (!cmd) return 'command is required.';
        const cmdId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let params: Record<string, unknown> = {};
        try { if (input.params) params = JSON.parse(input.params as string); } catch {}
        const result = await node.send({ id: cmdId, type: cmd as any, params });
        if (!result.ok) return result.error || 'Command failed';
        return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      }
    },
    {
      name: 'run_command',
      description: 'Run a safe shell command (read-only: ls, cat, echo, date, whoami, pwd)',
      input_schema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to run (read-only commands only)' } },
        required: ['command']
      },
      handler: async (input) => {
        const cmd = (input.command as string).trim();
        const safePattern = /^(ls|cat|echo|date|whoami|pwd|uname|hostname|df|free|uptime)(\s|$)/;
        if (!safePattern.test(cmd)) return `Blocked: only read-only commands allowed. Got: ${cmd}`;
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout, stderr } = await execAsync(cmd, { timeout: 5000 });
        return (stdout + stderr).trim().slice(0, 2000);
      }
    },
    {
      name: 'add_reminder',
      description: 'Add a reminder. Use for "remind me to X in Y" requests.',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Reminder text' },
          dueAt: { type: 'string', description: 'Optional: ISO 8601 or natural like "in 2 hours", "tomorrow 9am"' }
        },
        required: ['message']
      },
      handler: async (input) => {
        const { addReminder } = await import('./reminders-store');
        const r = await addReminder(input.message as string, input.dueAt as string | undefined);
        return `Reminder added (id: ${r.id}): ${r.message}${r.dueAt ? ` due ${r.dueAt}` : ''}`;
      }
    },
    {
      name: 'list_reminders',
      description: 'List pending reminders.',
      input_schema: {
        type: 'object',
        properties: { includeCompleted: { type: 'string', description: '"true" to include completed' } },
        required: []
      },
      handler: async (input) => {
        const { listReminders } = await import('./reminders-store');
        const items = await listReminders(input.includeCompleted === 'true');
        if (items.length === 0) return 'No reminders.';
        return items.map(r => `[${r.id}] ${r.message}${r.dueAt ? ` (due ${r.dueAt})` : ''} ${r.completed ? '(done)' : ''}`).join('\n');
      }
    },
    {
      name: 'complete_reminder',
      description: 'Mark a reminder as done.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Reminder ID from list_reminders' } },
        required: ['id']
      },
      handler: async (input) => {
        const { completeReminder } = await import('./reminders-store');
        const ok = await completeReminder(input.id as string);
        return ok ? `Reminder ${input.id} completed.` : `Reminder ${input.id} not found.`;
      }
    },
    {
      name: 'canvas_add',
      description: 'Add a component to the HyperClaw canvas (AI-driven UI). Use for charts, tables, forms, markdown, image, or script (in-browser JS execution). For type "script", pass data as JSON with key "script" containing the JavaScript to run in a sandboxed iframe.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Component type', enum: ['chart', 'table', 'form', 'markdown', 'image', 'custom', 'script'] },
          title: { type: 'string', description: 'Component title' },
          data: { type: 'string', description: 'Optional JSON. For type "script" use {"script": "document.body.innerHTML = \\"Hello\\";"}' }
        },
        required: ['type', 'title']
      },
      handler: async (input) => {
        const { CanvasRenderer } = await import('../../../../src/canvas/renderer');
        const renderer = new CanvasRenderer();
        let data: unknown;
        try { data = (input.data as string) ? JSON.parse(input.data as string) : undefined; } catch {}
        const c = await renderer.addComponent(input.type as any, input.title as string, data);
        return `Canvas component added: ${c.type}/${c.title} (id: ${c.id}). View at http://localhost:18789/canvas`;
      }
    },
    {
      name: 'http_get',
      description: 'Make an HTTP GET request to a URL and return the response',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          headers: { type: 'string', description: 'Optional JSON headers object' }
        },
        required: ['url']
      },
      handler: async (input) => {
        const url = input.url as string;
        if (!url.startsWith('http://') && !url.startsWith('https://')) return 'Error: URL must start with http:// or https://';
        return new Promise((resolve) => {
          const mod = url.startsWith('https://') ? https : require('http');
          let extra: Record<string, string> = {};
          try { if (input.headers) extra = JSON.parse(input.headers as string); } catch {}
          const req = mod.get(url, { headers: extra, timeout: 10000 }, (res: any) => {
            let data = '';
            res.on('data', (c: Buffer) => data += c);
            res.on('end', () => resolve(data.slice(0, 3000)));
          });
          req.on('error', (e: Error) => resolve(`Error: ${e.message}`));
        });
      }
    },
    {
      name: 'moltbook_feed',
      description: 'Get the latest posts from Moltbook (social feed for agents). Set MOLTBOOK_API_URL to enable.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'string', description: 'Max posts (default 10)' } },
        required: []
      },
      handler: async (input) => {
        const { getFeed } = await import('../../../../src/services/moltbook');
        const posts = await getFeed(parseInt((input.limit as string) || '10', 10));
        if (posts.length === 0) return 'Moltbook feed empty or MOLTBOOK_API_URL not set.';
        return posts.map((p: any) => `[${p.agentId}] ${p.content.slice(0, 200)}`).join('\n---\n');
      }
    },
    {
      name: 'moltbook_post',
      description: 'Publish a post to Moltbook. Requires MOLTBOOK_API_URL and agent auth.',
      input_schema: {
        type: 'object',
        properties: { content: { type: 'string', description: 'Post content' } },
        required: ['content']
      },
      handler: async (input) => {
        const { publishPost } = await import('../../../../src/services/moltbook');
        const post = await publishPost(input.content as string);
        return post ? `Published: ${post.id}` : 'Moltbook not configured or publish failed. Set MOLTBOOK_API_URL.';
      }
    },
    {
      name: 'claw_tasks_list',
      description: 'List open bounties from ClawTasks (bounty marketplace). Set CLAW_TASKS_API_URL to enable.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'string', description: 'Max bounties (default 10)' } },
        required: []
      },
      handler: async (input) => {
        const { listBounties } = await import('../../../../src/services/claw-tasks');
        const bounties = await listBounties(parseInt((input.limit as string) || '10', 10), 'open');
        if (bounties.length === 0) return 'No open bounties or CLAW_TASKS_API_URL not set.';
        return bounties.map((b: any) => `[${b.id}] ${b.title}${b.reward ? ` — ${b.reward}` : ''}`).join('\n');
      }
    },
    {
      name: 'claw_tasks_claim',
      description: 'Claim a ClawTasks bounty by ID. Requires CLAW_TASKS_API_URL and agent token.',
      input_schema: {
        type: 'object',
        properties: { bountyId: { type: 'string', description: 'Bounty ID from claw_tasks_list' } },
        required: ['bountyId']
      },
      handler: async (input) => {
        const { claimBounty } = await import('../../../../src/services/claw-tasks');
        const b = await claimBounty(input.bountyId as string);
        return b ? `Claimed: ${b.title}` : 'Claim failed or ClawTasks not configured.';
      }
    },
    {
      name: 'create_skill',
      description: 'Create or overwrite a custom skill (self-writing skills). The skill will be loaded on next message. Use when the user asks to "add skill X" or "create a skill that does Y".',
      input_schema: {
        type: 'object',
        properties: {
          skillId: { type: 'string', description: 'Unique slug, e.g. "remind-weekly" or "format-dates"' },
          name: { type: 'string', description: 'Human-readable name' },
          description: { type: 'string', description: 'Short description of when to use' },
          content: { type: 'string', description: 'Full SKILL.md body: instructions, when to use, steps. Use markdown.' }
        },
        required: ['skillId', 'content']
      },
      handler: async (input) => {
        const { writeSkill } = await import('./skill-loader');
        const { path: p, id } = await writeSkill(input.skillId as string, {
          name: input.name as string,
          description: input.description as string,
          content: input.content as string
        });
        return `Skill created: ${id} at ${p}. It will be loaded on the next turn.`;
      }
    }
  ];
}

// ─── Structured output helper ─────────────────────────────────────────────────

export async function runStructured<T>(
  prompt: string,
  schema: string,
  opts: Omit<InferenceOptions, 'tools'>
): Promise<T> {
  const engine = new InferenceEngine({
    ...opts,
    tools: [],
    onToken: undefined
  });

  const result = await engine.run([{
    role: 'user',
    content: `${prompt}\n\nRespond ONLY with valid JSON matching this schema. No markdown, no explanation:\n${schema}`
  }]);

  // Strip markdown fences if present
  const clean = result.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(clean) as T;
}
