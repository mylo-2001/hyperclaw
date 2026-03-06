import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 30000,
    reporters: ['verbose'],
    // E2E requires the built binary
    setupFiles: ['tests/e2e/setup.ts']
  }
});
