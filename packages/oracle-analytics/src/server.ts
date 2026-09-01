import 'dotenv/config';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { startDreamDexResolutionWatcher } from './blockchain/somniaListener.js';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

const stopResolutionWatcher = startDreamDexResolutionWatcher({
  prisma,
  onError: (err) => {
    // eslint-disable-next-line no-console
    console.error('[dreamdexListener] error', err);
  },
});

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[oracle-analytics] listening on :${port}`);
});

async function shutdown() {
  server.close();
  await stopResolutionWatcher();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
