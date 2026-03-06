import { defineConfig } from 'vitest/config';

/** Gateway domain: server, manager, REST/WS API */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/unit/gateway-daemon.test.ts',
      'tests/integration/gateway.test.ts',
      'tests/e2e/gateway-critical.test.ts',
      'tests/e2e/full-flow.test.ts'
    ],
    testTimeout: 20000,
    reporters: ['verbose']
  }
});
