/**
 * src/services/voice-transcription.ts
 * Voice note transcription — multiple AI providers.
 * Supported: OpenAI Whisper, Google Gemini. Falls back by config provider.
 */

import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import { getConfigPath } from '../infra/paths';

async function getConfig(): Promise<{ providerId?: string; apiKey?: string }> {
  try {
    const cfg = await fs.readJson(getConfigPath());
    const providerId = cfg?.provider?.providerId;
    const apiKey = cfg?.provider?.apiKey;  // from wizard when api_key auth
    return { providerId, apiKey };
  } catch {
    return {};
  }
}

async function transcribeWithWhisper(buffer: Buffer, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const boundary = '----HyperClaw' + Date.now();
    const header = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="audio.ogg"',
      'Content-Type: application/octet-stream',
      '',
      ''
    ].join('\r\n');
    const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(header, 'utf8'),
      buffer,
      Buffer.from(footer, 'utf8')
    ]);
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.text?.trim() || '[No transcription]');
        } catch {
          resolve(`[Transcription error: ${data.slice(0, 100)}]`);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function transcribeWithGemini(buffer: Buffer, apiKey: string): Promise<string> {
  const base64 = buffer.toString('base64');
  const payload = JSON.stringify({
    contents: [{
      parts: [
        { text: 'Transcribe this audio to text. Output only the transcription, no other text.' },
        {
          inlineData: {
            mimeType: 'audio/ogg',
            data: base64
          }
        }
      ]
    }],
    generationConfig: { maxOutputTokens: 1024 }
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: '/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(apiKey),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          resolve(text || '[No transcription]');
        } catch {
          resolve(`[Transcription error: ${data.slice(0, 100)}]`);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Transcribe audio using configured provider or fallbacks.
 * Providers: OpenAI (Whisper), Google (Gemini), OpenRouter.
 * Env: OPENAI_API_KEY, WHISPER_API_KEY, GOOGLE_AI_API_KEY.
 */
export async function transcribeVoiceNote(
  audioPathOrBuffer: string | Buffer,
  apiKey?: string
): Promise<string> {
  let buffer: Buffer;
  if (typeof audioPathOrBuffer === 'string') {
    buffer = await fs.readFile(audioPathOrBuffer);
  } else {
    buffer = audioPathOrBuffer;
  }

  const cfg = await getConfig();
  const openaiKey = apiKey || process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY || (cfg.providerId === 'openai' || cfg.providerId === 'openrouter' ? cfg.apiKey : '');
  const googleKey = process.env.GOOGLE_AI_API_KEY || (cfg.providerId === 'google' ? cfg.apiKey : '');

  // Try Gemini first if user has Google provider
  if (cfg.providerId === 'google' && googleKey) {
    try {
      return await transcribeWithGemini(buffer, googleKey);
    } catch { /* fall through */ }
  }

  // OpenRouter routes to OpenAI/Google — use Whisper if we have OpenAI key
  if ((cfg.providerId === 'openrouter' || cfg.providerId === 'openai') && openaiKey) {
    try {
      return await transcribeWithWhisper(buffer, openaiKey);
    } catch { /* fall through */ }
  }

  // Direct OpenAI
  if (openaiKey) {
    try {
      return await transcribeWithWhisper(buffer, openaiKey);
    } catch (e: any) {
      return `[Transcription failed: ${e.message}]`;
    }
  }

  // Try Google as fallback
  if (googleKey) {
    try {
      return await transcribeWithGemini(buffer, googleKey);
    } catch (e: any) {
      return `[Transcription failed: ${e.message}]`;
    }
  }

  return '[Voice note — add OPENAI_API_KEY or GOOGLE_AI_API_KEY (or select OpenAI/Google provider in the wizard) for transcription]';
}
