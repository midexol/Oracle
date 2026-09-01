import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests import modules that validate the environment at import time, so
    // the fixture env must be in place before any of them load.
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
