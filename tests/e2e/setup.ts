import { existsSync } from 'fs';
import { resolve } from 'path';

const CLI = resolve('./dist/cli/run-main.js');

if (!existsSync(CLI)) {
  throw new Error(
    '\n\n❌ E2E tests require a built binary.\n' +
    '   Run first: npm run build:tsc\n'
  );
}
