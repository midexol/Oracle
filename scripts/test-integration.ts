import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Runs the integration suite against a throwaway Postgres.
 *
 * If TEST_DATABASE_URL is already set (CI, or a Neon scratch branch) we use it
 * and start nothing. Otherwise we boot an embedded Postgres into a temp
 * directory, run the suite, and delete it afterwards - so `npm run
 * test:integration` works on a laptop with no Docker and no local Postgres,
 * which is the only way these tests get run often enough to be worth having.
 */

/**
 * Ask the OS for a free port rather than hardcoding one.
 *
 * A hardcoded port is a trap: if a previous run was killed before its
 * shutdown hook ran, the orphaned postgres still holds the port and the next
 * run blocks forever on startup with no useful output. Binding to port 0 and
 * reading back what we were given makes an interrupted run harmless.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

async function main() {
  const existing = process.env.TEST_DATABASE_URL;
  if (existing) {
    console.log('Using TEST_DATABASE_URL from the environment.');
    process.exit(await runVitest(existing));
  }

  const port = Number(process.env.TEST_PG_PORT) || (await findFreePort());
  const dataDir = mkdtempSync(join(tmpdir(), 'oracle-pg-'));
  console.log(`Starting embedded Postgres on port ${port}...`);

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });

  let started = false;
  const shutdown = async () => {
    if (started) {
      started = false;
      await pg.stop().catch(() => undefined);
    }
  };

  // Ctrl-C must still take the database down, or the next run inherits an
  // orphan holding its data directory.
  process.once('SIGINT', () => void shutdown().then(() => process.exit(130)));
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(143)));

  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase('oracle_test');

    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/oracle_test`;
    process.exitCode = await runVitest(url);
  } finally {
    await shutdown();
    // Best effort: Windows sometimes holds the data directory briefly after
    // shutdown, and a leftover temp dir is not worth failing the run over.
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function runVitest(databaseUrl: string): Promise<number> {
  // Resolve and run vitest's own entrypoint with this Node binary rather than
  // going through npx. Spawning a .cmd shim on Windows needs a shell, and a
  // shell means quoting rules we do not want in the way of a test runner.
  const vitestBin = fileURLToPath(import.meta.resolve('vitest/vitest.mjs'));

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [vitestBin, 'run', '--config', 'vitest.integration.config.ts'],
      {
        stdio: 'inherit',
        env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
      },
    );
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
