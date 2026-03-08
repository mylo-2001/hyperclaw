/**
 * src/services/mcp-loader.ts
 * MCP (Model Context Protocol) client � load tools from external MCP servers.
 * Config: mcp.servers: [{ name, command, args? }] or [{ name, url }]
 *
 * Requires: npm install @modelcontextprotocol/sdk
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import type { Tool } from '../../packages/core/src/agent/inference';

const HC_DIR = path.join(os.homedir(), '.hyperclaw');

export interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
}

async function getMCPConfig(): Promise<MCPServerConfig[]> {
  try {
    const cfg = await fs.readJson(path.join(HC_DIR, 'hyperclaw.json'));
    const servers = (cfg.mcp?.servers ?? []) as MCPServerConfig[];
    return Array.isArray(servers) ? servers : [];
  } catch {
    return [];
  }
}

/** Load tools from all configured MCP servers. */
export async function loadMCPTools(): Promise<Tool[]> {
  const servers = await getMCPConfig();
  if (servers.length === 0) return [];

  let Client: any;
  let StdioClientTransport: any;
  let StreamableHTTPClientTransport: any;
  try {
    // @ts-expect-error - optional dependency, may be missing
    const sdk = await import('@modelcontextprotocol/sdk');
    Client = sdk.Client;
    StdioClientTransport = sdk.StdioClientTransport;
    StreamableHTTPClientTransport = sdk.StreamableHTTPClientTransport;
  } catch {
    return [];
  }

  const tools: Tool[] = [];

  for (const srv of servers) {
    try {
      const client = new Client({ name: 'hyperclaw', version: '5.2.0' });

      if (srv.url) {
        const transport = new StreamableHTTPClientTransport(new URL(srv.url));
        await client.connect(transport);
      } else if (srv.command) {
        const transport = new StdioClientTransport({
          command: srv.command,
          args: srv.args ?? []
        });
        await client.connect(transport);
      } else continue;

      const allTools: any[] = [];
      let cursor: string | undefined;
      do {
        const res = await client.listTools?.({ cursor }) ?? { tools: [], nextCursor: undefined };
        allTools.push(...(res.tools ?? []));
        cursor = res.nextCursor;
      } while (cursor);

      for (const t of allTools) {
        const toolName = t.name;
        const mcpClient = client;
        tools.push({
          name: `mcp_${srv.name}_${toolName}`.replace(/[^a-z0-9_]/gi, '_'),
          description: (t.description ?? toolName).slice(0, 500),
          input_schema: (t.inputSchema && typeof t.inputSchema === 'object' && 'type' in t.inputSchema && 'properties' in t.inputSchema)
            ? (t.inputSchema as { type: 'object'; properties: Record<string, { type: string; description: string; enum?: string[] }> })
            : { type: 'object' as const, properties: {} as Record<string, { type: string; description: string; enum?: string[] }> },
          handler: async (input: Record<string, unknown>) => {
            try {
              const result = await mcpClient.callTool?.({ name: toolName, arguments: input });
              const content = result?.content;
              if (Array.isArray(content)) {
                return content.map((c: any) => c?.text ?? JSON.stringify(c)).join('\n');
              }
              return typeof content === 'string' ? content : JSON.stringify(result ?? {});
            } catch (e: any) {
              return `MCP error: ${e.message}`;
            }
          }
        });
      }
    } catch (e: any) {
      console.error(`[mcp] Failed to load ${srv.name}:`, e.message);
    }
  }

  return tools;
}
