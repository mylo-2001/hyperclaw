/**
 * src/channels/delivery.ts
 * Delivery pipeline: queue retry, per-channel chunking, media handling.
 */

export const CHANNEL_MAX_LENGTH: Record<string, number> = {
  telegram: 4096,
  discord: 2000,
  whatsapp: 4096,
  'whatsapp-baileys': 4096,
  slack: 40000,
  googlechat: 4096,
  msteams: 28000,
  matrix: 32768,
  irc: 512,
  mattermost: 16383,
  signal: 4096,
  line: 2000,
  twitch: 490,
  viber: 7000,
  default: 4000
};

export function chunkForChannel(text: string, channelId: string): string[] {
  const max = CHANNEL_MAX_LENGTH[channelId] ?? CHANNEL_MAX_LENGTH.default;
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + max, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > i) end = nl + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; backoffMs?: number; onRetry?: (attempt: number, err: Error) => void }
): Promise<T> {
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const backoff = opts?.backoffMs ?? DEFAULT_BACKOFF_MS;
  let lastErr: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      opts?.onRetry?.(i + 1, lastErr);
      if (i < retries) await new Promise((r) => setTimeout(r, backoff * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/** Check if error is rate-limit (429) for backoff handling */
export function isRateLimitError(e: any): boolean {
  return e?.response?.status === 429 || e?.message?.includes('rate limit') || e?.code === 'ECONNRESET';
}

export interface MediaItem {
  type: 'image' | 'audio' | 'video';
  url?: string;
  base64?: string;
  mimeType?: string;
}

export function supportsMedia(channelId: string, type: MediaItem['type']): boolean {
  const supported: Record<string, MediaItem['type'][]> = {
    telegram: ['image', 'audio', 'video'],
    discord: ['image', 'audio', 'video'],
    whatsapp: ['image', 'audio', 'video'],
    'whatsapp-baileys': ['image', 'audio', 'video'],
    slack: ['image', 'audio', 'video']
  };
  return supported[channelId]?.includes(type) ?? false;
}

/** Enrich message text from voice note (transcribe if audioPath provided). */
export async function enrichVoiceNote(msg: { chatId: string | number; text: string; audioPath?: string }): Promise<string> {
  if (!msg.audioPath) return msg.text;
  if (msg.text && msg.text !== '[voice note]') return msg.text;
  try {
    const { transcribeVoiceNote } = await import('../services/voice-transcription');
    const text = await transcribeVoiceNote(msg.audioPath);
    return text || msg.text;
  } catch (e: any) {
    return `[Voice note — transcription failed: ${e.message}]`;
  }
}
