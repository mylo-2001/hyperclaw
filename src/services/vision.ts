/**
 * src/services/vision.ts
 * Image understanding via vision-capable models (Claude, GPT-4V, etc.)
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';

async function imageToBase64(input: string): Promise<{ data: string; mediaType: string }> {
  const trimmed = input.trim();
  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) return { data: match[2], mediaType: match[1] };
  }
  if (trimmed.startsWith('http')) {
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const mod = trimmed.startsWith('https') ? https : http;
      const req = mod.get(trimmed, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
    });
    return { data: buf.toString('base64'), mediaType: 'image/jpeg' };
  }
  const filePath = trimmed.replace(/^~/, os.homedir());
  const buf = await fs.readFile(path.resolve(filePath));
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] ?? 'image/jpeg';
  return { data: buf.toString('base64'), mediaType };
}

export async function analyzeImage(
  imageInput: string,
  prompt: string,
  apiKey: string,
  provider: 'anthropic' | 'openrouter' = 'anthropic'
): Promise<string> {
  const { data, mediaType } = await imageToBase64(imageInput);
  const isAnthropic = provider === 'anthropic';
  const hostname = isAnthropic ? 'api.anthropic.com' : 'openrouter.ai';
  const model = isAnthropic ? 'claude-sonnet-4-20250514' : 'openai/gpt-4o';
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    messages: isAnthropic
      ? [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: prompt || 'Describe this image.' }] }]
      : [{ role: 'user', content: [{ type: 'text', text: '[Image attached] ' + (prompt || 'Describe this image.') }, { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } }] }]
  };
  if (isAnthropic) (body as any).anthropic_version = '2023-06-01';

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, port: 443, path: isAnthropic ? '/v1/messages' : '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(isAnthropic ? { 'anthropic-version': '2023-06-01' } : { 'HTTP-Referer': 'https://hyperclaw.ai' })
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (isAnthropic) {
            const text = j.content?.[0]?.text;
            resolve(text || j.error?.message || '(no description)');
          } else {
            const text = j.choices?.[0]?.message?.content;
            resolve(text || j.error?.message || '(no description)');
          }
        } catch {
          resolve(raw || '(parse error)');
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
