#!/usr/bin/env node
/**
 * HyperClaw MCP Server — GitHub
 * Transport: stdio (newline-delimited JSON-RPC 2.0)
 * Requires: GITHUB_TOKEN env variable
 *
 * Tools:
 *   list_repos       — list repos for a user/org
 *   get_repo         — get repo metadata
 *   list_issues      — list open issues for a repo
 *   create_issue     — create an issue
 *   get_file         — read a file from a repo
 *   search_code      — search code across GitHub
 *   list_prs         — list open pull requests
 *   get_pr           — get PR details + diff
 */

import readline from 'readline';
import https from 'https';

const TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';

const TOOLS = [
  {
    name: 'list_repos',
    description: 'List public repositories for a GitHub user or organization.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'GitHub username or org name' },
        type: { type: 'string', description: 'all | owner | member (default: all)' }
      },
      required: ['owner']
    }
  },
  {
    name: 'get_repo',
    description: 'Get metadata about a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner (username or org)' },
        repo: { type: 'string', description: 'Repository name' }
      },
      required: ['owner', 'repo']
    }
  },
  {
    name: 'list_issues',
    description: 'List issues for a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'open | closed | all (default: open)' },
        labels: { type: 'string', description: 'Comma-separated label filters' }
      },
      required: ['owner', 'repo']
    }
  },
  {
    name: 'create_issue',
    description: 'Create a new issue in a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (Markdown)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' }
      },
      required: ['owner', 'repo', 'title']
    }
  },
  {
    name: 'get_file',
    description: 'Read a file from a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path in repo (e.g. src/index.ts)' },
        ref: { type: 'string', description: 'Branch, tag, or commit SHA (default: main)' }
      },
      required: ['owner', 'repo', 'path']
    }
  },
  {
    name: 'search_code',
    description: 'Search code across GitHub using the code search API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GitHub code search query (e.g. "hyperclaw repo:mylo-2001/hyperclaw")' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_prs',
    description: 'List pull requests for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'open | closed | all (default: open)' }
      },
      required: ['owner', 'repo']
    }
  },
  {
    name: 'get_pr',
    description: 'Get details and diff of a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner' },
        repo: { type: 'string', description: 'Repository name' },
        number: { type: 'number', description: 'PR number' }
      },
      required: ['owner', 'repo', 'number']
    }
  }
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function textContent(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function ghRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers: {
        'User-Agent': 'hyperclaw-mcp-github/1.0.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function callTool(name, args) {
  if (!TOKEN) {
    return '⚠️ No GitHub token. Set GITHUB_TOKEN env variable to use GitHub MCP tools.';
  }

  switch (name) {
    case 'list_repos': {
      const { data } = await ghRequest(`/users/${args.owner}/repos?type=${args.type || 'all'}&per_page=30&sort=updated`);
      if (!Array.isArray(data)) return `Error: ${JSON.stringify(data)}`;
      return data.map(r =>
        `${r.private ? '🔒' : '📦'} ${r.full_name} — ⭐${r.stargazers_count} — ${r.description || 'No description'}`
      ).join('\n') || '(no repos)';
    }
    case 'get_repo': {
      const { data } = await ghRequest(`/repos/${args.owner}/${args.repo}`);
      if (data.message) return `Error: ${data.message}`;
      return [
        `Name:        ${data.full_name}`,
        `Description: ${data.description || 'N/A'}`,
        `Stars:       ${data.stargazers_count}`,
        `Forks:       ${data.forks_count}`,
        `Language:    ${data.language || 'N/A'}`,
        `License:     ${data.license?.spdx_id || 'None'}`,
        `Topics:      ${(data.topics || []).join(', ') || 'none'}`,
        `Updated:     ${data.updated_at}`,
        `URL:         ${data.html_url}`
      ].join('\n');
    }
    case 'list_issues': {
      let endpoint = `/repos/${args.owner}/${args.repo}/issues?state=${args.state || 'open'}&per_page=20`;
      if (args.labels) endpoint += `&labels=${encodeURIComponent(args.labels)}`;
      const { data } = await ghRequest(endpoint);
      if (!Array.isArray(data)) return `Error: ${JSON.stringify(data)}`;
      return data.map(i =>
        `#${i.number} [${i.state}] ${i.title}\n  Labels: ${i.labels.map(l => l.name).join(', ') || 'none'}\n  ${i.html_url}`
      ).join('\n\n') || '(no issues)';
    }
    case 'create_issue': {
      const { data, status } = await ghRequest(
        `/repos/${args.owner}/${args.repo}/issues`,
        'POST',
        { title: args.title, body: args.body || '', labels: args.labels || [] }
      );
      if (status !== 201) return `Error (${status}): ${JSON.stringify(data)}`;
      return `✅ Issue #${data.number} created: ${data.html_url}`;
    }
    case 'get_file': {
      const ref = args.ref || 'main';
      const { data } = await ghRequest(`/repos/${args.owner}/${args.repo}/contents/${args.path}?ref=${ref}`);
      if (data.message) return `Error: ${data.message}`;
      if (!data.content) return 'File is binary or too large';
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      return `[${args.path} @ ${ref}]\n\n${decoded}`;
    }
    case 'search_code': {
      const { data } = await ghRequest(`/search/code?q=${encodeURIComponent(args.query)}&per_page=10`);
      if (!data.items) return `Error: ${JSON.stringify(data)}`;
      return `Found ${data.total_count} results:\n\n` + data.items.map(i =>
        `📄 ${i.repository.full_name}/${i.path}\n  ${i.html_url}`
      ).join('\n\n');
    }
    case 'list_prs': {
      const { data } = await ghRequest(`/repos/${args.owner}/${args.repo}/pulls?state=${args.state || 'open'}&per_page=20`);
      if (!Array.isArray(data)) return `Error: ${JSON.stringify(data)}`;
      return data.map(pr =>
        `#${pr.number} [${pr.state}] ${pr.title}\n  Author: ${pr.user.login} → ${pr.base.ref}\n  ${pr.html_url}`
      ).join('\n\n') || '(no PRs)';
    }
    case 'get_pr': {
      const { data } = await ghRequest(`/repos/${args.owner}/${args.repo}/pulls/${args.number}`);
      if (data.message) return `Error: ${data.message}`;
      return [
        `PR #${data.number}: ${data.title}`,
        `State:   ${data.state} | Mergeable: ${data.mergeable}`,
        `Author:  ${data.user.login}`,
        `Base:    ${data.base.ref} ← ${data.head.label}`,
        `+${data.additions} -${data.deletions} in ${data.changed_files} files`,
        `\n${data.body || '(no description)'}`,
        `\nURL: ${data.html_url}`
      ].join('\n');
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }

  const { id, method, params } = req;

  try {
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'hyperclaw-mcp-github', version: '1.0.0' },
          capabilities: { tools: {} }
        });
        break;
      case 'notifications/initialized':
        break;
      case 'tools/list':
        respond(id, { tools: TOOLS });
        break;
      case 'tools/call': {
        const result = await callTool(params.name, params.arguments || {});
        respond(id, textContent(result));
        break;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    respond(id, textContent(`Error: ${e.message}`));
  }
});
