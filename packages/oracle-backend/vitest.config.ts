import { defineConfig } from 'vitest/config';

export default defineConfig({
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
