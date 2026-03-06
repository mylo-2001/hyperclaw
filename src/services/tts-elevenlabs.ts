/**
 * src/services/tts-elevenlabs.ts
 * ElevenLabs TTS — Talk Mode. Converts text to speech.
 * Config: talkMode.apiKey, talkMode.voiceId, talkMode.modelId
 */

import https from 'https';

export interface TTSOptions {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
}

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const DEFAULT_MODEL = 'eleven_multilingual_v2';

/**
 * Convert text to speech via ElevenLabs API.
 * Returns base64-encoded MP3 or null on error.
 */
export async function textToSpeech(
  text: string,
  opts: TTSOptions
): Promise<string | null> {
  const voiceId = opts.voiceId || DEFAULT_VOICE;
  const modelId = opts.modelId || DEFAULT_MODEL;
  const format = opts.outputFormat || 'mp3_22050_32';

  const body = JSON.stringify({ text, model_id: modelId });
  const path = `/v1/text-to-speech/${voiceId}?output_format=${format}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': opts.apiKey,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            console.warn(`[tts] ElevenLabs error ${res.statusCode}: ${buf.slice(0, 200)}`);
            resolve(null);
            return;
          }
          resolve(buf.toString('base64'));
        });
      }
    );
    req.on('error', (e) => {
      console.warn('[tts] ElevenLabs request error:', e.message);
      resolve(null);
    });
    req.setTimeout(30000, () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}
