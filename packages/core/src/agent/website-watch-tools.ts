/**
 * src/agent/website-watch-tools.ts
 * Website change monitoring (OpenClaw-style).
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import type { Tool } from './inference';

const WATCH_FILE = path.join(os.homedir(), '.hyperclaw', 'website-watches.json');

interface WatchEntry {
  url: string;
  lastHash: string;
  lastCheck: string;
  lastSnippet?: string;
}

async function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function hashContent(html: string): string {
  const cleaned = html.replace(/\s+/g, ' ').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').slice(0, 50000);
  return crypto.createHash('sha256').update(cleaned).digest('hex').slice(0, 16);
}

async function loadWatches(): Promise<Record<string, WatchEntry>> {
  try {
    return await fs.readJson(WATCH_FILE);
  } catch {
    return {};
  }
}

async function saveWatches(watches: Record<string, WatchEntry>): Promise<void> {
  await fs.ensureDir(path.dirname(WATCH_FILE));
  await fs.writeJson(WATCH_FILE, watches, { spaces: 2 });
}

export function getWebsiteWatchTools(): Tool[] {
  return [
    {
      name: 'watch_website_add',
      description: 'Add a URL to the website change watch list. Use with watch_website_check to detect changes.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to watch (e.g. https://example.com)' }
        },
        required: ['url']
      },
      handler: async (input) => {
        const url = (input.url as string).trim();
        if (!url.startsWith('http')) return 'Error: URL must start with http:// or https://';
        const watches = await loadWatches();
        const content = await fetchUrl(url).catch(e => `[fetch error: ${e.message}]`);
        const hash = hashContent(content);
        watches[url] = { url, lastHash: hash, lastCheck: new Date().toISOString(), lastSnippet: content.slice(0, 200) };
        await saveWatches(watches);
        return `Added: ${url}. Initial hash: ${hash}`;
      }
    },
    {
      name: 'watch_website_check',
      description: 'Check watched URLs for changes. Returns list of URLs that changed since last check.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Specific URL to check (optional — checks all if omitted)' }
        }
      },
      handler: async (input) => {
        const watches = await loadWatches();
        const filterUrl = input.url as string | undefined;
        const toCheck = filterUrl ? [filterUrl] : Object.keys(watches);
        const changed: string[] = [];
        for (const url of toCheck) {
          const ent = watches[url];
          if (!ent) continue;
          try {
            const content = await fetchUrl(url);
            const hash = hashContent(content);
            ent.lastCheck = new Date().toISOString();
            if (hash !== ent.lastHash) {
              ent.lastHash = hash;
              ent.lastSnippet = content.slice(0, 300);
              changed.push(url);
            }
            watches[url] = ent;
          } catch (e: any) {
            changed.push(`${url} [error: ${e.message}]`);
          }
        }
        await saveWatches(watches);
        if (changed.length === 0) return 'No changes detected.';
        return `Changed: ${changed.join(', ')}`;
      }
    },
    {
      name: 'watch_website_list',
      description: 'List all watched URLs.',
      input_schema: { type: 'object', properties: {} },
      handler: async () => {
        const watches = await loadWatches();
        const urls = Object.keys(watches);
        if (urls.length === 0) return 'No watched URLs. Add with watch_website_add.';
        return urls.map(u => `- ${u} (last: ${watches[u].lastCheck})`).join('\n');
      }
    }
  ];
}
