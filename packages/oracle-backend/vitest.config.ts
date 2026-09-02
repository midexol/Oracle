import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The package publishes compiled dist/. Point tests at its source so a
      // test run never depends on having built a sibling workspace first.
      '@signal/dreamdex-integration': fileURLToPath(
        new URL('../dreamdex-integration/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Tests import modules that validate the environment at import time, so
    // the fixture env must be in place before any of them load.
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    // Integration tests need a real Postgres and run separately via
    // `npm run test:integration`, which provisions one first.
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    testTimeout: 20_000,
  },
});
