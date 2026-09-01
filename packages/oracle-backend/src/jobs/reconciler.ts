import { and, inArray, lt, sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { trades } from '../db/schema/index.js';
import { getDreamDexClient } from '../dreamdex/index.js';
import type { OrderStatus } from '../dreamdex/types.js';
import { hub } from '../realtime/hub.js';

/**
 * Order reconciliation.
 *
 * The `OrderFilled` event is the fast path, and the settlement sweep covers
 * markets - but neither covers a single order whose fill event we missed
 * because the process was restarting or the socket was down. Without this,
 * that trade sits PENDING forever: it never fills, never settles, and never
 * counts toward the attribution numbers the whole pitch rests on.
 *
 * Two distinct failure modes, and they need different treatment because real
 * money is involved:
 *
 *  1. `dreamdexOrderId` is set - we know the exchange accepted it, we just
 *     never saw the fill. Ask the exchange for the order's current state.
 *
 *  2. `dreamdexOrderId` is null - we crashed between inserting our row and
 *     persisting the exchange's response. A real, funded order may or may not
 *     exist. We hold exactly one handle in that case: the client order id we
 *     sent, which is our own trade id. That is what
 *     `getOrderByClientOrderId` is for. Guessing here would mean either
 *     abandoning a live position or double-ordering.
 *
 * A trade is only marked FAILED when the exchange positively reports no such
 * order AND enough time has passed that a slow acknowledgement is no longer a
 * plausible explanation. A lookup that throws is left alone for the next pass -
 * an unreachable exchange is not evidence that an order does not exist.
 */

/** Give an in-flight order this long before we start chasing it. */
const GRACE_MS = 15_000;

/** After this, an order the exchange has never heard of is considered dead. */
const ABANDON_AFTER_MS = 5 * 60_000;

export async function reconcileOpenOrders(): Promise<{
  checked: number;
  updated: number;
  abandoned: number;
}> {
  const client = getDreamDexClient();

  const open = await db
    .select()
    .from(trades)
    .where(
      and(
        inArray(trades.status, ['PENDING', 'PARTIALLY_FILLED']),
        lt(trades.createdAt, new Date(Date.now() - GRACE_MS)),
      ),
    )
    .orderBy(trades.createdAt)
    .limit(100);

  let updated = 0;
  let abandoned = 0;

  for (const trade of open) {
    let remote: OrderStatus | null;
    try {
      remote = trade.dreamdexOrderId
        ? await client.getOrder(trade.dreamdexOrderId)
        : await client.getOrderByClientOrderId(trade.id);
    } catch {
      // Transient lookup failure. Leave the row exactly as it is and retry on
      // the next pass rather than inventing a terminal state for a position
      // that may well be live.
      continue;
    }

    if (!remote) {
      const age = Date.now() - trade.createdAt.getTime();
      if (age > ABANDON_AFTER_MS) {
        await db
          .update(trades)
          .set({
            status: 'FAILED',
            failureReason: 'No matching order at DreamDEX after reconciliation window',
            updatedAt: new Date(),
          })
          .where(eq(trades.id, trade.id));
        abandoned++;
      }
      continue;
    }

    // The exchange knows the order. Adopt its view.
    const filledQuantity = remote.filledQuantity ?? '0';
    const nothingChanged =
      remote.status === trade.status &&
      filledQuantity === trade.filledQuantity &&
      (remote.txHash ?? null) === trade.txHash &&
      (remote.orderId || null) === trade.dreamdexOrderId;

    if (nothingChanged) continue;

    const isTerminalFill = remote.status === 'FILLED' || remote.status === 'PARTIALLY_FILLED';

    await db
      .update(trades)
      .set({
        // Backfills the id in the crash-between-write-and-response case.
        dreamdexOrderId: remote.orderId || trade.dreamdexOrderId,
        status: remote.status,
        filledQuantity,
        priceCents: remote.averagePriceCents ?? trade.priceCents,
        txHash: remote.txHash ?? trade.txHash,
        failureReason: remote.failureReason ?? trade.failureReason,
        filledAt: remote.status === 'FILLED' ? (trade.filledAt ?? new Date()) : trade.filledAt,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, trade.id));

    updated++;

    if (isTerminalFill && remote.txHash) {
      hub.publish('feed', {
        type: 'order.filled',
        tradeId: trade.id,
        marketId: trade.marketId,
        txHash: remote.txHash,
      });
    }
  }

  return { checked: open.length, updated, abandoned };
}

/**
 * Trades that were filled while their market was already settled, and so never
 * had PnL realised by the settlement pass.
 *
 * A narrow case - a fill landing after settlement - but one that silently
 * understates a user's realised PnL forever if nothing repairs it.
 */
export async function backfillMissingPnl(): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE trades t
    SET realized_pnl = CASE
          WHEN t.side::text = m.outcome::text
            THEN t.filled_quantity * (100 - t.price_cents) / 100.0
          ELSE -1 * t.filled_quantity * t.price_cents / 100.0
        END,
        updated_at = now()
    FROM markets m
    WHERE m.id = t.market_id
      AND m.status = 'SETTLED'
      AND m.outcome IS NOT NULL
      AND t.status IN ('FILLED', 'PARTIALLY_FILLED')
      AND t.realized_pnl IS NULL
    RETURNING t.id
  `);

  return rows.length;
}
