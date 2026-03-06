/**
 * src/agent/pi-loop.ts
 * Pi-style agent loop — OpenClaw compatibility.
 * Multi-turn loop until stop condition (e.g. user says "done", "exit").
 */

import type { InferenceEngine, InferenceMessage } from './inference';

export interface PiLoopOptions {
  engine: InferenceEngine;
  stopPhrases?: string[];
  maxTurns?: number;
  onTurn?: (turn: number, message: string) => void;
}

const DEFAULT_STOP_PHRASES = ['done', 'exit', 'quit', 'stop', 'bye', 'goodbye', 'thanks'];

export async function runPiLoop(
  initialMessage: string,
  opts: PiLoopOptions
): Promise<{ finalResponse: string; turns: number }> {
  const stopPhrases = opts.stopPhrases ?? DEFAULT_STOP_PHRASES;
  const maxTurns = opts.maxTurns ?? 20;
  const lowerPhrases = stopPhrases.map((p) => p.toLowerCase().trim());

  const messages: InferenceMessage[] = [{ role: 'user', content: initialMessage }];
  let turns = 0;
  let lastResponse = '';

  while (turns < maxTurns) {
    turns++;
    const result = await opts.engine.run(messages);
    lastResponse = result.text?.trim() ?? '';

    opts.onTurn?.(turns, lastResponse);

    const userSaidStop = lowerPhrases.some((p) => lastResponse.toLowerCase().includes(p));
    if (userSaidStop) break;

    messages.push({ role: 'assistant', content: lastResponse || '(no response)' });

    const nextUser = `Continue the conversation. User may reply. If no more input, say you're done.`;
    messages.push({ role: 'user', content: nextUser });
  }

  return { finalResponse: lastResponse, turns };
}
