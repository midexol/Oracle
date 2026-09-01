import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  follows,
  markets,
  predictions,
  trades,
  userSegmentStats,
  userStats,
} from '../db/schema/index.js';
import type { Asset, Duration } from '../dreamdex/types.js';
import { computeReputation, type ReputationMetrics, type ScoredPrediction } from './scoring.js';
import { toNumber } from '../lib/util.js';

/**
 * The reputation engine.
 *
 * `predictions` is the source of truth; `user_stats` and `user_segment_stats`
 * are a cache of it. Every number in those tables can be rebuilt from scratch
 * by `recomputeUserStats`, which is deliberate - a derived table that cannot
 * be rebuilt is a table that will eventually be wrong and unfixable.
 *
 * Recompute is a full rebuild rather than an incremental update. At hackathon
 * scale (hundreds of predictions per user) this costs one indexed query and is
 * immune to the drift that incremental counters accumulate when a settlement
 * is replayed or a market is retroactively voided. If a user's history ever
 * grows past that, the fix is to move this into SQL aggregates, not to make it
 * incremental.
 */

type SegmentKey = `${Asset}:${Duration}`;

interface SettledRow {
  status: 'WON' | 'LOST';
  entryPriceCents: number;
  settledAt: Date | null;
  createdAt: Date;
  asset: Asset;
  duration: Duration;
}

export interface RecomputeResult {
  userId: string;
  overall: ReputationMetrics;
  segments: Array<{ asset: Asset; duration: Duration; metrics: ReputationMetrics }>;
}

/**
 * Rebuild one user's reputation from their prediction history.
 *
 * Called whenever a prediction settles. Runs in a transaction so a profile
 * page can never read overall stats that disagree with segment stats.
 */
export async function recomputeUserStats(userId: string): Promise<RecomputeResult> {
  // Only WON/LOST count. PENDING has no outcome yet, and VOID means the
  // exchange cancelled the market - which must not be held against anyone.
  const rows = (await db
    .select({
      status: predictions.status,
      entryPriceCents: predictions.entryPriceCents,
      settledAt: predictions.settledAt,
      createdAt: predictions.createdAt,
      asset: markets.asset,
      duration: markets.duration,
    })
    .from(predictions)
    .innerJoin(markets, eq(predictions.marketId, markets.id))
    .where(
      and(eq(predictions.userId, userId), inArray(predictions.status, ['WON', 'LOST'])),
    )) as SettledRow[];

  const totalPredictions = await countTotalPredictions(userId);

  const overallInput: ScoredPrediction[] = rows.map(toScored);
  const overall = computeReputation(overallInput);

  const bySegment = new Map<SegmentKey, ScoredPrediction[]>();
  for (const row of rows) {
    const key: SegmentKey = `${row.asset}:${row.duration}`;
    const bucket = bySegment.get(key);
    if (bucket) bucket.push(toScored(row));
    else bySegment.set(key, [toScored(row)]);
  }

  const [social, attribution] = await Promise.all([
    getSocialCounts(userId),
    getBackingAttribution(userId),
  ]);

  const segments: RecomputeResult['segments'] = [...bySegment.entries()].map(([key, list]) => {
    const [asset, duration] = key.split(':') as [Asset, Duration];
    return { asset, duration, metrics: computeReputation(list) };
  });

  await db.transaction(async (tx) => {
    await tx
      .insert(userStats)
      .values({
        userId,
        totalPredictions,
        settledPredictions: overall.settled,
        correctPredictions: overall.correct,
        accuracy: numOrNull(overall.accuracy),
        score: overall.score,
        edge: numOrNull(overall.edge),
        roi: numOrNull(overall.roi),
        avgEntryPriceCents: overall.avgEntryPriceCents,
        currentStreak: overall.currentStreak,
        bestStreak: overall.bestStreak,
        volumeBacked: attribution.volume.toFixed(6),
        backersCount: attribution.backers,
        followersCount: social.followers,
        followingCount: social.following,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userStats.userId,
        set: {
          totalPredictions,
          settledPredictions: overall.settled,
          correctPredictions: overall.correct,
          accuracy: numOrNull(overall.accuracy),
          score: overall.score,
          edge: numOrNull(overall.edge),
          roi: numOrNull(overall.roi),
          avgEntryPriceCents: overall.avgEntryPriceCents,
          currentStreak: overall.currentStreak,
          bestStreak: overall.bestStreak,
          volumeBacked: attribution.volume.toFixed(6),
          backersCount: attribution.backers,
          followersCount: social.followers,
          followingCount: social.following,
          updatedAt: new Date(),
        },
      });

    // Replace the segment set wholesale. A user can only gain segments, but
    // deleting first keeps this correct if a market's asset is ever corrected
    // upstream, and it is a single indexed delete.
    await tx.delete(userSegmentStats).where(eq(userSegmentStats.userId, userId));

    if (segments.length > 0) {
      await tx.insert(userSegmentStats).values(
        segments.map((s) => ({
          userId,
          asset: s.asset,
          duration: s.duration,
          settledPredictions: s.metrics.settled,
          correctPredictions: s.metrics.correct,
          accuracy: numOrNull(s.metrics.accuracy),
          score: s.metrics.score,
          edge: numOrNull(s.metrics.edge),
          updatedAt: new Date(),
        })),
      );
    }
  });

  return { userId, overall, segments };
}

/**
 * Recompute every user touched by a settled market.
 *
 * The resolver calls this once per market rather than once per prediction, so
 * settling a market with 40 calls on it is 40 rebuilds, not 40 rebuilds per
 * prediction. Runs sequentially: correctness over throughput, and it keeps a
 * free-tier connection pool from being exhausted.
 */
export async function recomputeStatsForMarket(marketId: string): Promise<string[]> {
  const affected = await db
    .selectDistinct({ userId: predictions.userId })
    .from(predictions)
    .where(eq(predictions.marketId, marketId));

  for (const { userId } of affected) {
    await recomputeUserStats(userId);
  }
  return affected.map((a) => a.userId);
}

/** Full rebuild across every user. Used by the seeder and for backfills. */
export async function recomputeAllUserStats(): Promise<number> {
  const rows = await db.selectDistinct({ userId: predictions.userId }).from(predictions);
  for (const { userId } of rows) {
    await recomputeUserStats(userId);
  }
  return rows.length;
}

/** Ensures a freshly created user has a stats row, so joins never miss. */
export async function ensureUserStatsRow(userId: string): Promise<void> {
  await db.insert(userStats).values({ userId }).onConflictDoNothing();
}

// ------------------------------------------------------------------ helpers

const toScored = (row: SettledRow): ScoredPrediction => ({
  won: row.status === 'WON',
  entryPriceCents: row.entryPriceCents,
  // settledAt is written in the same statement that sets WON/LOST, but fall
  // back to createdAt so streak ordering never depends on a nullable column.
  settledAt: row.settledAt ?? row.createdAt,
});

/** Numeric columns are text over the wire; null stays null. */
const numOrNull = (n: number | null): string | null => (n === null ? null : String(n));

async function countTotalPredictions(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(predictions)
    .where(eq(predictions.userId, userId));
  return row?.count ?? 0;
}

async function getSocialCounts(userId: string) {
  const [followersRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(follows)
    .where(eq(follows.followingId, userId));
  const [followingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(follows)
    .where(eq(follows.followerId, userId));
  return { followers: followersRow?.count ?? 0, following: followingRow?.count ?? 0 };
}

/**
 * How much DreamDEX volume this predictor's calls originated.
 *
 * This is the attribution number the exchange cares about: not "how many
 * followers" but "how many contracts were bought because of this person".
 * Notional is filled quantity x price, in quote units.
 */
async function getBackingAttribution(userId: string) {
  const [row] = await db
    .select({
      volume: sql<string>`coalesce(sum(${trades.filledQuantity} * ${trades.priceCents} / 100.0), 0)`,
      backers: sql<number>`count(distinct ${trades.userId})::int`,
    })
    .from(trades)
    .where(and(eq(trades.backedUserId, userId), inArray(trades.status, ['FILLED', 'PARTIALLY_FILLED'])));

  return { volume: toNumber(row?.volume, 0), backers: row?.backers ?? 0 };
}
