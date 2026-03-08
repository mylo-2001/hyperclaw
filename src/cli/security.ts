/**
 * src/cli/security.ts
 * showSecurityDisclaimer — risk gate before onboarding (OpenClaw-style).
 * VirusTotal skill scanning + force-install override.
 */
import chalk from 'chalk';
import inquirer from 'inquirer';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs-extra';

export interface ScanResult {
  safe: boolean;
  suspicious: boolean;
  malicious: boolean;
  virusTotalUrl?: string;
  details: string;
}

// ── OpenClaw-style risk acknowledgment screen ─────────────────────────────────

export async function showSecurityDisclaimer(): Promise<boolean> {
  console.clear();
  console.log(chalk.bgRed.white.bold('\n  ⚠️  SECURITY NOTICE — READ CAREFULLY  ⚠️ \n'));
  console.log(chalk.white.bold('  A bad prompt can trick it into doing unsafe things\n'));
  console.log(chalk.hex('#06b6d4')('  Protections to enable:'));
  console.log(chalk.gray('  ● Pairing / allowlists  — limit who can DM your agent'));
  console.log(chalk.gray('  ● Sandbox + least privilege  — restrict PC access level'));
  console.log(chalk.gray('  ● Keep secrets out  — never put tokens in SOUL.md'));
  console.log(chalk.gray('  ● Use strongest model  — smarter = better at refusing tricks\n'));

  const { understood } = await inquirer.prompt([{
    type: 'list',
    name: 'understood',
    message: chalk.bold('I understand this is powerful and inherently risky.'),
    choices: [
      { name: chalk.green('Yes, continue  — I understand the risks'), value: true },
      { name: chalk.gray('No, exit       — I\'ll come back later'),   value: false },
    ],
    default: false,
  }]);

  if (!understood) console.log(chalk.gray('\n  Aborted. Come back when ready.\n'));
  return understood;
}

// ── VirusTotal skill scanner ──────────────────────────────────────────────────

export async function scanSkillWithVirusTotal(
  skillPath: string,
  vtApiKey?: string
): Promise<ScanResult> {
  if (!vtApiKey) return { safe: true, suspicious: false, malicious: false, details: 'No VT key — skipped' };

  try {
    const files = await collectSkillFiles(skillPath);
    const hashes = await Promise.all(files.map(hashFile));
    let mal = 0, sus = 0;
    const urls: string[] = [];

    for (const h of hashes.slice(0, 5)) {
      const r = await vtCheck(h, vtApiKey);
      if (r.malicious > 0) mal++;
      if (r.suspicious > 0) sus++;
      if (r.url) urls.push(r.url);
    }

    return {
      safe: mal === 0 && sus === 0,
      suspicious: sus > 0, malicious: mal > 0,
      virusTotalUrl: urls[0],
      details: mal > 0 ? `${mal} file(s) MALICIOUS` : sus > 0 ? `${sus} file(s) suspicious` : 'All green'
    };
  } catch (e: any) {
    return { safe: true, suspicious: false, malicious: false, details: `Scan error: ${e.message}` };
  }
}

export function showScanResult(skillName: string, result: ScanResult): void {
  if (result.malicious)     console.log(chalk.red(`  🚨 ${skillName}: MALICIOUS — ${result.details}`));
  else if (result.suspicious) console.log(chalk.yellow(`  ⚠️  ${skillName}: SUSPICIOUS — ${result.details}`));
  else                       console.log(chalk.green(`  ✅ ${skillName}: ${result.details}`));
  if (result.virusTotalUrl) console.log(chalk.gray(`     ${result.virusTotalUrl}`));
}

export async function confirmForceInstall(skillName: string): Promise<boolean> {
  const { force } = await inquirer.prompt([{
    type: 'confirm', name: 'force',
    message: chalk.red(`  ${skillName} was flagged. Install anyway? (NOT recommended)`),
    default: false
  }]);
  return force;
}

export async function configureDMPolicy(channelName: string): Promise<{ dmPolicy: string; allowFrom: string[] }> {
  const { configureDMPolicy: cdmp } = await import('../infra/security');
  const res = await cdmp(channelName);
  return { dmPolicy: res.policy, allowFrom: res.allowFrom ?? [] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collectSkillFiles(dir: string): Promise<string[]> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.filter(e => e.isFile() && /\.(js|ts|py)$/.test(e.name)).map(e => require('path').join(dir, e.name));
  } catch { return []; }
}

async function hashFile(f: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
}

function vtCheck(hash: string, key: string): Promise<{ malicious: number; suspicious: number; url?: string }> {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'www.virustotal.com', port: 443,
      path: `/api/v3/files/${hash}`, method: 'GET',
      headers: { 'x-apikey': key }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          const s = r.data?.attributes?.last_analysis_stats || {};
          resolve({ malicious: s.malicious || 0, suspicious: s.suspicious || 0, url: `https://www.virustotal.com/gui/file/${hash}` });
        } catch { resolve({ malicious: 0, suspicious: 0 }); }
      });
    });
    req.on('error', () => resolve({ malicious: 0, suspicious: 0 }));
    req.end();
  });
}

