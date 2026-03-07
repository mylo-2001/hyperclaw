# MCP (Model Context Protocol)

HyperClaw supports the [Model Context Protocol](https://modelcontextprotocol.io/) — a standard for connecting AI agents to external tools and data sources.

## What is MCP?

MCP lets HyperClaw talk to external **tool servers** via a simple JSON-RPC protocol over stdio or HTTP. Each server exposes a set of tools (functions) the AI can call.

Instead of hardcoding tools into the agent, MCP servers are **plug-and-play** processes you start separately, then register with HyperClaw.

## CLI Commands

```bash
hyperclaw mcp list          # list registered servers
hyperclaw mcp add           # register a new server (interactive)
hyperclaw mcp remove <id>   # remove a server
hyperclaw mcp probe [id]    # test connection and discover tools
```

## Built-in HyperClaw MCP Servers

HyperClaw ships four ready-to-use MCP servers in the `extensions/` folder:

### mcp-filesystem

Reads and writes files on your machine.

```bash
node extensions/mcp-filesystem/server.mjs
```

| Tool | Description |
|------|-------------|
| `read_file` | Read a file's contents |
| `write_file` | Write/overwrite a file |
| `list_directory` | List files in a directory |
| `search_files` | Find files by name pattern |
| `file_info` | Get file metadata (size, type, mtime) |
| `delete_file` | Delete a file |

### mcp-github

Interact with GitHub repositories, issues, PRs, and code search.

```bash
GITHUB_TOKEN=ghp_xxx node extensions/mcp-github/server.mjs
```

| Tool | Description |
|------|-------------|
| `list_repos` | List repos for a user or org |
| `get_repo` | Get repo metadata |
| `list_issues` | List issues (with state/label filters) |
| `create_issue` | Create an issue |
| `get_file` | Read a file from a repo |
| `search_code` | Search code across GitHub |
| `list_prs` | List pull requests |
| `get_pr` | Get PR details and diff |

**Requires**: `GITHUB_TOKEN` environment variable.

### mcp-browser

Web scraping, search, and OSINT web tools.

```bash
node extensions/mcp-browser/server.mjs
```

| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch a URL, returns readable text |
| `web_search` | Search via DuckDuckGo |
| `extract_links` | Extract all links from a page |
| `get_page_title` | Get `<title>` and meta description |
| `dns_lookup` | DNS records for a domain |
| `whois_lookup` | WHOIS/RDAP data for a domain |

### mcp-terminal

Shell command execution. **Use only in trusted environments.**

```bash
node extensions/mcp-terminal/server.mjs
# or with command restrictions:
ALLOWED_COMMANDS="ls,cat,git,npm" node extensions/mcp-terminal/server.mjs
```

| Tool | Description |
|------|-------------|
| `run_command` | Run a shell command (30s timeout) |
| `run_script` | Run a multi-line shell script |
| `get_environment` | List env variables (secrets masked) |
| `list_processes` | List running processes |
| `get_system_info` | OS, CPU, memory, uptime |

**Security**: Set `ALLOWED_COMMANDS` to a comma-separated list of allowed command prefixes. Dangerous patterns (`rm -rf /`, etc.) are always blocked.

## Using Official Anthropic MCP Servers

The official `@modelcontextprotocol/server-*` packages work out of the box:

```bash
# Register GitHub official MCP server
hyperclaw mcp add
# → choose "GitHub" from the list
# → enter your GITHUB_PERSONAL_ACCESS_TOKEN

# Register Puppeteer browser server
hyperclaw mcp add
# → choose "Puppeteer (Browser)"
```

Popular pre-configured options in `hyperclaw mcp add`:

| Server | Package |
|--------|---------|
| GitHub | `@modelcontextprotocol/server-github` |
| Filesystem | `@modelcontextprotocol/server-filesystem` |
| Brave Search | `@modelcontextprotocol/server-brave-search` |
| PostgreSQL | `@modelcontextprotocol/server-postgres` |
| Puppeteer (Browser) | `@modelcontextprotocol/server-puppeteer` |
| Slack | `@modelcontextprotocol/server-slack` |
| Google Drive | `@modelcontextprotocol/server-gdrive` |

## Config file integration

You can also define MCP servers directly in `~/.hyperclaw/hyperclaw.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "command": "node",
        "args": ["extensions/mcp-filesystem/server.mjs"]
      },
      {
        "name": "github",
        "command": "npx",
        "args": ["@modelcontextprotocol/server-github"],
        "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" }
      },
      {
        "name": "my-custom-server",
        "url": "http://localhost:8080/mcp"
      }
    ]
  }
}
```

## Building your own MCP server

Any process that reads JSON-RPC from stdin and writes to stdout works:

```javascript
// my-server.mjs
import readline from 'readline';

const TOOLS = [{
  name: 'hello',
  description: 'Say hello',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name']
  }
}];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id,
      result: { protocolVersion: '2024-11-05', serverInfo: { name: 'my-server', version: '1.0.0' }, capabilities: { tools: {} } }
    }) + '\n');
  } else if (method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: TOOLS } }) + '\n');
  } else if (method === 'tools/call' && params.name === 'hello') {
    const text = `Hello, ${params.arguments.name}!`;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } }) + '\n');
  }
});
```

Then register it:
```bash
hyperclaw mcp add
# → Custom → stdio → "node /path/to/my-server.mjs"
```

## See also

- [OSINT mode](osint.md) — uses MCP browser + filesystem for security research
- [Configuration](configuration.md) — full config reference
- [Sandboxing](sandboxing.md) — run MCP servers inside Docker
