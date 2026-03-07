'use strict';

// scripts/postinstall.js
// Shown after `npm install -g hyperclaw` — guides user to run onboard.
// No shebang needed — called explicitly with: node scripts/postinstall.js
// Wrapped in try-catch so a failure here never breaks the install.

try {
  // Skip in CI or when installed as a dependency (not globally)
  if (process.env.CI || process.env.npm_config_global !== 'true') {
    process.exit(0);
  }

  var cyan  = function(s) { return '\x1b[36m' + s + '\x1b[0m'; };
  var bold  = function(s) { return '\x1b[1m'  + s + '\x1b[0m'; };
  var gray  = function(s) { return '\x1b[90m' + s + '\x1b[0m'; };

  var version = '5.0.3';
  try {
    var path = require('path');
    var fs   = require('fs');
    var pkg  = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    version = pkg.version || version;
  } catch (_) {}

  var line = gray('─'.repeat(56));

  console.log('');
  console.log(line);
  console.log('');
  console.log('  ' + bold('\u26a1 HyperClaw') + ' ' + cyan('v' + version) + ' ' + gray('installed successfully'));
  console.log('');
  console.log('  Run the setup wizard to get started:');
  console.log('');
  console.log('    ' + cyan('hyperclaw onboard'));
  console.log('');
  console.log('  Or start with daemon auto-install:');
  console.log('');
  console.log('    ' + cyan('hyperclaw onboard --install-daemon'));
  console.log('');
  console.log(line);
  console.log('');
  console.log('  ' + gray('Docs:') + '  https://github.com/mylo-2001/hyperclaw#readme');
  console.log('  ' + gray('GitHub:') + ' https://github.com/mylo-2001/hyperclaw');
  console.log('');
  console.log(line);
  console.log('');
} catch (_) {
  process.exit(0);
}