import { env } from './config/env.js';
import { buildServer } from './server.js';
import { startJobs } from './jobs/index.js';
import { closeDatabase } from './db/index.js';

/**
 * Process entrypoint: build the API, start the DreamDEX bridge and background
 * workers, then listen. Shutdown is ordered - stop accepting requests, stop
 * the workers, then close the pool - so an in-flight settlement is never cut
 * off halfway through writing.
 */
async function main() {
  const app = await buildServer();
  const jobs = await startJobs(app.log);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      await jobs.stop();
      await closeDatabase();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // An unhandled rejection that reaches here is a bug, not a recoverable
  // state; log it loudly rather than letting Node exit silently.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled promise rejection');
  });

  await app.listen({ port: env.PORT, host: env.HOST });

  app.log.info(
    {
      api: `http://localhost:${env.PORT}/api/v1`,
      ws: `ws://localhost:${env.PORT}/ws`,
      dreamdex: env.DREAMDEX_MODE,
    },
    'Oracle backend ready',
  );
}

main().catch((err) => {
  console.error('Failed to start Oracle backend:', err);
  process.exit(1);
});
