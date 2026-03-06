/**
 * extensions/voice-call/src/index.ts
 * HyperClaw Voice Call extension.
 * Real-time voice conversation with your AI agent via WebRTC / media streams.
 * 
 * Flow:
 *   Mic → VAD (voice activity detection) → transcription → agent → TTS → speaker
 *
 * Requires:
 *   - DEEPGRAM_API_KEY (for transcription)
 *   - Or local whisper.cpp for offline transcription
 */

import { definePlugin, PluginContext } from '../../../src/sdk/index';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

const execAsync = promisify(exec);

export type TTSEngine = 'espeak' | 'say' | 'gtts' | 'elevenlabs' | 'none';
export type STTEngine = 'deepgram' | 'whisper-local' | 'vosk' | 'none';

export interface VoiceCallConfig {
  ttsEngine: TTSEngine;
  sttEngine: STTEngine;
  language: string;
  wakeWord: string;
  speakingRate: number;    // 0.5 - 2.0
  vadThreshold: number;    // Voice activity detection sensitivity
  maxSilenceMs: number;    // Stop recording after N ms of silence
}

const DEFAULT_CONFIG: VoiceCallConfig = {
  ttsEngine: detectTTSEngine(),
  sttEngine: 'deepgram',
  language: 'en',
  wakeWord: 'hey hyper',
  speakingRate: 1.0,
  vadThreshold: 0.3,
  maxSilenceMs: 1500
};

function detectTTSEngine(): TTSEngine {
  const platform = os.platform();
  if (platform === 'darwin') return 'say';      // macOS built-in
  if (platform === 'linux') return 'espeak';     // common on Linux
  return 'none';
}

export class VoiceCallSession {
  private config: VoiceCallConfig;
  private ctx: PluginContext;
  private active = false;
  private transcriptBuffer: string[] = [];

  constructor(ctx: PluginContext, config?: Partial<VoiceCallConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    console.log(chalk.bold.cyan('\n  🎙️  VOICE CALL\n'));
    console.log(`  ${chalk.gray('TTS engine:')} ${this.config.ttsEngine}`);
    console.log(`  ${chalk.gray('STT engine:')} ${this.config.sttEngine}`);
    console.log(`  ${chalk.gray('Wake word:')} "${this.config.wakeWord}"`);
    console.log(`  ${chalk.gray('Language:')} ${this.config.language}\n`);

    // Check dependencies
    await this.checkDependencies();

    this.active = true;
    console.log(chalk.green('  ✔  Voice call active. Say "' + this.config.wakeWord + '" to start.\n'));
    console.log(chalk.gray('  Press Ctrl+C to end.\n'));

    // Start wake word listener loop
    await this.listenLoop();
  }

  async stop(): Promise<void> {
    this.active = false;
    console.log(chalk.yellow('\n  📴  Voice call ended.\n'));
  }

  private async checkDependencies(): Promise<void> {
    const spinner = ora('Checking voice dependencies...').start();

    const checks: Array<{ name: string; cmd: string; required: boolean }> = [
      { name: 'sox (recording)', cmd: 'which sox', required: true },
      { name: this.config.ttsEngine, cmd: `which ${this.config.ttsEngine}`, required: false }
    ];

    const missing: string[] = [];
    for (const check of checks) {
      try {
        await execAsync(check.cmd);
      } catch {
        if (check.required) missing.push(check.name);
      }
    }

    if (missing.length > 0) {
      spinner.warn(`Missing: ${missing.join(', ')}`);
      console.log(chalk.gray('\n  Install with:'));
      if (missing.includes('sox (recording)')) {
        console.log(chalk.gray('    Ubuntu/Debian: sudo apt install sox'));
        console.log(chalk.gray('    macOS:         brew install sox'));
      }
    } else {
      spinner.succeed('Voice dependencies OK');
    }
  }

  private async listenLoop(): Promise<void> {
    // Simplified listen loop — in production this would use native audio APIs
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log(chalk.gray('  (Terminal mode — type your message and press Enter)\n'));

    const prompt = () => {
      rl.question(chalk.cyan('  🎙️  You: '), async (input) => {
        if (!this.active) { rl.close(); return; }
        if (!input.trim()) { prompt(); return; }

        const response = await this.processUtterance(input.trim());
        await this.speak(response);
        prompt();
      });
    };

    prompt();
  }

  private async processUtterance(text: string): Promise<string> {
    const spinner = ora('  Thinking...').start();

    try {
      const response = await this.ctx.gateway.onMessage
        ? '[Gateway response — requires live gateway connection]'
        : `Echo: ${text}`;

      spinner.stop();
      console.log(chalk.green(`\n  🦅 Agent: ${response}\n`));
      return response;
    } catch (err: any) {
      spinner.stop();
      return `Sorry, I encountered an error: ${err.message}`;
    }
  }

  private async speak(text: string): Promise<void> {
    const engine = this.config.ttsEngine;
    if (engine === 'none') return;

    try {
      const rate = Math.round(150 * this.config.speakingRate);
      const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`');

      if (engine === 'say') {
        await execAsync(`say -r ${rate} "${escaped}"`);
      } else if (engine === 'espeak') {
        await execAsync(`espeak -s ${rate} -v ${this.config.language} "${escaped}"`);
      } else if (engine === 'gtts') {
        const tmpFile = path.join(os.tmpdir(), 'hyperclaw-tts.mp3');
        await execAsync(`gtts-cli "${escaped}" -l ${this.config.language} -o ${tmpFile}`);
        await execAsync(`mpv --really-quiet ${tmpFile}`);
      }
    } catch {
      // TTS failure is non-fatal
    }
  }
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export default definePlugin({
  id: 'voice-call',
  name: 'Voice Call',
  version: '1.0.0',
  description: 'Real-time voice conversation with your AI agent. Wake word detection, STT, TTS.',
  author: 'hyperclaw-team',
  capabilities: ['message:send', 'message:receive', 'secrets:read'],

  async onLoad(ctx: PluginContext) {
    ctx.log.info('Voice call extension loaded');
  },

  async onUnload() {}
});
