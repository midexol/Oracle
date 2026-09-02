/**
 * Persistent local Postgres for `oracle-backend` dev, no Docker required.
 *
 * `embedded-postgres` is already a devDependency (see
 * packages/oracle-backend/scripts/smoke-compat.mjs), but that usage is
 * throwaway — a fresh cluster per test run. This boots the same binary
 * against a data directory that lives under .dev-data/ (gitignored) and
 * persists across restarts, for anyone who doesn't have Docker or a
 * hosted Postgres handy.
 *
 *   node scripts/dev-postgres.mjs
 *
 * Then point packages/oracle-backend/.env at:
 *   DATABASE_URL=postgresql://oracle:oracle@127.0.0.1:5432/oracle
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseDir = join(repoRoot, '.dev-data', 'postgres');
const isNew = !existsSync(join(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'oracle',
  password: 'oracle',
  port: 5432,
  persistent: true,
});

if (isNew) await pg.initialise();
await pg.start();
if (isNew) await pg.createDatabase('oracle');

console.log('READY - postgresql://oracle:oracle@127.0.0.1:5432/oracle');
