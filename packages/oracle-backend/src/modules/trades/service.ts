import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { markets, predictions, trades, users } from '../../db/schema/index.js';
import { getDreamDexClient } from '../../dreamdex/index.js';
import type { Direction, OrderFilledEvent } from '../../dreamdex/types.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { normalizeAddress } from '../../lib/util.js';

/**
 * Order execution against DreamDEX.
 *
 * This is the module that makes Oracle worth building for the exchange: every
 * "Back this prediction" tap ends in a real Event Contract order, attributed
 * to the predictor whose call caused it.
 *
 * The write order is deliberate. We insert our own trade row FIRST, in PENDING
 * with a client order id, and only then call the exchange. If the process dies
 * between the two, we are left with a PENDING row we can reconcile against the
 * exchange - which is recoverable. Doing it the other way round would leave a
 * real, funded order on DreamDEX that Oracle has no record of, which is not.
 */

export interface PlaceTradeInput {
  userId: string;
  walletAddress: string;
  /** Backing someone's call. Determines the market and the side. */
  backedPredictionId?: string;
  /** Trading a market directly. Requires `side`. */
  marketId?: string;
  side?: Direction;
  /** Number of contracts. Mutually exclusive with amountUsd. */
  quantity?: string;
  /** Spend this much and buy as many contracts as it affords, as the UI does. */
  amountUsd?: string;
  /** Optional limit in cents; omitted means take the current offer. */
  limitPriceCents?: number;
  source?: 'BACK_PREDICTION' | 'OWN_PREDICTION' | 'DIRECT' | 'BATTLE';
  /**
   * Caller-supplied Idempotency-Key. Replaying a request with the same key
   * returns the original trade instead of placing a second funded order.
   */
  idempotencyKey?: string;
}

/**
 * Idempotency keys are namespaced by user before they are stored.
 *
 * The column is globally unique, so without this one user picking the key
 * "1" would collide with another user's "1" - and the loser of that race
 * would be handed back someone else's trade. Namespacing makes the guarantee
 * per-user, which is the only scope in which it is meaningful.
 */
const scopedKey = (userId: string, key: string) => `${userId}:${key}`;

export async function placeTrade(input: PlaceTradeInput) {
  const idempotencyKey = input.idempotencyKey
    ? scopedKey(input.userId, input.idempotencyKey)
    : null;

  // Fast path: we have already served this exact request.
  if (idempotencyKey) {
    const replay = await findByIdempotencyKey(idempotencyKey);
    if (replay) return replay;
  }

  const resolved = await resolveTarget(input);
  const { market, side, backedPredictionId, backedUserId, source } = resolved;

  if (market.status !== 'OPEN') {
    throw badRequest(`This market is ${market.status.toLowerCase()} and is not tradeable`);
  }
  if (market.closesAt.getTime() <= Date.now()) {
    throw badRequest('This market has already expired');
  }

  const priceCents = side === 'UP' ? market.upPriceCents : market.downPriceCents;
  if (priceCents === null || priceCents === undefined) {
    throw badRequest('No live price for this market yet - try again in a moment');
  }

  const quantity = resolveQuantity(input, priceCents);

  // Reserve our row before touching the exchange. Its id doubles as the
  // client order id, which is what makes a retried request idempotent rather
  // than a second funded order.
  const [pending] = await db
    .insert(trades)
    .values({
      userId: input.userId,
      marketId: market.id,
      backedPredictionId: backedPredictionId ?? null,
      backedUserId: backedUserId ?? null,
      source,
      side,
      priceCents,
      quantity,
      status: 'PENDING',
      idempotencyKey,
    })
    .onConflictDoNothing({ target: trades.idempotencyKey })
    .returning();

  // Lost the race against a concurrent request carrying the same key. The
  // other one is placing the order; hand back its row rather than opening a
  // second position. The unique index - not this code - is what guarantees
  // only one of the two ever reaches the exchange.
  if (!pending) {
    const winner = idempotencyKey ? await findByIdempotencyKey(idempotencyKey) : null;
    if (winner) return winner;
    throw badRequest('Could not create the order, please retry');
  }

  const trade = pending;
  const client = getDreamDexClient();

  try {
    const result = await client.placeOrder({
      marketId: market.dreamdexMarketId,
      side,
      priceCents: input.limitPriceCents ?? priceCents,
      quantity,
      walletAddress: normalizeAddress(input.walletAddress),
      clientOrderId: trade.id,
    });

    const [updated] = await db
      .update(trades)
      .set({
        dreamdexOrderId: result.orderId || null,
        status: result.status,
        filledQuantity: result.filledQuantity,
        txHash: result.txHash,
        failureReason: result.failureReason ?? null,
        filledAt: result.status === 'FILLED' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, trade.id))
      .returning();

    return updated!;
  } catch (err) {
    // The exchange rejected or was unreachable. Record why on the row rather
    // than losing it, so the user sees a failed order instead of nothing and
    // reconciliation has something to work with.
    const reason = err instanceof Error ? err.message : 'Order submission failed';
    const [failed] = await db
      .update(trades)
      .set({ status: 'FAILED', failureReason: reason, updatedAt: new Date() })
      .where(eq(trades.id, trade.id))
      .returning();
    return failed!;
  }
}

/**
 * Apply an on-chain fill.
 *
 * DreamDEX's kit is explicit that the OrderFilled event, not the REST trade
 * feed, is authoritative for fill, PnL and inventory - so this is the only
 * place a trade is allowed to become FILLED.
 *
 * Idempotent by design: the guard on status means a replayed log (a chain
 * reorg, a reconnect that re-delivers history) cannot double-count volume.
 */
export async function applyOrderFilled(event: OrderFilledEvent): Promise<string | null> {
  const [trade] = await db
    .select()
    .from(trades)
    .where(eq(trades.dreamdexOrderId, event.orderId));

  if (!trade) return null;
  if (trade.status === 'FILLED') return trade.id;

  const filled = Number(event.quantity);
  const ordered = Number(trade.quantity);
  const status = filled >= ordered ? 'FILLED' : 'PARTIALLY_FILLED';

  await db
    .update(trades)
    .set({
      status,
      filledQuantity: event.quantity,
      priceCents: event.priceCents,
      txHash: event.txHash,
      filledAt: new Date(event.timestamp),
      updatedAt: new Date(),
    })
    .where(eq(trades.id, trade.id));

  return trade.id;
}

/**
 * Realise PnL on every filled position in a settled market.
 *
 * A winning contract pays 100c; a losing one pays nothing. PnL is stored in
 * quote units so profile and receipt screens do not have to know about cents.
 */
export async function settleTradesForMarket(
  marketId: string,
  outcome: Direction,
): Promise<number> {
  const rows = await db
    .update(trades)
    .set({
      realizedPnl: sql`
        CASE WHEN ${trades.side} = ${outcome}
             THEN ${trades.filledQuantity} * (100 - ${trades.priceCents}) / 100.0
             ELSE -1 * ${trades.filledQuantity} * ${trades.priceCents} / 100.0
        END`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(trades.marketId, marketId),
        inArray(trades.status, ['FILLED', 'PARTIALLY_FILLED']),
        sql`${trades.realizedPnl} IS NULL`,
      ),
    )
    .returning({ id: trades.id });

  return rows.length;
}

export async function getUserTrades(userId: string, limit = 50) {
  return db
    .select({
      trade: trades,
      market: {
        id: markets.id,
        asset: markets.asset,
        duration: markets.duration,
        status: markets.status,
        outcome: markets.outcome,
        closesAt: markets.closesAt,
      },
      backedUser: {
        id: users.id,
        username: users.username,
      },
    })
    .from(trades)
    .innerJoin(markets, eq(markets.id, trades.marketId))
    .leftJoin(users, eq(users.id, trades.backedUserId))
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(Math.min(limit, 100));
}

/**
 * The number for the pitch: how much DreamDEX activity Oracle originated, and
 * how much of it came from someone backing another user's call rather than
 * trading a market directly.
 */
export async function getPlatformAttribution() {
  const [row] = await db
    .select({
      totalTrades: sql<number>`count(*)::int`,
      filledTrades: sql<number>`count(*) FILTER (WHERE ${trades.status} IN ('FILLED','PARTIALLY_FILLED'))::int`,
      notional: sql<string>`coalesce(sum(${trades.filledQuantity} * ${trades.priceCents} / 100.0), 0)`,
      fromBacking: sql<string>`coalesce(sum(
        CASE WHEN ${trades.backedPredictionId} IS NOT NULL
             THEN ${trades.filledQuantity} * ${trades.priceCents} / 100.0 ELSE 0 END), 0)`,
      uniqueTraders: sql<number>`count(DISTINCT ${trades.userId})::int`,
    })
    .from(trades);

  return row!;
}

// ------------------------------------------------------------------ helpers

async function findByIdempotencyKey(key: string) {
  const [row] = await db.select().from(trades).where(eq(trades.idempotencyKey, key));
  return row ?? null;
}

async function resolveTarget(input: PlaceTradeInput) {
  if (input.backedPredictionId) {
    const [row] = await db
      .select({ prediction: predictions, market: markets })
      .from(predictions)
      .innerJoin(markets, eq(markets.id, predictions.marketId))
      .where(eq(predictions.id, input.backedPredictionId));

    if (!row) throw notFound('Prediction');

    return {
      market: row.market,
      // Backing a call means taking that call's side. The client does not get
      // to choose, which is what makes the attribution meaningful.
      side: row.prediction.direction,
      backedPredictionId: row.prediction.id,
      backedUserId: row.prediction.userId,
      source:
        input.source ??
        (row.prediction.userId === input.userId ? 'OWN_PREDICTION' : 'BACK_PREDICTION'),
    } as const;
  }

  if (!input.marketId || !input.side) {
    throw badRequest('Provide either backedPredictionId, or both marketId and side');
  }

  const [market] = await db.select().from(markets).where(eq(markets.id, input.marketId));
  if (!market) throw notFound('Market');

  return {
    market,
    side: input.side,
    backedPredictionId: undefined,
    backedUserId: undefined,
    source: input.source ?? ('DIRECT' as const),
  } as const;
}

/**
 * The UI asks for a dollar amount ("Amount: $10"), the exchange wants a
 * contract count. At 43c, $10 buys 23.25 contracts.
 */
function resolveQuantity(input: PlaceTradeInput, priceCents: number): string {
  if (input.quantity) return input.quantity;

  if (input.amountUsd) {
    const amount = Number(input.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('amountUsd must be positive');
    const contracts = amount / (priceCents / 100);
    if (contracts < 0.000001) throw badRequest('Amount is too small to buy any contracts');
    return contracts.toFixed(6);
  }

  throw badRequest('Provide either quantity or amountUsd');
}
