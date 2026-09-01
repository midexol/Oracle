import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test/integration-setup.ts'],
    include: ['src/**/*.integration.test.ts'],
    // These share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
