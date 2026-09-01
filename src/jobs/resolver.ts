import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { battles, markets, predictions } from '../db/schema/index.js';
import { getDreamDexClient } from '../dreamdex/index.js';
import type { Direction } from '../dreamdex/types.js';
import {
  settlePredictionsForMarket,
  voidPredictionsForMarket,
} from '../modules/predictions/service.js';
import { settleTradesForMarket } from '../modules/trades/service.js';
import { recomputeStatsForMarket } from '../analytics/reputation.js';
import { hub } from '../realtime/hub.js';

/**
 * The settlement pipeline - the step that turns a call into a track record.
 *
 * Order matters and is not arbitrary:
 *   1. record the market outcome
 *   2. settle predictions        (PENDING -> WON / LOST, write receipts)
 *   3. settle trades             (realise PnL on filled positions)
 *   4. settle any battle on it   (declare a winner)
 *   5. recompute reputation      (accuracy, score, edge, streaks, segments)
 *   6. broadcast                 (feed, market and leaderboard all move)
 *
 * Reputation is recomputed last because it reads the rows the earlier steps
 * write. Running it first, or concurrently, would produce stats for a
 * settlement that had not finished landing.
 *
 * The whole function is idempotent. Each step no-ops on already-settled rows,
 * so a duplicated settlement event, a reconnect that replays history, or the
 * safety-net sweep running over a market the live event already handled all
 * converge to the same state instead of double-counting.
 */
export async function resolveMarket(params: {
  dreamdexMarketId: string;
  outcome: Direction;
  closingReference?: string | null;
  settledAt?: Date;
}): Promise<{ marketId: string; won: number; lost: number } | null> {
  const settledAt = params.settledAt ?? new Date();

  const [market] = await db
    .update(markets)
    .set({
      status: 'SETTLED',
      outcome: params.outcome,
      closingReference: params.closingReference ?? null,
      settledAt,
      upPriceCents: params.outcome === 'UP' ? 100 : 0,
      downPriceCents: params.outcome === 'UP' ? 0 : 100,
      updatedAt: settledAt,
    })
    .where(eq(markets.dreamdexMarketId, params.dreamdexMarketId))
    .returning();

  // Not a market Oracle mirrors - nothing to settle.
  if (!market) return null;

  const { won, lost, affectedUserIds, settled } = await settlePredictionsForMarket(
    market.id,
    params.outcome,
  );

  await settleTradesForMarket(market.id, params.outcome);
  await settleBattlesForMarket(market.id, params.outcome);

  // Rebuilds reputation for exactly the users who called this market.
  if (affectedUserIds.length > 0) {
    await recomputeStatsForMarket(market.id);
  }

  // Tell each predictor their own call resolved, on their private channel.
  for (const s of settled) {
    hub.publish(`user:${s.userId}`, {
      type: 'prediction.settled',
      predictionId: s.predictionId,
      result: s.result,
    });
  }

  hub.publishMarket(market.id, {
    type: 'market.settled',
    marketId: market.id,
    outcome: params.outcome,
    won,
    lost,
  });
  if (won + lost > 0) hub.publish('feed', { type: 'leaderboard.changed' });

  return { marketId: market.id, won, lost };
}

/** A cancelled contract must not count against anyone. */
export async function voidMarket(dreamdexMarketId: string): Promise<void> {
  const [market] = await db
    .update(markets)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(eq(markets.dreamdexMarketId, dreamdexMarketId))
    .returning();

  if (!market) return;

  await voidPredictionsForMarket(market.id);
  await recomputeStatsForMarket(market.id);
}

async function settleBattlesForMarket(marketId: string, outcome: Direction): Promise<void> {
  const live = await db
    .select()
    .from(battles)
    .where(and(eq(battles.marketId, marketId), eq(battles.status, 'LIVE')));

  for (const battle of live) {
    // Side A is always UP and side B always DOWN, enforced at creation, so
    // the winning prediction follows directly from the outcome.
    const winningPredictionId =
      outcome === 'UP' ? battle.predictionAId : battle.predictionBId;

    const [winner] = await db
      .select({ userId: predictions.userId })
      .from(predictions)
      .where(eq(predictions.id, winningPredictionId));

    await db
      .update(battles)
      .set({
        status: 'SETTLED',
        winnerUserId: winner?.userId ?? null,
        settledAt: new Date(),
      })
      .where(eq(battles.id, battle.id));
  }
}

/**
 * Safety net.
 *
 * The live settlement event is the fast path, but a backend that only settles
 * on a WebSocket message will silently strand every market it was disconnected
 * for - and a prediction stuck PENDING forever is worse than a slow one. This
 * sweep re-checks anything past its close time against the exchange.
 */
export async function sweepUnsettledMarkets(): Promise<number> {
  const client = getDreamDexClient();

  const stale = await db
    .select({ id: markets.id, dreamdexMarketId: markets.dreamdexMarketId })
    .from(markets)
    .where(
      and(
        sql`${markets.status} IN ('OPEN','CLOSED')`,
        lt(markets.closesAt, new Date(Date.now() - 5_000)),
      ),
    )
    .limit(50);

  let settled = 0;

  for (const row of stale) {
    const remote = await client.getMarket(row.dreamdexMarketId).catch(() => null);
    if (!remote) continue;

    if (remote.status === 'SETTLED' && remote.outcome) {
      await resolveMarket({
        dreamdexMarketId: remote.marketId,
        outcome: remote.outcome,
        closingReference: remote.closingReference,
        settledAt: remote.settledAt ? new Date(remote.settledAt) : undefined,
      });
      settled++;
    } else if (remote.status === 'CANCELLED') {
      await voidMarket(remote.marketId);
      settled++;
    } else if (remote.status === 'CLOSED') {
      // Past expiry, awaiting on-chain finalisation. Reflect that so the UI
      // can stop showing a countdown, but leave predictions PENDING.
      await db
        .update(markets)
        .set({ status: 'CLOSED', updatedAt: new Date() })
        .where(eq(markets.id, row.id));
    }
  }

  return settled;
}
