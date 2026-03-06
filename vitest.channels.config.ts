import { defineConfig } from 'vitest/config';

/** Channels domain: registry, runner, delivery, pairing */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/unit/channels.test.ts',
      'tests/unit/delivery.test.ts',
      'tests/unit/pairing.test.ts',
      'tests/integration/delivery.test.ts',
      'tests/e2e/channels-parity.test.ts'
    ],
    testTimeout: 20000,
    reporters: ['verbose']
  }
});
