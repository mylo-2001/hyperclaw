#!/usr/bin/env node
// scripts/postinstall.js
// Shown after `npm install -g hyperclaw` — guides user to onboard.
// Kept dependency-free (plain Node.js) so it works before npm install completes.
// Wrapped in try-catch so a failure here never breaks the install.

'use strict';

try {
  // Skip in CI or when installed as a dependency (not globally)
  if (process.env.CI || process.env.npm_config_global !== 'true') {
    process.exit(0);
  }

  const cyan  = (s) => `\x1b[36m${s}\x1b[0m`;
  const bold  = (s) => `\x1b[1m${s}\x1b[0m`;
  const gray  = (s) => `\x1b[90m${s}\x1b[0m`;
  const green = (s) => `\x1b[32m${s}\x1b[0m`;

  let version = '5.0.2';
  try {
    const path = require('path');
    const fs   = require('fs');
    const pkg  = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    version = pkg.version || version;
  } catch (_) {}

  const line = gray('─'.repeat(56));

  console.log('');
  console.log(line);
  console.log('');
  console.log(`  ${bold('\u26a1 HyperClaw')} ${cyan('v' + version)} ${gray('installed successfully')}`);
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
  console.log(`  ${gray('Docs:')}  https://github.com/mylo-2001/hyperclaw#readme`);
  console.log(`  ${gray('GitHub:')} https://github.com/mylo-2001/hyperclaw`);
  console.log('');
  console.log(line);
  console.log('');
} catch (_) {
  // Never fail the install due to postinstall script errors
  process.exit(0);
}
