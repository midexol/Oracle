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
    setupFiles: ['./src/test/integration-setup.ts'],
    include: ['src/**/*.integration.test.ts'],
    // These share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
