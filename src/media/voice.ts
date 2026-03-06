import chalk from 'chalk';
import ora from 'ora';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

const execFileAsync = promisify(execFile);

const GATEWAY_URL = process.env.HYPERCLAW_GATEWAY_URL || 'http://localhost:18789';
const WHISPER_API = 'https://api.openai.com/v1/audio/transcriptions';

async function recordAudio(outFile: string, seconds: number): Promise<void> {
  const platform = os.platform();
  if (platform === 'darwin') {
    // macOS: sox
    await execFileAsync('sox', ['-d', '-r', '16000', '-c', '1', '-b', '16', outFile, 'trim', '0', String(seconds)]);
  } else {
    // Linux: arecord
    await execFileAsync('arecord', ['-r', '16000', '-c', '1', '-f', 'S16_LE', '-d', String(seconds), outFile]);
  }
}

async function transcribeWhisper(filePath: string, lang: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No OPENAI_API_KEY set');

  // Use form-data via node's built-in fetch (Node 18+) or axios if available
  const FormData = (await import('form-data').catch(() => null))?.default;
  if (!FormData) throw new Error('form-data not installed');

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), { filename: 'audio.wav', contentType: 'audio/wav' });
  form.append('model', 'whisper-1');
  if (lang && lang !== 'auto') form.append('language', lang.slice(0, 2));

  const axios = (await import('axios').catch(() => null))?.default;
  if (!axios) throw new Error('axios not installed');

  const resp = await axios.post(WHISPER_API, form, {
    headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
    timeout: 20000
  });
  return (resp.data?.text || '').trim();
}

async function speak(text: string): Promise<void> {
  const platform = os.platform();
  try {
    if (platform === 'darwin') {
      await execFileAsync('say', [text]);
    } else {
      await execFileAsync('espeak-ng', [text]);
    }
  } catch {
    // TTS unavailable — silent
  }
}

async function chatWithGateway(message: string): Promise<string> {
  const axios = (await import('axios').catch(() => null))?.default;
  if (!axios) return '(axios not available)';
  try {
    const resp = await axios.post(`${GATEWAY_URL}/api/chat`, { message }, { timeout: 30000 });
    return resp.data?.reply || resp.data?.content || String(resp.data || '');
  } catch (e: any) {
    return `(Gateway error: ${e.message})`;
  }
}

function hasRecorder(): boolean {
  try {
    const platform = os.platform();
    const cmd = platform === 'darwin' ? 'sox' : 'arecord';
    execFile(cmd, ['--version'], () => {});
    return true;
  } catch {
    return false;
  }
}

export class VoiceEngine {
  private lang = 'en';
  private wakeWord = 'hey claw';
  private running = false;

  async configure(options: { lang: string; wakeWord: string }): Promise<void> {
    this.lang = options.lang || 'en';
    this.wakeWord = (options.wakeWord || 'hey claw').toLowerCase();

    const spinner = ora('Configuring Voice Engine...').start();

    const hasApiKey = !!(process.env.OPENAI_API_KEY);
    const hasRec = hasRecorder();

    spinner.succeed('Voice Engine configured');

    console.log(chalk.cyan('\n🎙️  Voice Settings:'));
    console.log(chalk.gray(`   Language:   ${this.lang}`));
    console.log(chalk.gray(`   Wake Word:  "${this.wakeWord}"`));
    console.log(chalk.gray(`   Microphone: ${hasRec ? chalk.green('detected') : chalk.yellow('not found — text fallback')}`));
    console.log(chalk.gray(`   Whisper:    ${hasApiKey ? chalk.green('OPENAI_API_KEY set') : chalk.yellow('no key — text fallback')}`));
    console.log(chalk.gray(`   Gateway:    ${GATEWAY_URL}`));
    console.log(chalk.gray(`   Status:     ${chalk.green('Ready')}`));

    if (this.lang === 'el') {
      console.log(chalk.cyan('\n🇬🇷 Ελληνική υποστήριξη ενεργοποιημένη!'));
      console.log(chalk.gray(`   Πείτε "${this.wakeWord}" για να ξυπνήσετε τον βοηθό.`));
    }

    console.log();

    if (hasRec && hasApiKey) {
      console.log(chalk.green(`Say "${this.wakeWord}" to activate. Ctrl+C to stop.\n`));
      this.running = true;
      this._wakeLoop().catch(() => {});
    } else {
      console.log(chalk.yellow('Falling back to text input mode. Type your message and press Enter.\n'));
      this._textFallback().catch(() => {});
    }
  }

  private async _wakeLoop(): Promise<void> {
    const tmpDir = os.tmpdir();
    while (this.running) {
      const filePath = path.join(tmpDir, `hc-listen-${Date.now()}.wav`);
      try {
        // Record 3-second chunk silently
        await recordAudio(filePath, 3);
        const text = await transcribeWhisper(filePath, this.lang);
        fs.unlink(filePath, () => {});
        if (!text) continue;
        const lower = text.toLowerCase();
        if (!lower.includes(this.wakeWord)) continue;

        // Wake word detected
        process.stdout.write(chalk.green(`\n[Wake] "${text}"\n`));
        await speak('Yes?');

        // Record the actual query (up to 8s)
        const queryFile = path.join(tmpDir, `hc-query-${Date.now()}.wav`);
        process.stdout.write(chalk.gray('Listening...\n'));
        await recordAudio(queryFile, 8);
        const query = await transcribeWhisper(queryFile, this.lang);
        fs.unlink(queryFile, () => {});
        if (!query) { await speak('I did not catch that.'); continue; }

        process.stdout.write(chalk.cyan(`You: ${query}\n`));
        const spinner = ora('Thinking...').start();
        const reply = await chatWithGateway(query);
        spinner.stop();
        process.stdout.write(chalk.white(`HyperClaw: ${reply}\n\n`));
        await speak(reply);
      } catch (e: any) {
        fs.unlink(filePath, () => {});
        // sox/arecord not available mid-loop — break to text fallback
        if (e.message?.includes('ENOENT') || e.message?.includes('not found')) {
          process.stdout.write(chalk.yellow('Recorder unavailable — switching to text input.\n'));
          this.running = false;
          this._textFallback().catch(() => {});
          return;
        }
        // Otherwise (e.g. API error) just continue
      }
    }
  }

  private async _textFallback(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = () => {
      rl.question(chalk.cyan('You: '), async (input) => {
        const msg = input.trim();
        if (!msg || msg.toLowerCase() === 'exit') { rl.close(); return; }
        const spinner = ora('Thinking...').start();
        const reply = await chatWithGateway(msg);
        spinner.stop();
        console.log(chalk.white(`HyperClaw: ${reply}\n`));
        ask();
      });
    };
    ask();
  }

  stop(): void {
    this.running = false;
  }
}
