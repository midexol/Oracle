/**
 * Test environment.
 *
 * src/config/env.ts validates and exits on a bad environment at import time,
 * so these have to be set before any module under test is loaded. The database
 * URL points nowhere on purpose: postgres.js connects lazily, so anything that
 * does not actually query works fine, and anything that does will fail loudly
 * rather than quietly talking to a real database.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/oracle_test';
process.env.JWT_SECRET ??= 'test-secret-that-is-definitely-long-enough-32';
process.env.LOG_LEVEL ??= 'silent';
process.env.DREAMDEX_MODE ??= 'mock';
process.env.ENABLE_JOBS ??= 'false';
