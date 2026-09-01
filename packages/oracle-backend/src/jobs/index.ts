import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env.js';
import { getDreamDexClient } from '../dreamdex/index.js';
import { upsertMarket } from '../modules/markets/service.js';
import { startDreamDexBridge } from './bridge.js';
import { sweepUnsettledMarkets } from './resolver.js';
import { backfillMissingPnl, reconcileOpenOrders } from './reconciler.js';

/**
 * Background workers.
 *
 * Three of them, with different jobs:
 *
 *   marketSync - a periodic full reconciliation against DreamDEX. The live
 *                event stream is the fast path; this is what repairs the gap
 *                after a disconnect, a restart, or a dropped message.
 *
 *   resolver   - the settlement sweep. Catches any market whose settlement
 *                event we missed, so no prediction is left PENDING forever.
 *
 *   reconciler - the order sweep. Catches any single order whose on-chain fill
 *                event we missed, so no trade is left PENDING forever and no
 *                originated volume goes uncounted.
 *
 * All three are pull-based and idempotent, which is the point: the system is
 * correct on the event stream alone and correct on the sweeps alone, so it
 * survives losing either one.
 */

export interface JobHandles {
  stop: () => Promise<void>;
}

export async function startJobs(log: FastifyBaseLogger): Promise<JobHandles> {
  const client = getDreamDexClient();
  const timers: NodeJS.Timeout[] = [];

  await client.start();
  log.info({ mode: client.mode }, 'DreamDEX client started');

  const unsubscribeBridge = startDreamDexBridge(log);

  // Prime the database with whatever is already listed, so the feed is not
  // empty for the first tick after a cold start.
  await syncMarkets(log);

  if (env.ENABLE_JOBS) {
    timers.push(interval(() => syncMarkets(log), env.MARKET_SYNC_INTERVAL_MS));
    timers.push(
      interval(async () => {
        const n = await sweepUnsettledMarkets();
        if (n > 0) log.info({ settled: n }, 'Resolver sweep settled stranded markets');
      }, env.RESOLVER_INTERVAL_MS),
    );
    timers.push(
      interval(async () => {
        const { updated, abandoned } = await reconcileOpenOrders();
        const repaired = await backfillMissingPnl();
        if (updated || abandoned || repaired) {
          log.info({ updated, abandoned, repaired }, 'Order reconciliation applied changes');
        }
      }, env.RECONCILER_INTERVAL_MS),
    );
    log.info(
      {
        marketSyncMs: env.MARKET_SYNC_INTERVAL_MS,
        resolverMs: env.RESOLVER_INTERVAL_MS,
        reconcilerMs: env.RECONCILER_INTERVAL_MS,
      },
      'Background jobs started',
    );
  } else {
    log.warn(
      'ENABLE_JOBS=false - market sync, settlement sweep and order reconciliation are disabled',
    );
  }

  return {
    stop: async () => {
      for (const t of timers) clearInterval(t);
      unsubscribeBridge();
      await client.stop();
    },
  };
}

/** Mirror the exchange's current market list into our tables. */
async function syncMarkets(log: FastifyBaseLogger): Promise<void> {
  try {
    const remote = await getDreamDexClient().listMarkets();
    for (const m of remote) {
      await upsertMarket(m);
    }
  } catch (err) {
    // Losing one sync cycle is survivable; the next one repairs it. Log and
    // carry on rather than crashing the process.
    log.error({ err }, 'Market sync failed');
  }
}

/**
 * setInterval that never overlaps itself and never lets a rejected promise
 * reach the process. A slow database must not queue up sync runs.
 */
function interval(fn: () => Promise<void> | void, ms: number): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void Promise.resolve(fn())
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, ms);
  timer.unref?.();
  return timer;
}
