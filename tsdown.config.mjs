// tsdown.config.mjs
// All optional / channel packages are marked external — loaded at runtime via
// dynamic import() and must NOT be bundled.
export default {
  entry: ['src/cli/run-main.ts'],
  outDir: 'dist',
  format: 'cjs',
  // Adds #!/usr/bin/env node so the file is executable when installed globally via npm
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'discord.js',
    '@whiskeysockets/baileys',
    '@modelcontextprotocol/sdk',
    'tail',
    'irc',
    'puppeteer',
    'pdf-parse',
    'xlsx',
    'node-telegram-bot-api',
    '@slack/bolt',
    'matrix-js-sdk',
    'nostr-tools',
    '@line/bot-sdk',
    'tmi.js',
    '@mattermost/client',
    'nodemailer',
    'node-icu-charset-detector',
    'better-sqlite3',
    'sharp',
    'canvas',
  ],
};
