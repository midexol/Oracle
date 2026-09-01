import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDatabase } from './index.js';

/** Applies every pending migration in ./drizzle, then exits. */
async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
  await closeDatabase();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await closeDatabase();
  process.exit(1);
});
