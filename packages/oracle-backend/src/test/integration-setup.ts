/**
 * Integration test environment.
 *
 * These tests run against a REAL Postgres, because the parts of this codebase
 * most likely to be wrong are the hand-written SQL aggregates - the Wilson
 * ranking, the leaderboard, the PnL backfill - and none of those can fail at
 * compile time. A green unit suite says nothing about whether they run.
 *
 * Point TEST_DATABASE_URL at a throwaway database. The suite truncates tables
 * between tests, so never aim it at anything you care about.
 */
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  throw new Error(
    'TEST_DATABASE_URL is not set.\n' +
      'Integration tests need a real Postgres. Either:\n' +
      '  docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres --name oracle-test postgres:16\n' +
      '  TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres npm run test:integration\n' +
      'or point it at a scratch Neon branch.',
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.JWT_SECRET ??= 'test-secret-that-is-definitely-long-enough-32';
process.env.LOG_LEVEL ??= 'silent';
process.env.DREAMDEX_MODE ??= 'mock';
process.env.ENABLE_JOBS = 'false';
