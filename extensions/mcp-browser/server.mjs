#!/usr/bin/env node
/**
 * HyperClaw MCP Server — Browser / Web
 * Transport: stdio (newline-delimited JSON-RPC 2.0)
 *
 * Tools:
 *   web_fetch        — fetch a URL, returns markdown-ish text
 *   web_search       — search via DuckDuckGo Instant Answers API
 *   extract_links    — extract all links from a page
 *   get_page_title   — get the <title> of a page
 *   dns_lookup       — DNS lookup for a domain (OSINT)
 *   whois_lookup     — basic WHOIS via rdap.org (OSINT)
 */

import readline from 'readline';
import https from 'https';
import http from 'http';

const TOOLS = [
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its text content. Strips HTML tags, returns readable text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to fetch (https://...)' },
        max_chars: { type: 'number', description: 'Max characters to return (default: 8000)' }
      },
      required: ['url']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Returns top results with titles, snippets, and URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Max results to return (default: 5)' }
      },
      required: ['query']
    }
  },
  {
    name: 'extract_links',
    description: 'Extract all hyperlinks from a webpage.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Page URL to extract links from' }
      },
      required: ['url']
    }
  },
  {
    name: 'get_page_title',
    description: 'Get the <title> and meta description of a webpage.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Page URL' }
      },
      required: ['url']
    }
  },
  {
    name: 'dns_lookup',
    description: 'Perform DNS lookups for a domain — returns A, MX, NS, TXT records. Useful for OSINT and recon.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain name to query (e.g. example.com)' },
        type: { type: 'string', description: 'Record type: A | MX | NS | TXT | CNAME | ANY (default: ANY)' }
      },
      required: ['domain']
    }
  },
  {
    name: 'whois_lookup',
    description: 'WHOIS / RDAP lookup for a domain. Returns registrar, creation date, name servers. Useful for OSINT.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain name to look up (e.g. example.com)' }
      },
      required: ['domain']
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

function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HyperClaw-MCP/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchUrl(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      if (!links.includes(abs)) links.push(abs);
    } catch {}
  }
  return links.slice(0, 50);
}

async function callTool(name, args) {
  switch (name) {
    case 'web_fetch': {
      const { body } = await fetchUrl(args.url);
      const text = stripHtml(body);
      const max = args.max_chars || 8000;
      return text.slice(0, max) + (text.length > max ? `\n\n[truncated — ${text.length} total chars]` : '');
    }
    case 'web_search': {
      const query = encodeURIComponent(args.query);
      const { body } = await fetchUrl(`https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`);
      const data = JSON.parse(body);
      const results = [];
      if (data.AbstractText) {
        results.push(`📌 ${data.Heading}\n${data.AbstractText}\n${data.AbstractURL}`);
      }
      for (const r of (data.RelatedTopics || []).slice(0, args.max_results || 5)) {
        if (r.Text && r.FirstURL) {
          results.push(`• ${r.Text}\n  ${r.FirstURL}`);
        }
      }
      return results.length > 0 ? results.join('\n\n') : `No instant results for "${args.query}". Try a more specific query.`;
    }
    case 'extract_links': {
      const { body } = await fetchUrl(args.url);
      const links = extractLinks(body, args.url);
      return links.length > 0 ? `Found ${links.length} links:\n${links.join('\n')}` : 'No links found';
    }
    case 'get_page_title': {
      const { body } = await fetchUrl(args.url);
      const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
      const descMatch = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i);
      return [
        `Title:       ${titleMatch ? titleMatch[1].trim() : 'N/A'}`,
        `Description: ${descMatch ? descMatch[1].trim() : 'N/A'}`,
        `URL:         ${args.url}`
      ].join('\n');
    }
    case 'dns_lookup': {
      const type = args.type || 'ANY';
      const { body } = await fetchUrl(`https://dns.google/resolve?name=${encodeURIComponent(args.domain)}&type=${type}`);
      const data = JSON.parse(body);
      if (!data.Answer) return `No DNS records found for ${args.domain} (type: ${type})`;
      return data.Answer.map(r => `${r.name} ${r.TTL} ${r.type} ${r.data}`).join('\n');
    }
    case 'whois_lookup': {
      const { body } = await fetchUrl(`https://rdap.org/domain/${encodeURIComponent(args.domain)}`);
      const data = JSON.parse(body);
      const lines = [`Domain: ${data.ldhName || args.domain}`];
      if (data.status) lines.push(`Status: ${data.status.join(', ')}`);
      for (const e of (data.events || [])) {
        lines.push(`${e.eventAction}: ${e.eventDate}`);
      }
      for (const ns of (data.nameservers || [])) {
        lines.push(`NS: ${ns.ldhName}`);
      }
      if (data.entities) {
        for (const ent of data.entities) {
          const roles = (ent.roles || []).join(', ');
          const name = ent.vcardArray?.[1]?.find(f => f[0] === 'fn')?.[3] || '';
          if (name) lines.push(`${roles}: ${name}`);
        }
      }
      return lines.join('\n');
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
          serverInfo: { name: 'hyperclaw-mcp-browser', version: '1.0.0' },
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
