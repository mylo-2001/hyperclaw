#!/usr/bin/env node
// scripts/postinstall.js
// Shown after `npm install -g hyperclaw` — guides user to onboard.
// Kept dependency-free (plain Node.js) so it works before npm install completes.

'use strict';

// Skip in CI or when installed as a dependency (not globally)
if (process.env.CI || process.env.npm_config_global !== 'true') {
  process.exit(0);
}

const isWin = process.platform === 'win32';

const cyan  = (s) => `\x1b[36m${s}\x1b[0m`;
const bold  = (s) => `\x1b[1m${s}\x1b[0m`;
const gray  = (s) => `\x1b[90m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim   = (s) => `\x1b[2m${s}\x1b[0m`;

const line  = gray('─'.repeat(56));

console.log('');
console.log(line);
console.log('');
console.log(`  ${bold('⚡ HyperClaw')} ${cyan('v' + require('../package.json').version)} ${gray('installed successfully')}`);
console.log('');
console.log(`  Run the setup wizard to get started:`);
console.log('');
console.log(`    ${cyan('hyperclaw onboard')}`);
console.log('');
console.log(`  Or start with daemon auto-install:`);
console.log('');
console.log(`    ${cyan('hyperclaw onboard --install-daemon')}`);
console.log('');
console.log(line);
console.log('');
console.log(`  ${gray('Docs:')}  https://hyperclaw.ai/docs`);
console.log(`  ${gray('GitHub:')} https://github.com/hyperclaw-ai/hyperclaw`);
console.log('');
console.log(line);
console.log('');
