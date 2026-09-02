import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  follows,
  markets,
  predictionResults,
  predictions,
  trades,
  userSegmentStats,
  userStats,
  users,
} from '../../db/schema/index.js';
import type { Asset, Direction, Duration } from '../../dreamdex/types.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { decodeCursor, encodeCursor } from '../../lib/util.js';

/**
 * Predictions are the social object of Oracle.
 *
 * A prediction is a public, timestamped, price-anchored call on a real Event
 * Contract. The price anchor is what separates it from a post: we record what
 * the market was charging for that side at the moment the user committed, so
 * later we can say not just "they were right" but "they were right when the
 * market said 43%".
 */

export interface CreatePredictionInput {
  userId: string;
  marketId: string;
  direction: Direction;
  stake?: string;
  rationale?: string;
}

export async function createPrediction(input: CreatePredictionInput) {
  const [market] = await db.select().from(markets).where(eq(markets.id, input.marketId));
  if (!market) throw notFound('Market');

  if (market.status !== 'OPEN') {
    throw badRequest(`This market is ${market.status.toLowerCase()} and no longer accepts calls`);
  }
  if (market.closesAt.getTime() <= Date.now()) {
    throw badRequest('This market has already expired');
  }

  const entryPriceCents =
    input.direction === 'UP' ? market.upPriceCents : market.downPriceCents;

  // Without a live quote the call has no difficulty anchor, which would
  // silently corrupt edge and ROI for this user forever. Refuse instead.
  if (entryPriceCents === null || entryPriceCents === undefined) {
    throw badRequest('No live price for this market yet - try again in a moment');
  }

  const [created] = await db
    .insert(predictions)
    .values({
      userId: input.userId,
      marketId: input.marketId,
      direction: input.direction,
      entryPriceCents,
      stake: input.stake ?? null,
      rationale: input.rationale ?? null,
    })
    .onConflictDoNothing({ target: [predictions.userId, predictions.marketId] })
    .returning();

  // The unique index did the work: this user already called this market. We
  // refuse rather than update, because a track record where calls can be
  // edited after the fact is not a track record.
  if (!created) throw conflict('You have already made a call on this market');

  return created;
}

export interface FeedFilters {
  asset?: Asset;
  duration?: Duration;
  direction?: Direction;
  userId?: string;
  /** Only calls from people the viewer follows. */
  followedBy?: string;
  /** Include calls on markets that have already settled. */
  includeSettled?: boolean;
  limit?: number;
  cursor?: string;
}

/**
 * PAGE 1: HOME - the live prediction feed.
 *
 * One query returns everything a card renders: the call, the contract, the
 * live price, the predictor, their overall accuracy and - the number that
 * actually persuades - their accuracy on this exact asset and tenor.
 *
 * Doing it as a single join matters. The alternative, fetching 20 predictions
 * and then looking up each predictor's stats, is the classic N+1 that turns
 * the homepage into 40 round trips against a free-tier database.
 */
export async function getFeed(filters: FeedFilters = {}) {
  const limit = Math.min(filters.limit ?? 20, 50);
  const conditions: SQL[] = [];

  if (!filters.includeSettled) {
    conditions.push(eq(predictions.status, 'PENDING'));
  }
  if (filters.asset) conditions.push(eq(markets.asset, filters.asset));
  if (filters.duration) conditions.push(eq(markets.duration, filters.duration));
  if (filters.direction) conditions.push(eq(predictions.direction, filters.direction));
  if (filters.userId) conditions.push(eq(predictions.userId, filters.userId));

  if (filters.followedBy) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${follows} f
        WHERE f.follower_id = ${filters.followedBy}
          AND f.following_id = ${predictions.userId}
      )`,
    );
  }

  const cursorDate = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursorDate) conditions.push(lt(predictions.createdAt, new Date(cursorDate)));

  const rows = await db
    .select({
      id: predictions.id,
      direction: predictions.direction,
      entryPriceCents: predictions.entryPriceCents,
      stake: predictions.stake,
      rationale: predictions.rationale,
      status: predictions.status,
      createdAt: predictions.createdAt,

      market: {
        id: markets.id,
        dreamdexMarketId: markets.dreamdexMarketId,
        asset: markets.asset,
        duration: markets.duration,
        status: markets.status,
        outcome: markets.outcome,
        upPriceCents: markets.upPriceCents,
        downPriceCents: markets.downPriceCents,
        closesAt: markets.closesAt,
      },

      user: {
        id: users.id,
        username: users.username,
        walletAddress: users.walletAddress,
        avatarUrl: users.avatarUrl,
      },

      // Overall reputation.
      score: userStats.score,
      accuracy: userStats.accuracy,
      settledPredictions: userStats.settledPredictions,
      currentStreak: userStats.currentStreak,

      // Reputation on this exact (asset, duration).
      segmentAccuracy: userSegmentStats.accuracy,
      segmentSettled: userSegmentStats.settledPredictions,

      // Social proof: how many people already put money behind this call.
      backersCount: sql<number>`(
        SELECT count(DISTINCT t.user_id)::int FROM ${trades} t
        WHERE t.backed_prediction_id = ${predictions.id}
          AND t.status IN ('FILLED','PARTIALLY_FILLED')
      )`,
    })
    .from(predictions)
    .innerJoin(markets, eq(markets.id, predictions.marketId))
    .innerJoin(users, eq(users.id, predictions.userId))
    .leftJoin(userStats, eq(userStats.userId, predictions.userId))
    .leftJoin(
      userSegmentStats,
      and(
        eq(userSegmentStats.userId, predictions.userId),
        eq(userSegmentStats.asset, markets.asset),
        eq(userSegmentStats.duration, markets.duration),
      ),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(predictions.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString()) : null,
  };
}

/**
 * PAGE 3: PREDICTION DETAIL - the hero screen.
 *
 * Returns the call, the contract, the predictor's full reputation including
 * their record on this segment, and the backing already behind it. The
 * "why this matters" line on the page is rendered from `segment`.
 */
export async function getPredictionDetail(predictionId: string) {
  const [row] = await db
    .select({
      prediction: predictions,
      market: markets,
      user: {
        id: users.id,
        username: users.username,
        walletAddress: users.walletAddress,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
      },
      stats: userStats,
    })
    .from(predictions)
    .innerJoin(markets, eq(markets.id, predictions.marketId))
    .innerJoin(users, eq(users.id, predictions.userId))
    .leftJoin(userStats, eq(userStats.userId, predictions.userId))
    .where(eq(predictions.id, predictionId));

  if (!row) throw notFound('Prediction');

  const [segment] = await db
    .select()
    .from(userSegmentStats)
    .where(
      and(
        eq(userSegmentStats.userId, row.user.id),
        eq(userSegmentStats.asset, row.market.asset),
        eq(userSegmentStats.duration, row.market.duration),
      ),
    );

  const [backing] = await db
    .select({
      backers: sql<number>`count(DISTINCT ${trades.userId})::int`,
      volume: sql<string>`coalesce(sum(${trades.filledQuantity} * ${trades.priceCents} / 100.0), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(trades)
    .where(
      and(
        eq(trades.backedPredictionId, predictionId),
        inArray(trades.status, ['FILLED', 'PARTIALLY_FILLED']),
      ),
    );

  const [settlement] = await db
    .select()
    .from(predictionResults)
    .where(eq(predictionResults.predictionId, predictionId));

  return {
    ...row,
    segment: segment ?? null,
    backing: {
      backers: backing?.backers ?? 0,
      trades: backing?.count ?? 0,
      volume: backing?.volume ?? '0',
    },
    settlement: settlement ?? null,
  };
}

/**
 * Settle every open call on a market. Called by the resolver once DreamDEX
 * reports an outcome.
 *
 * Two properties matter here:
 *  - it is idempotent: only PENDING rows are touched, so replaying a
 *    settlement event cannot flip an already-recorded result;
 *  - the ledger write and the status write happen in one transaction, so a
 *    receipt never exists for a prediction that still reads PENDING.
 */
export interface SettledPrediction {
  predictionId: string;
  userId: string;
  result: 'WON' | 'LOST';
}

export async function settlePredictionsForMarket(
  marketId: string,
  outcome: Direction,
): Promise<{
  won: number;
  lost: number;
  affectedUserIds: string[];
  settled: SettledPrediction[];
}> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({
        id: predictions.id,
        userId: predictions.userId,
        direction: predictions.direction,
        entryPriceCents: predictions.entryPriceCents,
      })
      .from(predictions)
      .where(and(eq(predictions.marketId, marketId), eq(predictions.status, 'PENDING')));

    if (pending.length === 0) return { won: 0, lost: 0, affectedUserIds: [], settled: [] };

    const settledAt = new Date();
    const winners = pending.filter((p) => p.direction === outcome);
    const losers = pending.filter((p) => p.direction !== outcome);

    if (winners.length > 0) {
      await tx
        .update(predictions)
        .set({ status: 'WON', settledAt, updatedAt: settledAt })
        .where(inArray(predictions.id, winners.map((w) => w.id)));
    }
    if (losers.length > 0) {
      await tx
        .update(predictions)
        .set({ status: 'LOST', settledAt, updatedAt: settledAt })
        .where(inArray(predictions.id, losers.map((l) => l.id)));
    }

    await tx
      .insert(predictionResults)
      .values(
        pending.map((p) => ({
          predictionId: p.id,
          result: (p.direction === outcome ? 'WON' : 'LOST') as 'WON' | 'LOST',
          marketOutcome: outcome,
          entryPriceCents: p.entryPriceCents,
          settlementPriceCents: p.direction === outcome ? 100 : 0,
          settledAt,
        })),
      )
      .onConflictDoNothing();

    return {
      won: winners.length,
      lost: losers.length,
      affectedUserIds: [...new Set(pending.map((p) => p.userId))],
      // Returned so the caller can notify each predictor individually. The
      // transaction owns the write; broadcasting belongs outside it.
      settled: pending.map((p) => ({
        predictionId: p.id,
        userId: p.userId,
        result: (p.direction === outcome ? 'WON' : 'LOST') as 'WON' | 'LOST',
      })),
    };
  });
}

/**
 * Void every open call on a cancelled market.
 *
 * A market the exchange cancels must not count against anyone's accuracy -
 * they were not wrong, the contract simply never resolved.
 */
export async function voidPredictionsForMarket(marketId: string): Promise<string[]> {
  const voided = await db
    .update(predictions)
    .set({ status: 'VOID', settledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(predictions.marketId, marketId), eq(predictions.status, 'PENDING')))
    .returning({ userId: predictions.userId });

  return [...new Set(voided.map((v) => v.userId))];
}
