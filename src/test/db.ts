import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';

/** Applies the real migration files, so tests exercise the shipped schema. */
export async function migrateTestDatabase(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
}

/**
 * Wipe every table between tests.
 *
 * TRUNCATE ... CASCADE in one statement so foreign keys never dictate the
 * order, and RESTART IDENTITY so sequences do not leak between tests.
 */
export async function resetDatabase(): Promise<void> {
  await db.execute(raw`
    TRUNCATE TABLE
      prediction_results, predictions, trades, battles, follows,
      user_segment_stats, user_stats, market_price_snapshots,
      markets, auth_nonces, users
    RESTART IDENTITY CASCADE
  `);
}
