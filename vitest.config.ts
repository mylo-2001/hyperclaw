import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],  // E2E runs separately after build
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'extensions/**/*.ts'],
      exclude: ['src/cli/run-main.ts', '**/*.d.ts']
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    reporters: ['verbose']
  }
});
