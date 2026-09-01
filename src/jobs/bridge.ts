import type { FastifyBaseLogger } from 'fastify';
import { getDreamDexClient } from '../dreamdex/index.js';
import { recordPriceSnapshot, updateQuote, upsertMarket } from '../modules/markets/service.js';
import { applyOrderFilled } from '../modules/trades/service.js';
import { resolveMarket } from './resolver.js';
import { hub } from '../realtime/hub.js';

/**
 * The bridge between DreamDEX and Oracle.
 *
 * Everything the exchange emits enters the system here and nowhere else, which
 * keeps the ingestion rules in one readable place:
 *
 *   market opened -> mirror the contract, announce it on the feed
 *   quote         -> update the cached price, snapshot it on an interval
 *   trade         -> forward to the market's tape (not persisted; the DreamDEX
 *                    tape is the exchange's record, not ours to duplicate)
 *   order filled  -> the authoritative fill, per the Bot Kit
 *   settled       -> hand off to the settlement pipeline
 *
 * Handlers are fire-and-forget with their own error handling. A failed write
 * on one quote must not tear down the subscription and stop the other five
 * event types, so nothing here is allowed to throw.
 */

/** Quotes tick far faster than a chart needs; snapshot at most this often. */
const SNAPSHOT_INTERVAL_MS = 5_000;

export function startDreamDexBridge(log: FastifyBaseLogger): () => void {
  const client = getDreamDexClient();
  const lastSnapshotAt = new Map<string, number>();

  const unsubscribe = client.subscribe({
    onStatusChange: (connected) => {
      log.info({ connected, mode: client.mode }, 'DreamDEX connection status changed');
    },

    onMarketOpened: (m) => {
      void (async () => {
        try {
          const row = await upsertMarket(m);
          hub.publish('feed', {
            type: 'market.opened',
            marketId: row.id,
            asset: row.asset,
            duration: row.duration,
            closesAt: row.closesAt.toISOString(),
          });
        } catch (err) {
          log.error({ err, marketId: m.marketId }, 'Failed to mirror new market');
        }
      })();
    },

    onQuote: (e) => {
      void (async () => {
        try {
          const marketId = await updateQuote(e.marketId, e.upPriceCents, e.downPriceCents);
          if (!marketId) return;

          hub.publishMarket(marketId, {
            type: 'quote',
            marketId,
            upPriceCents: e.upPriceCents,
            downPriceCents: e.downPriceCents,
          });

          const last = lastSnapshotAt.get(marketId) ?? 0;
          if (Date.now() - last >= SNAPSHOT_INTERVAL_MS) {
            lastSnapshotAt.set(marketId, Date.now());
            await recordPriceSnapshot(marketId, e.upPriceCents, e.downPriceCents);
          }
        } catch (err) {
          log.error({ err, marketId: e.marketId }, 'Failed to apply quote');
        }
      })();
    },

    onTrade: (t) => {
      // Broadcast only. The exchange owns the tape; mirroring every public
      // trade would make `trades` a copy of DreamDEX rather than a record of
      // what Oracle originated, which is the only thing it is useful for.
      hub.publish(`market:${t.marketId}`, {
        type: 'trade.tape',
        marketId: t.marketId,
        side: t.side,
        priceCents: t.priceCents,
        quantity: t.quantity,
      });
    },

    onOrderFilled: (e) => {
      void (async () => {
        try {
          const tradeId = await applyOrderFilled(e);
          if (!tradeId) return;
          log.info({ tradeId, txHash: e.txHash }, 'Order filled on-chain');
          hub.publish('feed', {
            type: 'order.filled',
            tradeId,
            marketId: e.marketId,
            txHash: e.txHash,
          });
        } catch (err) {
          log.error({ err, orderId: e.orderId }, 'Failed to apply OrderFilled event');
        }
      })();
    },

    onMarketSettled: (e) => {
      void (async () => {
        try {
          const result = await resolveMarket({
            dreamdexMarketId: e.marketId,
            outcome: e.outcome,
            closingReference: e.closingReference,
            settledAt: new Date(e.settledAt),
          });
          if (result) {
            log.info(
              { marketId: e.marketId, outcome: e.outcome, won: result.won, lost: result.lost },
              'Market settled',
            );
          }
        } catch (err) {
          log.error({ err, marketId: e.marketId }, 'Failed to settle market');
        }
      })();
    },
  });

  return unsubscribe;
}
