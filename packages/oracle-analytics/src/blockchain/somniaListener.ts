import type { PrismaClient } from '@prisma/client';
import type { Hex } from 'viem';
import { closeExchange, createExchange, watchSettlement } from '@signal/dreamdex-integration';
import { SettlementWorker } from '../workers/settlementWorker.js';

export interface StartResolutionWatcherOptions {
  prisma: PrismaClient;
  onError?: (err: unknown) => void;
  /** How often to check for newly-created PENDING markets that aren't being watched yet. */
  pollIntervalMs?: number;
}

/**
 * Watches every distinct on-chain market that still has PENDING predictions
 * via DreamDEX's real settlement read path (`@signal/dreamdex-integration`'s
 * `watchSettlement`, backed by `@somnia-chain/markets-sdk`) and feeds each
 * resolution/void into the SettlementWorker. Markets are discovered by
 * polling our own PENDING predictions rather than a single contract-wide
 * event, since DreamDEX resolves markets individually and this package has
 * no reason to load the SDK's full market list.
 *
 * Returns a stop() function that cancels every subscription and closes the
 * read-only exchange client cleanly.
 */
export function startDreamDexResolutionWatcher({
  prisma,
  onError,
  pollIntervalMs = 30_000,
}: StartResolutionWatcherOptions): () => Promise<void> {
  const exchange = createExchange();
  const settlementWorker = new SettlementWorker(prisma);
  const watching = new Map<string, () => void>();
  let stopped = false;

  async function discoverAndWatch() {
    const pendingMarkets = await prisma.prediction.findMany({
      where: { status: 'PENDING' },
      select: { marketId: true },
      distinct: ['marketId'],
    });

    for (const { marketId } of pendingMarkets) {
      if (stopped || watching.has(marketId)) continue;

      const subscription = watchSettlement(exchange, marketId as Hex, async (result) => {
        watching.delete(marketId);
        try {
          if (result.state === 'voided') {
            const summary = await settlementWorker.voidMarket(marketId);
            // eslint-disable-next-line no-console
            console.log(`[dreamdexListener] voided market ${marketId}: ${summary.voidedCount} cancelled`);
            return;
          }

          // NOTE: YES == UP is assumed but not yet confirmed against a real
          // market's `question` field — see CLAUDE.md "known unknowns".
          const direction = result.winningOutcome === 'YES' ? 'UP' : 'DOWN';
          const summary = await settlementWorker.resolveMarket(marketId, direction);
          // eslint-disable-next-line no-console
          console.log(
            `[dreamdexListener] resolved market ${summary.marketId}: ${summary.winners}W/${summary.losers}L`,
          );
        } catch (err) {
          onError?.(err);
        }
      });

      watching.set(marketId, subscription.stop);
    }
  }

  discoverAndWatch().catch((err) => onError?.(err));
  const interval = setInterval(() => {
    discoverAndWatch().catch((err) => onError?.(err));
  }, pollIntervalMs);

  return async () => {
    stopped = true;
    clearInterval(interval);
    for (const stop of watching.values()) stop();
    watching.clear();
    await closeExchange(exchange);
  };
}
