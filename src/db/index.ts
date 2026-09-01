import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env, isProd } from '../config/env.js';
import * as schema from './schema/index.js';

/**
 * Single shared connection pool.
 *
 * Neon and Supabase both terminate idle connections aggressively and cap the
 * pool size on free tiers, so we keep max low and let idle sockets close
 * rather than holding them open.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: isProd ? 10 : 5,
  idle_timeout: 20,
  connect_timeout: 15,
  // postgres.js infers ssl from the URL's sslmode param; this is a safety net
  // for hosts that require TLS without advertising it in the connection string.
  ssl: env.DATABASE_URL.includes('sslmode=require') ? 'require' : undefined,
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export type Database = typeof db;
export { schema };

/** Cheap liveness probe used by GET /health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
