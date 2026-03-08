/**
 * Post-build fix: patch bundler-generated chunks where init_paths() is called
 * as a bare variable inside __esm closures, but is only available via require_paths.
 *
 * Root cause: tsdown/Rollup splits @hyperclaw/shared into its own chunk, breaking
 * the ESM lazy-init pattern when consumed as CJS.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

let fixed = 0;

for (const file of readdirSync(distDir)) {
  if (!file.endsWith('.js')) continue;

  const filePath = join(distDir, file);
  const content = readFileSync(filePath, 'utf8');

  // Only process files that have the broken pattern:
  // a require_paths = require('./paths-*.js') AND a bare init_paths() call
  if (!content.includes('init_paths();') || !content.includes('require_paths')) continue;

  // Find ALL require_paths variable names — use the LAST one, which is the
  // @hyperclaw/shared chunk containing init_paths (earlier matches may be utility paths).
  const requireMatches = [...content.matchAll(/const (\w+) = require\('\.\/paths-[^']+\.js'\)/g)];
  if (!requireMatches.length) continue;

  const requireVar = requireMatches[requireMatches.length - 1][1];

  // Replace bare init_paths() — negative lookbehind prevents re-patching already-patched lines
  // (e.g. "require_paths$1.init_paths()" must not become "require_paths$1.require_paths$1.init_paths()")
  const patched = content.replace(/(?<![\w.])init_paths\(\);/g, `${requireVar}.init_paths();`);

  if (patched !== content) {
    writeFileSync(filePath, patched, 'utf8');
    console.log(`  fixed: ${file}`);
    fixed++;
  }
}

console.log(`\nfix-init-paths: patched ${fixed} file(s).`);
