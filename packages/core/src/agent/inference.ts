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
      name: 'weather',
      description: 'Get current weather and forecast for a location. Uses Open-Meteo (free, no key needed). Also supports Weather API key via WEATHER_API_KEY env.',
      input_schema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name, e.g. "Athens" or "New York"' },
          days: { type: 'string', description: 'Forecast days: 1 (default) to 7' }
        },
        required: ['location']
      },
      handler: async (input) => {
        const location = input.location as string;
        const days = Math.min(7, Math.max(1, parseInt((input.days as string) || '1')));
        // Geocoding
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
        return new Promise((resolve) => {
          const req = https.get(geoUrl, { timeout: 6000 }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', async () => {
              try {
                const geo = JSON.parse(d);
                const loc = geo.results?.[0];
                if (!loc) { resolve(`Location not found: ${location}`); return; }
                const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum&current_weather=true&forecast_days=${days}&timezone=auto`;
                https.get(wUrl, { timeout: 6000 }, (wr: any) => {
                  let wd = ''; wr.on('data', (c: Buffer) => wd += c);
                  wr.on('end', () => {
                    try {
                      const w = JSON.parse(wd);
                      const cur = w.current_weather;
                      const WMO: Record<number, string> = { 0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',51:'Drizzle',61:'Rain',71:'Snow',80:'Showers',95:'Thunderstorm' };
                      const cond = WMO[cur?.weathercode] || `code ${cur?.weathercode}`;
                      let out = `📍 ${loc.name}, ${loc.country_code?.toUpperCase()}\n🌡 ${cur?.temperature}°C — ${cond} | Wind: ${cur?.windspeed} km/h\n`;
                      if (days > 1 && w.daily) {
                        out += '\n📅 Forecast:\n';
                        for (let i = 0; i < Math.min(days, w.daily.time.length); i++) {
                          const dCond = WMO[w.daily.weathercode?.[i]] || '';
                          out += `  ${w.daily.time[i]}: ${w.daily.temperature_2m_min?.[i]}°–${w.daily.temperature_2m_max?.[i]}° ${dCond} 💧${w.daily.precipitation_sum?.[i]}mm\n`;
                        }
                      }
                      resolve(out.trim());
                    } catch { resolve('Weather parse error'); }
                  });
                }).on('error', () => resolve('Weather API unreachable'));
              } catch { resolve('Geocoding parse error'); }
            });
          });
          req.on('error', () => resolve('Geocoding API unreachable'));
        });
      }
    },
    {
      name: 'image_generate',
      description: 'Generate an image from a text prompt using DALL-E (requires OPENAI_API_KEY) or Stability AI (requires STABILITY_API_KEY). Returns a URL or base64.',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image description' },
          size: { type: 'string', description: '256x256 | 512x512 | 1024x1024 (default)', enum: ['256x256', '512x512', '1024x1024'] },
          provider: { type: 'string', description: 'dalle (default) | stability', enum: ['dalle', 'stability'] }
        },
        required: ['prompt']
      },
      handler: async (input) => {
        const prompt = input.prompt as string;
        const size = (input.size as string) || '1024x1024';
        const prov = (input.provider as string) || 'dalle';
        const openaiKey = process.env.OPENAI_API_KEY || (await fs.readJson(path.join(HC_DIR, 'hyperclaw.json')).catch(() => ({}))).provider?.apiKey;
        if (prov === 'dalle') {
          if (!openaiKey) return 'OPENAI_API_KEY not set. Configure an OpenAI API key.';
          return new Promise((resolve) => {
            const body = JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size });
            const req = https.request({ hostname: 'api.openai.com', path: '/v1/images/generations', method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            }, (res: any) => {
              let d = ''; res.on('data', (c: Buffer) => d += c);
              res.on('end', () => {
                try {
                  const j = JSON.parse(d);
                  const url = j.data?.[0]?.url;
                  resolve(url ? `Generated image: ${url}` : `Error: ${j.error?.message || d.slice(0, 200)}`);
                } catch { resolve('Image generation parse error'); }
              });
            });
            req.on('error', (e: Error) => resolve(`Error: ${e.message}`));
            req.write(body); req.end();
          });
        }
        const stabilityKey = process.env.STABILITY_API_KEY;
        if (!stabilityKey) return 'STABILITY_API_KEY not set.';
        return new Promise((resolve) => {
          const body = JSON.stringify({ text_prompts: [{ text: prompt }], cfg_scale: 7, height: 512, width: 512, samples: 1, steps: 30 });
          const req = https.request({ hostname: 'api.stability.ai', path: '/v1/generation/stable-diffusion-v1-6/text-to-image', method: 'POST',
            headers: { Authorization: `Bearer ${stabilityKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => {
              try {
                const j = JSON.parse(d);
                const b64 = j.artifacts?.[0]?.base64;
                resolve(b64 ? `data:image/png;base64,${b64.slice(0, 80)}... (base64 image generated)` : `Error: ${d.slice(0, 200)}`);
              } catch { resolve('Stability parse error'); }
            });
          });
          req.on('error', (e: Error) => resolve(`Error: ${e.message}`));
          req.write(body); req.end();
        });
      }
    },
    {
      name: 'gif_search',
      description: 'Search for a GIF on Giphy or Tenor. Returns a URL. Requires GIPHY_API_KEY or TENOR_API_KEY env var.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term, e.g. "excited cat"' },
          limit: { type: 'string', description: 'Max results (default 1)' }
        },
        required: ['query']
      },
      handler: async (input) => {
        const query = encodeURIComponent(input.query as string);
        const limit = parseInt((input.limit as string) || '1');
        const giphyKey = process.env.GIPHY_API_KEY;
        const tenorKey = process.env.TENOR_API_KEY;
        if (giphyKey) {
          return new Promise((resolve) => {
            https.get(`https://api.giphy.com/v1/gifs/search?api_key=${giphyKey}&q=${query}&limit=${limit}&rating=g`, { timeout: 5000 }, (res: any) => {
              let d = ''; res.on('data', (c: Buffer) => d += c);
              res.on('end', () => {
                try {
                  const j = JSON.parse(d);
                  const results = j.data?.map((g: any) => g.images?.original?.url || g.url).filter(Boolean).slice(0, limit);
                  resolve(results?.length ? results.join('\n') : 'No GIFs found');
                } catch { resolve('Giphy parse error'); }
              });
            }).on('error', () => resolve('Giphy unreachable'));
          });
        }
        if (tenorKey) {
          return new Promise((resolve) => {
            https.get(`https://tenor.googleapis.com/v2/search?q=${query}&key=${tenorKey}&limit=${limit}&media_filter=gif`, { timeout: 5000 }, (res: any) => {
              let d = ''; res.on('data', (c: Buffer) => d += c);
              res.on('end', () => {
                try {
                  const j = JSON.parse(d);
                  const results = j.results?.map((g: any) => g.media_formats?.gif?.url).filter(Boolean).slice(0, limit);
                  resolve(results?.length ? results.join('\n') : 'No GIFs found');
                } catch { resolve('Tenor parse error'); }
              });
            }).on('error', () => resolve('Tenor unreachable'));
          });
        }
        return 'Set GIPHY_API_KEY or TENOR_API_KEY to enable GIF search.';
      }
    },
    {
      name: 'spotify',
      description: 'Control Spotify playback or search for tracks/playlists. Requires SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET + SPOTIFY_REFRESH_TOKEN.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'play | pause | next | previous | search | current', enum: ['play', 'pause', 'next', 'previous', 'search', 'current'] },
          query: { type: 'string', description: 'Search query for action=search (e.g. "Daft Punk")' },
          uri: { type: 'string', description: 'Spotify URI to play (e.g. spotify:track:XXX)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const action = input.action as string;
        const clientId = process.env.SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
        if (!clientId || !clientSecret || !refreshToken) {
          return 'Spotify not configured. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN.\nGet credentials at developer.spotify.com → Dashboard.';
        }
        // Get access token
        const getToken = (): Promise<string> => new Promise((resolve, reject) => {
          const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
          const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
          const req = https.request({ hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
          }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d).access_token); } catch { reject(new Error('Token parse error')); } });
          });
          req.on('error', reject); req.write(body); req.end();
        });
        const spotifyApi = (method: string, path2: string, token: string, body?: object): Promise<any> => new Promise((resolve) => {
          const payload = body ? JSON.stringify(body) : undefined;
          const req = https.request({ hostname: 'api.spotify.com', path: path2, method,
            headers: { 'Authorization': `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }
          }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => { try { resolve(d ? JSON.parse(d) : { ok: true }); } catch { resolve({ raw: d }); } });
          });
          req.on('error', (e: Error) => resolve({ error: e.message }));
          if (payload) req.write(payload); req.end();
        });
        try {
          const token = await getToken();
          if (action === 'current') {
            const r = await spotifyApi('GET', '/v1/me/player/currently-playing', token);
            if (!r?.item) return 'Nothing playing.';
            return `🎵 ${r.item.name} — ${r.item.artists?.map((a: any) => a.name).join(', ')} (${r.is_playing ? '▶ Playing' : '⏸ Paused'})`;
          }
          if (action === 'search') {
            if (!input.query) return 'query is required for search';
            const r = await spotifyApi('GET', `/v1/search?q=${encodeURIComponent(input.query as string)}&type=track&limit=5`, token);
            const tracks = r.tracks?.items?.map((t: any) => `${t.name} — ${t.artists?.[0]?.name} (${t.uri})`).join('\n');
            return tracks || 'No results found.';
          }
          if (action === 'play' && input.uri) {
            await spotifyApi('PUT', '/v1/me/player/play', token, { uris: [input.uri] });
            return `▶ Playing ${input.uri}`;
          }
          const ENDPOINT: Record<string, [string, string]> = {
            play: ['PUT', '/v1/me/player/play'],
            pause: ['PUT', '/v1/me/player/pause'],
            next: ['POST', '/v1/me/player/next'],
            previous: ['POST', '/v1/me/player/previous']
          };
          const [method, ep] = ENDPOINT[action] || [];
          if (!ep) return `Unknown action: ${action}`;
          await spotifyApi(method, ep, token);
          return `✅ Spotify: ${action}`;
        } catch (e: any) {
          return `Spotify error: ${e.message}`;
        }
      }
    },
    {
      name: 'home_assistant',
      description: 'Control Home Assistant devices (lights, switches, thermostats, etc.). Requires HA_URL and HA_TOKEN env vars.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list_entities | get_state | turn_on | turn_off | toggle | call_service', enum: ['list_entities', 'get_state', 'turn_on', 'turn_off', 'toggle', 'call_service'] },
          entity_id: { type: 'string', description: 'Entity ID, e.g. "light.living_room" or "switch.kitchen"' },
          domain: { type: 'string', description: 'For list_entities: filter by domain (e.g. "light", "switch", "climate")' },
          service_data: { type: 'string', description: 'For call_service: JSON with domain, service, and entity_id' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const haUrl = (process.env.HA_URL || '').replace(/\/$/, '');
        const haToken = process.env.HA_TOKEN;
        if (!haUrl || !haToken) return 'Home Assistant not configured. Set HA_URL (e.g. http://homeassistant.local:8123) and HA_TOKEN (long-lived access token from your HA profile).';
        const haGet = (path2: string): Promise<any> => new Promise((resolve) => {
          const u = new URL(haUrl + path2);
          const mod = u.protocol === 'https:' ? https : require('http');
          mod.get(u.toString(), { headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' }, timeout: 8000 }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
          }).on('error', (e: Error) => resolve({ error: e.message }));
        });
        const haPost = (path2: string, body: object): Promise<any> => new Promise((resolve) => {
          const u = new URL(haUrl + path2);
          const payload = JSON.stringify(body);
          const mod = u.protocol === 'https:' ? https : require('http');
          const req = mod.request(u.toString(), { method: 'POST', headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
          });
          req.on('error', (e: Error) => resolve({ error: e.message }));
          req.write(payload); req.end();
        });
        const action = input.action as string;
        if (action === 'list_entities') {
          const states = await haGet('/api/states');
          if (!Array.isArray(states)) return `HA error: ${JSON.stringify(states)}`;
          const domain = (input.domain as string) || '';
          const filtered = domain ? states.filter((s: any) => s.entity_id?.startsWith(domain + '.')) : states;
          return filtered.slice(0, 30).map((s: any) => `${s.entity_id}: ${s.state}`).join('\n') + (filtered.length > 30 ? `\n...and ${filtered.length - 30} more` : '');
        }
        if (action === 'get_state') {
          if (!input.entity_id) return 'entity_id required';
          const state = await haGet(`/api/states/${input.entity_id}`);
          return state.error ? `Error: ${state.error}` : `${state.entity_id}: ${state.state} — ${JSON.stringify(state.attributes).slice(0, 200)}`;
        }
        if (action === 'call_service') {
          if (!input.service_data) return 'service_data required (JSON with domain, service, entity_id)';
          let sd: any; try { sd = JSON.parse(input.service_data as string); } catch { return 'service_data must be valid JSON'; }
          const r = await haPost(`/api/services/${sd.domain}/${sd.service}`, { entity_id: sd.entity_id, ...sd.data });
          return `Service called: ${sd.domain}.${sd.service}` + (r.error ? ` — Error: ${r.error}` : '');
        }
        const DOMAIN_MAP: Record<string, string> = { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle' };
        const svc = DOMAIN_MAP[action];
        if (!svc) return `Unknown action: ${action}`;
        if (!input.entity_id) return 'entity_id required';
        const entityDomain = (input.entity_id as string).split('.')[0];
        const r = await haPost(`/api/services/${entityDomain}/${svc}`, { entity_id: input.entity_id });
        return r.error ? `Error: ${r.error}` : `✅ ${action}: ${input.entity_id}`;
      }
    },
    {
      name: 'github',
      description: 'Interact with GitHub: list repos, issues, PRs, create issues, read file contents. Requires GITHUB_TOKEN env var.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list_repos | list_issues | list_prs | create_issue | get_file | search_code', enum: ['list_repos', 'list_issues', 'list_prs', 'create_issue', 'get_file', 'search_code'] },
          repo: { type: 'string', description: 'owner/repo, e.g. "mylo-2001/hyperclaw"' },
          title: { type: 'string', description: 'For create_issue: issue title' },
          body: { type: 'string', description: 'For create_issue: issue body' },
          path: { type: 'string', description: 'For get_file: file path in repo' },
          query: { type: 'string', description: 'For search_code: search query' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) return 'GITHUB_TOKEN not set. Create a token at github.com/settings/tokens.';
        const ghGet = (path2: string): Promise<any> => new Promise((resolve) => {
          https.get(`https://api.github.com${path2}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'HyperClaw', Accept: 'application/vnd.github+json' }, timeout: 8000 }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
          }).on('error', (e: Error) => resolve({ error: e.message }));
        });
        const ghPost = (path2: string, body: object): Promise<any> => new Promise((resolve) => {
          const payload = JSON.stringify(body);
          const req = https.request({ hostname: 'api.github.com', path: path2, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'HyperClaw', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res: any) => {
            let d = ''; res.on('data', (c: Buffer) => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
          });
          req.on('error', (e: Error) => resolve({ error: e.message }));
          req.write(payload); req.end();
        });
        const action = input.action as string;
        if (action === 'list_repos') {
          const r = await ghGet('/user/repos?per_page=20&sort=updated');
          if (!Array.isArray(r)) return `Error: ${JSON.stringify(r)}`;
          return r.map((repo: any) => `${repo.full_name} — ⭐${repo.stargazers_count} — ${repo.description || ''}`).join('\n');
        }
        if (action === 'list_issues') {
          if (!input.repo) return 'repo required';
          const r = await ghGet(`/repos/${input.repo}/issues?state=open&per_page=15`);
          if (!Array.isArray(r)) return `Error: ${JSON.stringify(r)}`;
          return r.map((i: any) => `#${i.number} ${i.title} [${i.state}] — ${i.html_url}`).join('\n') || 'No open issues.';
        }
        if (action === 'list_prs') {
          if (!input.repo) return 'repo required';
          const r = await ghGet(`/repos/${input.repo}/pulls?state=open&per_page=15`);
          if (!Array.isArray(r)) return `Error: ${JSON.stringify(r)}`;
          return r.map((p: any) => `#${p.number} ${p.title} by ${p.user?.login} — ${p.html_url}`).join('\n') || 'No open PRs.';
        }
        if (action === 'create_issue') {
          if (!input.repo || !input.title) return 'repo and title required';
          const r = await ghPost(`/repos/${input.repo}/issues`, { title: input.title, body: (input.body as string) || '' });
          return r.html_url ? `Issue created: ${r.html_url}` : `Error: ${JSON.stringify(r)}`;
        }
        if (action === 'get_file') {
          if (!input.repo || !input.path) return 'repo and path required';
          const r = await ghGet(`/repos/${input.repo}/contents/${input.path}`);
          if (r.content) return Buffer.from(r.content, 'base64').toString('utf8').slice(0, 3000);
          return `Error: ${JSON.stringify(r)}`;
        }
        if (action === 'search_code') {
          if (!input.query) return 'query required';
          const r = await ghGet(`/search/code?q=${encodeURIComponent(input.query as string)}&per_page=10`);
          if (!r.items) return `Error: ${JSON.stringify(r)}`;
          return r.items.map((i: any) => `${i.repository?.full_name}/${i.path} — ${i.html_url}`).join('\n') || 'No results.';
        }
        return `Unknown action: ${action}`;
      }
    },
    // ── Apple Notes (macOS only) ───────────────────────────────────────────────
    {
      name: 'apple_notes',
      description: 'Create, list, or search Apple Notes on macOS. Actions: create, list, search.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'create | list | search', enum: ['create', 'list', 'search'] },
          title: { type: 'string', description: 'Note title (for create)' },
          body: { type: 'string', description: 'Note body text (for create)' },
          query: { type: 'string', description: 'Search query (for search)' },
          limit: { type: 'string', description: 'Max results for list/search (default 10)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Apple Notes is only available on macOS.';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const exec = promisify(execFile);
        const action = input.action as string;
        if (action === 'create') {
          const title = (input.title as string || 'New Note').replace(/"/g, '\\"');
          const body = (input.body as string || '').replace(/"/g, '\\"');
          const script = `tell application "Notes"\nset newNote to make new note at default account with properties {name:"${title}", body:"${title}\\n${body}"}\nreturn name of newNote\nend tell`;
          try { const r = await exec('osascript', ['-e', script]); return `Created note: ${r.stdout.trim()}`; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        if (action === 'list') {
          const lim = parseInt((input.limit as string) || '10');
          const script = `tell application "Notes"\nset out to {}\nrepeat with n in (notes 1 thru ${lim} of default account)\nset end of out to name of n\nend repeat\nreturn out\nend tell`;
          try { const r = await exec('osascript', ['-e', script]); return r.stdout.trim() || 'No notes found.'; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        if (action === 'search') {
          const q = (input.query as string || '').replace(/"/g, '\\"');
          const script = `tell application "Notes"\nset out to {}\nrepeat with n in notes of default account\nif name of n contains "${q}" or body of n contains "${q}" then\nset end of out to name of n\nend if\nend repeat\nreturn out\nend tell`;
          try { const r = await exec('osascript', ['-e', script]); return r.stdout.trim() || 'No matching notes.'; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        return `Unknown action: ${action}`;
      }
    },
    // ── Apple Reminders (macOS only) ──────────────────────────────────────────
    {
      name: 'apple_reminders',
      description: 'Add or list Apple Reminders on macOS. Actions: add, list, list_lists.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'add | list | list_lists', enum: ['add', 'list', 'list_lists'] },
          title: { type: 'string', description: 'Reminder title (for add)' },
          list: { type: 'string', description: 'Reminder list name (default: Reminders)' },
          dueDate: { type: 'string', description: 'Due date ISO string (optional, for add)' },
          limit: { type: 'string', description: 'Max reminders to return (default 20)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Apple Reminders is only available on macOS.';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const exec = promisify(execFile);
        const action = input.action as string;
        if (action === 'list_lists') {
          const script = `tell application "Reminders"\nset out to {}\nrepeat with l in lists\nset end of out to name of l\nend repeat\nreturn out\nend tell`;
          try { const r = await exec('osascript', ['-e', script]); return r.stdout.trim() || 'No lists found.'; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        if (action === 'add') {
          if (!input.title) return 'title is required';
          const title = (input.title as string).replace(/"/g, '\\"');
          const listName = ((input.list as string) || 'Reminders').replace(/"/g, '\\"');
          const script = `tell application "Reminders"\ntell list "${listName}"\nmake new reminder with properties {name:"${title}"}\nend tell\nend tell`;
          try { await exec('osascript', ['-e', script]); return `Reminder "${title}" added to ${listName}.`; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        if (action === 'list') {
          const lim = parseInt((input.limit as string) || '20');
          const listName = input.list as string;
          const script = listName
            ? `tell application "Reminders"\nset out to {}\nrepeat with r in reminders of list "${listName.replace(/"/g, '\\"')}"\nif completed of r is false then set end of out to name of r\nend repeat\nreturn out\nend tell`
            : `tell application "Reminders"\nset out to {}\nrepeat with r in (reminders whose completed is false)\nset end of out to name of r\nif (count of out) >= ${lim} then exit repeat\nend repeat\nreturn out\nend tell`;
          try { const r = await exec('osascript', ['-e', script]); return r.stdout.trim() || 'No pending reminders.'; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        return `Unknown action: ${action}`;
      }
    },
    // ── Things 3 (macOS only, URL scheme) ────────────────────────────────────
    {
      name: 'things3',
      description: 'Add a to-do to Things 3 on macOS via URL scheme. Actions: add.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'add', enum: ['add'] },
          title: { type: 'string', description: 'Task title' },
          notes: { type: 'string', description: 'Task notes (optional)' },
          deadline: { type: 'string', description: 'Deadline date YYYY-MM-DD (optional)' },
          list: { type: 'string', description: 'Project or area name (optional)' },
          tags: { type: 'string', description: 'Comma-separated tags (optional)' }
        },
        required: ['action', 'title']
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Things 3 is only available on macOS.';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const exec = promisify(execFile);
        const title = encodeURIComponent(input.title as string);
        const params = [`title=${title}`];
        if (input.notes) params.push(`notes=${encodeURIComponent(input.notes as string)}`);
        if (input.deadline) params.push(`deadline=${encodeURIComponent(input.deadline as string)}`);
        if (input.list) params.push(`list=${encodeURIComponent(input.list as string)}`);
        if (input.tags) params.push(`tags=${encodeURIComponent(input.tags as string)}`);
        const url = `things:///add?${params.join('&')}`;
        try {
          await exec('open', [url]);
          return `Added to Things 3: "${input.title}"`;
        } catch (e: any) { return `Error: ${e.message}. Is Things 3 installed?`; }
      }
    },
    // ── Obsidian (Local REST API plugin) ─────────────────────────────────────
    {
      name: 'obsidian',
      description: 'Read, create, or search notes in Obsidian via Local REST API plugin. Set OBSIDIAN_API_KEY (and optionally OBSIDIAN_PORT, default 27123). Actions: search, read, create.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'search | read | create', enum: ['search', 'read', 'create'] },
          query: { type: 'string', description: 'Search query (for search)' },
          path: { type: 'string', description: 'Note path in vault e.g. "folder/note.md" (for read/create)' },
          content: { type: 'string', description: 'Note content in markdown (for create)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const apiKey = process.env.OBSIDIAN_API_KEY;
        if (!apiKey) return 'OBSIDIAN_API_KEY not set. Install Obsidian Local REST API plugin and set the env var.';
        const port = parseInt(process.env.OBSIDIAN_PORT || '27123');
        const action = input.action as string;
        const doReq = (method: string, endpoint: string, body?: string): Promise<any> =>
          new Promise((resolve, reject) => {
            const opts = { hostname: '127.0.0.1', port, path: endpoint, method, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } };
            const req = http.request(opts, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
          });
        if (action === 'search') {
          if (!input.query) return 'query required';
          try {
            const r = await doReq('POST', '/search/simple/', JSON.stringify({ query: input.query, contextLength: 100 }));
            if (!Array.isArray(r)) return `Error: ${JSON.stringify(r)}`;
            return r.map((x: any) => `${x.filename}: ...${x.context}...`).join('\n') || 'No results.';
          } catch (e: any) { return `Error: ${e.message}`; }
        }
        if (action === 'read') {
          if (!input.path) return 'path required';
          try {
            const r = await doReq('GET', `/vault/${encodeURIComponent(input.path as string)}`);
            return typeof r === 'string' ? r : JSON.stringify(r);
          } catch (e: any) { return `Error: ${e.message}`; }
        }
        if (action === 'create') {
          if (!input.path || !input.content) return 'path and content required';
          try {
            await doReq('PUT', `/vault/${encodeURIComponent(input.path as string)}`, JSON.stringify(input.content));
            return `Note created/updated at ${input.path}`;
          } catch (e: any) { return `Error: ${e.message}`; }
        }
        return `Unknown action: ${action}`;
      }
    },
    // ── Bear Notes (macOS only, x-callback-url) ───────────────────────────────
    {
      name: 'bear_notes',
      description: 'Create or search notes in Bear on macOS via x-callback-url. Actions: create, search.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'create | search', enum: ['create', 'search'] },
          title: { type: 'string', description: 'Note title (for create)' },
          text: { type: 'string', description: 'Note body (for create)' },
          tags: { type: 'string', description: 'Comma-separated tags (for create)' },
          query: { type: 'string', description: 'Search query (for search)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'Bear Notes is only available on macOS.';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const exec = promisify(execFile);
        const action = input.action as string;
        if (action === 'create') {
          if (!input.title && !input.text) return 'title or text required';
          const params: string[] = [];
          if (input.title) params.push(`title=${encodeURIComponent(input.title as string)}`);
          if (input.text) params.push(`text=${encodeURIComponent(input.text as string)}`);
          if (input.tags) params.push(`tags=${encodeURIComponent(input.tags as string)}`);
          const url = `bear://x-callback-url/create?${params.join('&')}`;
          try { await exec('open', [url]); return `Note created in Bear: "${input.title || '(untitled)'}"`.trim(); }
          catch (e: any) { return `Error: ${e.message}. Is Bear installed?`; }
        }
        if (action === 'search') {
          if (!input.query) return 'query required';
          const url = `bear://x-callback-url/search?term=${encodeURIComponent(input.query as string)}`;
          try { await exec('open', [url]); return `Bear search opened for: "${input.query}"`; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        return `Unknown action: ${action}`;
      }
    },
    // ── Trello (REST API) ─────────────────────────────────────────────────────
    {
      name: 'trello',
      description: 'Interact with Trello boards and cards. Set TRELLO_API_KEY and TRELLO_TOKEN. Actions: list_boards, list_lists, list_cards, add_card, move_card.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list_boards | list_lists | list_cards | add_card | move_card', enum: ['list_boards', 'list_lists', 'list_cards', 'add_card', 'move_card'] },
          boardId: { type: 'string', description: 'Board ID (for list_lists, list_cards)' },
          listId: { type: 'string', description: 'List ID (for list_cards, add_card, move_card)' },
          cardId: { type: 'string', description: 'Card ID (for move_card)' },
          name: { type: 'string', description: 'Card name (for add_card)' },
          desc: { type: 'string', description: 'Card description (for add_card)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const key = process.env.TRELLO_API_KEY;
        const token = process.env.TRELLO_TOKEN;
        if (!key || !token) return 'TRELLO_API_KEY and TRELLO_TOKEN must be set.';
        const action = input.action as string;
        const auth = `key=${key}&token=${token}`;
        const trelloGet = (path: string): Promise<any> =>
          new Promise((resolve, reject) => {
            const req = https.request({ hostname: 'api.trello.com', path: `${path}${path.includes('?') ? '&' : '?'}${auth}`, method: 'GET', headers: { Accept: 'application/json' } }, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            req.on('error', reject); req.end();
          });
        const trelloPost = (path: string, body: Record<string, string>): Promise<any> =>
          new Promise((resolve, reject) => {
            const qs = new URLSearchParams({ ...body, key, token }).toString();
            const req = https.request({ hostname: 'api.trello.com', path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(qs) } }, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            req.on('error', reject); req.write(qs); req.end();
          });
        try {
          if (action === 'list_boards') {
            const r = await trelloGet('/1/members/me/boards?fields=id,name,url');
            return r.map((b: any) => `${b.name} (${b.id}): ${b.url}`).join('\n') || 'No boards.';
          }
          if (action === 'list_lists') {
            if (!input.boardId) return 'boardId required';
            const r = await trelloGet(`/1/boards/${input.boardId}/lists?fields=id,name`);
            return r.map((l: any) => `${l.name} (${l.id})`).join('\n') || 'No lists.';
          }
          if (action === 'list_cards') {
            if (!input.listId) return 'listId required';
            const r = await trelloGet(`/1/lists/${input.listId}/cards?fields=id,name,desc`);
            return r.map((c: any) => `${c.name} (${c.id})`).join('\n') || 'No cards.';
          }
          if (action === 'add_card') {
            if (!input.listId || !input.name) return 'listId and name required';
            const r = await trelloPost('/1/cards', { idList: input.listId as string, name: input.name as string, desc: (input.desc as string) || '' });
            return `Card created: ${r.name} (${r.id}) — ${r.url}`;
          }
          if (action === 'move_card') {
            if (!input.cardId || !input.listId) return 'cardId and listId required';
            const qs = `key=${key}&token=${token}&idList=${input.listId}`;
            await new Promise<void>((resolve, reject) => {
              const req = https.request({ hostname: 'api.trello.com', path: `/1/cards/${input.cardId}`, method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(qs) } }, (res) => {
                res.on('data', () => {}); res.on('end', resolve);
              });
              req.on('error', reject); req.write(qs); req.end();
            });
            return `Card ${input.cardId} moved to list ${input.listId}.`;
          }
          return `Unknown action: ${action}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      }
    },
    // ── Sonos (local UPnP HTTP) ───────────────────────────────────────────────
    {
      name: 'sonos',
      description: 'Control a Sonos speaker over local network. Set SONOS_IP (e.g. 192.168.1.x). Actions: play, pause, next, previous, volume, info.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'play | pause | next | previous | volume | info', enum: ['play', 'pause', 'next', 'previous', 'volume', 'info'] },
          volume: { type: 'string', description: 'Volume 0-100 (for volume action)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const ip = process.env.SONOS_IP;
        if (!ip) return 'SONOS_IP not set. Set it to your Sonos speaker\'s local IP address.';
        const action = input.action as string;
        const soapPost = (path: string, service: string, soapAction: string, body: string): Promise<string> =>
          new Promise((resolve, reject) => {
            const payload = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>${body}</s:Body></s:Envelope>`;
            const req = http.request({ hostname: ip, port: 1400, path, method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service}#${soapAction}"`, 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => resolve(d));
            });
            req.on('error', reject); req.write(payload); req.end();
          });
        const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
        const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
        try {
          if (action === 'play') {
            await soapPost('/MediaRenderer/AVTransport/Control', AVT, 'Play', `<u:Play xmlns:u="${AVT}"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play>`);
            return 'Sonos playing.';
          }
          if (action === 'pause') {
            await soapPost('/MediaRenderer/AVTransport/Control', AVT, 'Pause', `<u:Pause xmlns:u="${AVT}"><InstanceID>0</InstanceID></u:Pause>`);
            return 'Sonos paused.';
          }
          if (action === 'next') {
            await soapPost('/MediaRenderer/AVTransport/Control', AVT, 'Next', `<u:Next xmlns:u="${AVT}"><InstanceID>0</InstanceID></u:Next>`);
            return 'Skipped to next track.';
          }
          if (action === 'previous') {
            await soapPost('/MediaRenderer/AVTransport/Control', AVT, 'Previous', `<u:Previous xmlns:u="${AVT}"><InstanceID>0</InstanceID></u:Previous>`);
            return 'Went to previous track.';
          }
          if (action === 'volume') {
            const vol = parseInt((input.volume as string) || '50');
            await soapPost('/MediaRenderer/RenderingControl/Control', RC, 'SetVolume', `<u:SetVolume xmlns:u="${RC}"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${vol}</DesiredVolume></u:SetVolume>`);
            return `Volume set to ${vol}.`;
          }
          if (action === 'info') {
            const r = await soapPost('/MediaRenderer/AVTransport/Control', AVT, 'GetTransportInfo', `<u:GetTransportInfo xmlns:u="${AVT}"><InstanceID>0</InstanceID></u:GetTransportInfo>`);
            const state = r.match(/<CurrentTransportState>(.+?)<\/CurrentTransportState>/)?.[1] ?? 'Unknown';
            return `Sonos state: ${state}`;
          }
          return `Unknown action: ${action}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      }
    },
    // ── Shazam / Music Search (iTunes Search API, free) ──────────────────────
    {
      name: 'shazam',
      description: 'Search for songs, albums, or artists using iTunes Search API (free, no key needed). Actions: search.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'search', enum: ['search'] },
          query: { type: 'string', description: 'Song, artist, or album to search for' },
          type: { type: 'string', description: 'musicTrack | album | musicArtist (default: musicTrack)' },
          limit: { type: 'string', description: 'Max results (default 5)' }
        },
        required: ['action', 'query']
      },
      handler: async (input) => {
        const query = encodeURIComponent(input.query as string);
        const entity = (input.type as string) || 'musicTrack';
        const limit = parseInt((input.limit as string) || '5');
        const r: any = await new Promise((resolve, reject) => {
          const req = https.request({ hostname: 'itunes.apple.com', path: `/search?term=${query}&entity=${entity}&limit=${limit}`, method: 'GET', headers: { 'User-Agent': 'HyperClaw/4' } }, (res) => {
            let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
          });
          req.on('error', reject); req.end();
        });
        if (!r.results?.length) return 'No results found.';
        return r.results.map((t: any) =>
          entity === 'musicTrack'
            ? `"${t.trackName}" by ${t.artistName} (${t.collectionName || 'Single'}) — ${t.trackViewUrl}`
            : entity === 'album'
            ? `${t.collectionName} by ${t.artistName} — ${t.collectionViewUrl}`
            : `${t.artistName} — ${t.artistViewUrl}`
        ).join('\n');
      }
    },
    // ── Philips Hue (local bridge) ────────────────────────────────────────────
    {
      name: 'philips_hue',
      description: 'Control Philips Hue lights via local bridge. Set HUE_BRIDGE_IP and HUE_USERNAME (run bridge discovery once to get these). Actions: list_lights, turn_on, turn_off, brightness, color.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list_lights | turn_on | turn_off | brightness | color', enum: ['list_lights', 'turn_on', 'turn_off', 'brightness', 'color'] },
          lightId: { type: 'string', description: 'Light ID (from list_lights). Use "all" to affect all lights.' },
          brightness: { type: 'string', description: 'Brightness 0-254 (for brightness action)' },
          color: { type: 'string', description: 'Color as hue 0-65535 (for color action)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const bridgeIp = process.env.HUE_BRIDGE_IP;
        const username = process.env.HUE_USERNAME;
        if (!bridgeIp || !username) return 'HUE_BRIDGE_IP and HUE_USERNAME must be set. See Philips Hue developer portal to get your bridge username.';
        const action = input.action as string;
        const hueReq = (method: string, path: string, body?: object): Promise<any> =>
          new Promise((resolve, reject) => {
            const payload = body ? JSON.stringify(body) : undefined;
            const opts: any = { hostname: bridgeIp, path: `/api/${username}${path}`, method, headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } };
            const req = http.request(opts, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
          });
        try {
          if (action === 'list_lights') {
            const r = await hueReq('GET', '/lights');
            if (typeof r !== 'object') return `Error: ${r}`;
            return Object.entries(r).map(([id, l]: [string, any]) => `[${id}] ${l.name} — ${l.state?.on ? 'ON' : 'OFF'}, bri: ${l.state?.bri}`).join('\n') || 'No lights found.';
          }
          const lid = input.lightId as string;
          if (!lid) return 'lightId required';
          const ids = lid === 'all'
            ? Object.keys(await hueReq('GET', '/lights'))
            : [lid];
          if (action === 'turn_on') {
            for (const id of ids) await hueReq('PUT', `/lights/${id}/state`, { on: true });
            return `Light(s) ${ids.join(', ')} turned ON.`;
          }
          if (action === 'turn_off') {
            for (const id of ids) await hueReq('PUT', `/lights/${id}/state`, { on: false });
            return `Light(s) ${ids.join(', ')} turned OFF.`;
          }
          if (action === 'brightness') {
            const bri = Math.min(254, Math.max(0, parseInt((input.brightness as string) || '128')));
            for (const id of ids) await hueReq('PUT', `/lights/${id}/state`, { on: true, bri });
            return `Brightness set to ${bri} for light(s) ${ids.join(', ')}.`;
          }
          if (action === 'color') {
            const hue = Math.min(65535, Math.max(0, parseInt((input.color as string) || '0')));
            for (const id of ids) await hueReq('PUT', `/lights/${id}/state`, { on: true, hue, sat: 254 });
            return `Color (hue ${hue}) set for light(s) ${ids.join(', ')}.`;
          }
          return `Unknown action: ${action}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      }
    },
    // ── 8Sleep (unofficial REST API) ─────────────────────────────────────────
    {
      name: 'eightsleep',
      description: 'Control your Eight Sleep Pod. Set EIGHTSLEEP_EMAIL and EIGHTSLEEP_PASSWORD. Actions: get_status, set_temperature.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'get_status | set_temperature', enum: ['get_status', 'set_temperature'] },
          side: { type: 'string', description: 'left | right | solo (default: solo)' },
          level: { type: 'string', description: 'Temperature level -100 to 100 (for set_temperature)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const email = process.env.EIGHTSLEEP_EMAIL;
        const password = process.env.EIGHTSLEEP_PASSWORD;
        if (!email || !password) return 'EIGHTSLEEP_EMAIL and EIGHTSLEEP_PASSWORD must be set.';
        const action = input.action as string;
        const apiPost = (path: string, body: object, token?: string): Promise<any> =>
          new Promise((resolve, reject) => {
            const payload = JSON.stringify(body);
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) };
            if (token) hdrs['authorization'] = `Bearer ${token}`;
            const req = https.request({ hostname: 'client-api.8slp.net', path, method: 'POST', headers: hdrs }, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            req.on('error', reject); req.write(payload); req.end();
          });
        const apiGet = (path: string, token: string): Promise<any> =>
          new Promise((resolve, reject) => {
            const req = https.request({ hostname: 'client-api.8slp.net', path, method: 'GET', headers: { authorization: `Bearer ${token}` } }, (res) => {
              let d = ''; res.on('data', (c: Buffer) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
            });
            req.on('error', reject); req.end();
          });
        try {
          const authR = await apiPost('/v1/login', { email, password });
          const token = authR?.session?.token;
          if (!token) return `Auth failed: ${JSON.stringify(authR)}`;
          const userId = authR?.session?.userId;
          const device = await apiGet(`/v1/users/${userId}/devices`, token);
          const deviceId = device?.result?.devices?.[0];
          if (!deviceId) return 'No 8Sleep device found on account.';
          if (action === 'get_status') {
            const status = await apiGet(`/v1/devices/${deviceId}?filter=currentState`, token);
            const s = status?.result;
            return `8Sleep device: ${deviceId}\nLeft: ${s?.leftCurrentState?.currentTemperatureRequestLevel ?? 'N/A'}, Right: ${s?.rightCurrentState?.currentTemperatureRequestLevel ?? 'N/A'}`;
          }
          if (action === 'set_temperature') {
            const level = parseInt((input.level as string) || '0');
            const side = (input.side as string) || 'solo';
            const sideKey = side === 'left' ? 'leftHeatingLevel' : side === 'right' ? 'rightHeatingLevel' : 'targetHeatingLevel';
            const r = await apiPost(`/v1/devices/${deviceId}/users/${userId}/temperature`, { [sideKey]: level }, token);
            return `8Sleep temperature set to ${level} on ${side} side.`;
          }
          return `Unknown action: ${action}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      }
    },
    // ── 1Password (op CLI) ────────────────────────────────────────────────────
    {
      name: 'onepassword',
      description: 'Access 1Password items via op CLI. Set OP_SERVICE_ACCOUNT_TOKEN. Actions: get_item, list_items.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'get_item | list_items', enum: ['get_item', 'list_items'] },
          item: { type: 'string', description: 'Item name or UUID (for get_item)' },
          vault: { type: 'string', description: 'Vault name (optional)' },
          fields: { type: 'string', description: 'Comma-separated field labels to return (for get_item, default: username,password)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
        if (!token) return 'OP_SERVICE_ACCOUNT_TOKEN not set. Create a service account at 1password.com/developer.';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const exec = promisify(execFile);
        const env = { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token };
        const action = input.action as string;
        try {
          if (action === 'list_items') {
            const args = ['item', 'list', '--format=json'];
            if (input.vault) args.push(`--vault=${input.vault}`);
            const r = await exec('op', args, { env });
            const items: any[] = JSON.parse(r.stdout);
            return items.map((i: any) => `${i.title} (${i.id}) — vault: ${i.vault?.name || 'unknown'}`).join('\n') || 'No items found.';
          }
          if (action === 'get_item') {
            if (!input.item) return 'item name or UUID required';
            const fields = ((input.fields as string) || 'username,password').split(',').map((f: string) => f.trim());
            const args = ['item', 'get', input.item as string, '--format=json'];
            if (input.vault) args.push(`--vault=${input.vault}`);
            const r = await exec('op', args, { env });
            const item = JSON.parse(r.stdout);
            const result: Record<string, string> = {};
            for (const f of item.fields || []) {
              if (fields.includes(f.label?.toLowerCase()) || fields.includes(f.id)) {
                result[f.label || f.id] = f.value || '';
              }
            }
            return Object.entries(result).map(([k, v]) => `${k}: ${v}`).join('\n') || 'No matching fields found.';
          }
          return `Unknown action: ${action}`;
        } catch (e: any) { return `Error: ${e.message}\nMake sure 'op' CLI is installed (brew install 1password-cli).`; }
      }
    },
    // ── iMessage (macOS AppleScript) ──────────────────────────────────────────
    {
      name: 'imessage',
      description: 'Send iMessages or list recent conversations on macOS via AppleScript. Actions: send, list_conversations.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'send | list_conversations', enum: ['send', 'list_conversations'] },
          to: { type: 'string', description: 'Recipient phone number or email (for send)' },
          message: { type: 'string', description: 'Message text to send (for send)' },
          limit: { type: 'string', description: 'Max conversations to list (default 10)' }
        },
        required: ['action']
      },
      handler: async (input) => {
        if (process.platform !== 'darwin') return 'iMessage is only available on macOS.';
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const exec = promisify(execFile);
        const action = input.action as string;
        if (action === 'send') {
          if (!input.to || !input.message) return 'to and message are required';
          const to = (input.to as string).replace(/"/g, '\\"');
          const msg = (input.message as string).replace(/"/g, '\\"');
          const script = `tell application "Messages"\nset targetBuddy to "${to}"\nset targetService to first service whose service type = iMessage\nset targetBuddy to buddy targetBuddy of targetService\nsend "${msg}" to targetBuddy\nend tell`;
          try { await exec('osascript', ['-e', script]); return `iMessage sent to ${input.to}.`; }
          catch (e: any) { return `Error: ${e.message}\nMake sure Messages.app is signed in and has accessibility permissions.`; }
        }
        if (action === 'list_conversations') {
          const lim = parseInt((input.limit as string) || '10');
          const script = `tell application "Messages"\nset out to {}\nrepeat with c in (chats 1 thru ${lim})\nset end of out to name of c\nend repeat\nreturn out\nend tell`;
          try { const r = await exec('osascript', ['-e', script]); return r.stdout.trim() || 'No conversations found.'; }
          catch (e: any) { return `Error: ${e.message}`; }
        }
        return `Unknown action: ${action}`;
      }
    },
    // ── Install skill from URL (clawhub.ai / any SKILL.md URL) ───────────────
    {
      name: 'install_skill_from_hub',
      description: 'Install a skill by URL from clawhub.ai or any SKILL.md URL. Fetches the skill, extracts SKILL.md and files, installs npm deps if needed. Use when user gives a clawhub.ai link.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'clawhub.ai skill URL, e.g. https://clawhub.ai/owner/skill-slug' },
          npmInstall: { type: 'string', description: 'Set to "true" to run npm install if the skill has a package.json' }
        },
        required: ['url']
      },
      handler: async (input) => {
        const rawUrl = (input.url as string).trim().replace(/\/$/, '');

        // Helper: HTTPS GET → string
        const fetchText = (url: string): Promise<{ status: number; body: string }> =>
          new Promise((resolve, reject) => {
            const mod = url.startsWith('https') ? https : http;
            const doReq = (u: string, redirects = 0): void => {
              const req = (mod as typeof https).request(u, { method: 'GET', headers: { 'User-Agent': 'HyperClaw/4', Accept: 'text/html,application/json,text/plain' } }, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects < 5) {
                  doReq(res.headers.location as string, redirects + 1);
                  return;
                }
                let d = '';
                res.setEncoding('utf8');
                res.on('data', (c: string) => d += c);
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
              });
              req.on('error', reject);
              req.end();
            };
            doReq(url);
          });

        // ── Strategy 1: clawhub.ai REST API (try common patterns) ──────────
        // URL shape: https://clawhub.ai/{owner}/{slug}
        const hubMatch = rawUrl.match(/https?:\/\/clawhub\.ai\/([^/]+)\/([^/?#]+)/);
        if (hubMatch) {
          const [, owner, slug] = hubMatch;

          // Try JSON API endpoint
          const apiUrls = [
            `https://clawhub.ai/api/skills/${owner}/${slug}`,
            `https://clawhub.ai/api/v1/skills/${owner}/${slug}`,
          ];
          for (const apiUrl of apiUrls) {
            try {
              const { status, body } = await fetchText(apiUrl);
              if (status === 200) {
                const data = JSON.parse(body);
                // Expect { skill: { skillId, name, description, skillMd, files, ... } }
                const s = data?.skill || data;
                if (s?.skillMd || s?.content || s?.skill_md) {
                  const skillId = s.slug || s.skillId || slug;
                  const skillMd = s.skillMd || s.content || s.skill_md || '';
                  const extraFiles: Record<string, string> = s.files || {};
                  const { writeSkill } = await import('./skill-loader');
                  const { dir, id } = await writeSkill(skillId, { name: s.name, description: s.description, content: skillMd });
                  const results = [`SKILL.md → written`];
                  for (const [rel, content] of Object.entries(extraFiles)) {
                    const norm = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
                    const fp = path.join(dir, norm);
                    await fs.ensureDir(path.dirname(fp));
                    await fs.writeFile(fp, content as string, 'utf8');
                    results.push(`${norm} → written`);
                  }
                  if (input.npmInstall === 'true' && await fs.pathExists(path.join(dir, 'package.json'))) {
                    const { execFile } = await import('child_process');
                    const { promisify } = await import('util');
                    await promisify(execFile)('npm', ['install', '--omit=dev'], { cwd: dir, timeout: 120_000 }).catch((e: any) => results.push(`npm install failed: ${e.message}`));
                    results.push('npm install → done');
                  }
                  return `Skill "${id}" installed from ${rawUrl}\n${results.join('\n')}\nLoads on next turn.`;
                }
              }
            } catch { /* try next */ }
          }

          // Try raw SKILL.md endpoint
          const rawSkillUrls = [
            `https://clawhub.ai/${owner}/${slug}/raw/SKILL.md`,
            `https://clawhub.ai/skills/${owner}/${slug}/SKILL.md`,
            `https://raw.clawhub.ai/${owner}/${slug}/SKILL.md`,
          ];
          for (const rawSkillUrl of rawSkillUrls) {
            try {
              const { status, body } = await fetchText(rawSkillUrl);
              if (status === 200 && body.trim().length > 20) {
                const { writeSkill } = await import('./skill-loader');
                const { id } = await writeSkill(slug, { content: body });
                return `Skill "${id}" installed from ${rawSkillUrl}\nLoads on next turn.`;
              }
            } catch { /* try next */ }
          }
        }

        // ── Strategy 2: direct SKILL.md URL ──────────────────────────────────
        if (rawUrl.endsWith('SKILL.md') || rawUrl.includes('/raw/')) {
          try {
            const { status, body } = await fetchText(rawUrl);
            if (status === 200 && body.trim().length > 20) {
              const slugFromUrl = rawUrl.split('/').slice(-3, -1).join('-') || 'custom-skill';
              const { writeSkill } = await import('./skill-loader');
              const { id } = await writeSkill(slugFromUrl, { content: body });
              return `Skill "${id}" installed from ${rawUrl}\nLoads on next turn.`;
            }
          } catch (e: any) { return `Failed to fetch SKILL.md: ${e.message}`; }
        }

        // ── Strategy 3: fetch HTML page and extract SKILL.md block ───────────
        try {
          const { status, body } = await fetchText(rawUrl);
          if (status !== 200) return `Could not fetch ${rawUrl} (HTTP ${status}). Try pasting the SKILL.md content directly.`;

          // Look for SKILL.md content in page (frontmatter or code block)
          const fmMatch = body.match(/---\s*\n[\s\S]*?name:\s*([^\n]+)[\s\S]*?---\s*\n([\s\S]+?)(?=<|```|$)/);
          if (fmMatch) {
            const [fullMatch] = fmMatch;
            const slugFromUrl = rawUrl.split('/').pop() || 'custom-skill';
            const { writeSkill } = await import('./skill-loader');
            const { id } = await writeSkill(slugFromUrl, { content: fullMatch });
            return `Skill "${id}" extracted from page and installed.\nLoads on next turn.`;
          }

          // No SKILL.md found — return page summary for agent to parse manually
          const preview = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
          return `Could not auto-extract SKILL.md from ${rawUrl}.\nPage preview:\n${preview}\n\nPaste the SKILL.md content directly and I'll install it with create_skill.`;
        } catch (e: any) {
          return `Error fetching ${rawUrl}: ${e.message}\n\nPaste the SKILL.md content directly and I'll install it with create_skill.`;
        }
      }
    },
    {
      name: 'create_skill',
      description: 'Create or overwrite a custom skill (self-writing skills). Supports multi-file skills with npm dependencies. The skill will be loaded on next message.',
      input_schema: {
        type: 'object',
        properties: {
          skillId: { type: 'string', description: 'Unique slug, e.g. "stealth-browser" or "remind-weekly"' },
          name: { type: 'string', description: 'Human-readable name' },
          description: { type: 'string', description: 'Short description of when to use' },
          content: { type: 'string', description: 'Full SKILL.md body: instructions, when to use, steps. Use markdown.' },
          files: { type: 'string', description: 'JSON object of extra files to write alongside SKILL.md. Keys are relative paths (e.g. "scripts/browser.js"), values are file contents.' },
          npmInstall: { type: 'string', description: 'Set to "true" to run npm install in the skill directory after writing files (requires package.json in files).' }
        },
        required: ['skillId', 'content']
      },
      handler: async (input) => {
        const { writeSkill } = await import('./skill-loader');
        const { path: p, id, dir } = await writeSkill(input.skillId as string, {
          name: input.name as string,
          description: input.description as string,
          content: input.content as string
        });

        const results: string[] = [`SKILL.md → ${p}`];

        // Write extra files if provided
        if (input.files) {
          let extraFiles: Record<string, string>;
          try {
            extraFiles = JSON.parse(input.files as string);
          } catch {
            return `Error: "files" must be a valid JSON object mapping relative paths to file contents.`;
          }
          for (const [relPath, content] of Object.entries(extraFiles)) {
            // Security: disallow absolute paths and path traversal
            const norm = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
            if (path.isAbsolute(norm) || norm.startsWith('..')) {
              results.push(`Skipped ${relPath}: path traversal not allowed`);
              continue;
            }
            const filePath = path.join(dir, norm);
            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content as string, 'utf8');
            results.push(`${norm} → written`);
          }
        }

        // Run npm install if requested and package.json exists
        if (input.npmInstall === 'true') {
          const pkgJson = path.join(dir, 'package.json');
          if (await fs.pathExists(pkgJson)) {
            try {
              const { execFile } = await import('child_process');
              const { promisify } = await import('util');
              await promisify(execFile)('npm', ['install', '--omit=dev'], { cwd: dir, timeout: 120_000 });
              results.push('npm install → done');
            } catch (e: any) {
              results.push(`npm install → failed: ${e.message}`);
            }
          } else {
            results.push('npm install → skipped (no package.json found)');
          }
        }

        return `Skill "${id}" installed at ${dir}\n${results.join('\n')}\n\nIt will be loaded on the next turn.`;
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
