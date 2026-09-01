import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  follows,
  markets,
  predictions,
  trades,
  userSegmentStats,
  userStats,
  users,
} from '../../db/schema/index.js';
import { notFound, badRequest, conflict } from '../../lib/errors.js';
import { getUserRank } from '../../analytics/leaderboard.js';
import { recomputeUserStats } from '../../analytics/reputation.js';

/**
 * Predictor profiles - PAGE 4 (someone else) and PAGE 7 (your own).
 *
 * The profile is meant to read like a player card, so it returns the headline
 * reputation, the specialities that make it credible, and the full history
 * that makes it checkable, in one call.
 */

/** Accepts a UUID, a username, or a wallet address. */
export async function findUser(handle: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handle);
  const [row] = await db
    .select()
    .from(users)
    .where(
      isUuid
        ? eq(users.id, handle)
        : or(eq(users.username, handle), eq(users.walletAddress, handle.toLowerCase())),
    );
  return row ?? null;
}

export async function getProfile(handle: string, viewerId?: string) {
  const user = await findUser(handle);
  if (!user) throw notFound('User');

  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, user.id));

  const [segments, history, rank, following] = await Promise.all([
    // Specialities, best first - "BTC 15M: 78%".
    db
      .select()
      .from(userSegmentStats)
      .where(eq(userSegmentStats.userId, user.id))
      .orderBy(desc(userSegmentStats.score)),

    getPredictionHistory(user.id),

    getUserRank(user.id),

    viewerId ? isFollowing(viewerId, user.id) : Promise.resolve(false),
  ]);

  const active = history.filter((h) => h.status === 'PENDING');
  const resolved = history.filter((h) => h.status === 'WON' || h.status === 'LOST');

  return {
    user: {
      id: user.id,
      username: user.username,
      walletAddress: user.walletAddress,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt,
    },
    // A user with no settled calls still gets a stats object rather than null,
    // so the client never has to branch on an empty profile.
    stats: stats ?? emptyStats(user.id),
    rank,
    specialties: segments,
    activePredictions: active,
    results: resolved,
    isFollowing: following,
  };
}

/**
 * Every call this user has made, newest first, with the contract and how it
 * resolved. Each row is enough to open a prediction receipt.
 */
export async function getPredictionHistory(userId: string, limit = 100) {
  return db
    .select({
      id: predictions.id,
      direction: predictions.direction,
      entryPriceCents: predictions.entryPriceCents,
      status: predictions.status,
      createdAt: predictions.createdAt,
      settledAt: predictions.settledAt,
      market: {
        id: markets.id,
        asset: markets.asset,
        duration: markets.duration,
        status: markets.status,
        outcome: markets.outcome,
        upPriceCents: markets.upPriceCents,
        downPriceCents: markets.downPriceCents,
        closesAt: markets.closesAt,
      },
    })
    .from(predictions)
    .innerJoin(markets, eq(markets.id, predictions.marketId))
    .where(eq(predictions.userId, userId))
    .orderBy(desc(predictions.createdAt))
    .limit(Math.min(limit, 200));
}

export async function updateProfile(
  userId: string,
  patch: { username?: string; avatarUrl?: string; bio?: string },
) {
  if (patch.username) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, patch.username));
    if (taken && taken.id !== userId) throw conflict('That username is taken');
  }

  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw notFound('User');
  return updated;
}

// --------------------------------------------------------------------- social

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const [row] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)));
  return Boolean(row);
}

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) throw badRequest('You cannot follow yourself');

  const target = await db.select({ id: users.id }).from(users).where(eq(users.id, followingId));
  if (target.length === 0) throw notFound('User');

  await db.insert(follows).values({ followerId, followingId }).onConflictDoNothing();

  // Follower counts live on user_stats; refresh both sides so the profile
  // header is correct immediately rather than after the next settlement.
  await Promise.all([recomputeUserStats(followerId), recomputeUserStats(followingId)]);

  return { following: true };
}

export async function unfollowUser(followerId: string, followingId: string) {
  await db
    .delete(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)));

  await Promise.all([recomputeUserStats(followerId), recomputeUserStats(followingId)]);

  return { following: false };
}

export async function listFollows(userId: string, kind: 'followers' | 'following') {
  const joinOn = kind === 'followers' ? follows.followerId : follows.followingId;
  const filterOn = kind === 'followers' ? follows.followingId : follows.followerId;

  return db
    .select({
      id: users.id,
      username: users.username,
      walletAddress: users.walletAddress,
      avatarUrl: users.avatarUrl,
      score: userStats.score,
      accuracy: userStats.accuracy,
    })
    .from(follows)
    .innerJoin(users, eq(users.id, joinOn))
    .leftJoin(userStats, eq(userStats.userId, users.id))
    .where(eq(filterOn, userId))
    .orderBy(desc(userStats.score))
    .limit(200);
}

/** Trades this user's calls caused other people to place. */
export async function getInfluence(userId: string) {
  const [row] = await db
    .select({
      tradesOriginated: sql<number>`count(*)::int`,
      backers: sql<number>`count(DISTINCT ${trades.userId})::int`,
      volume: sql<string>`coalesce(sum(${trades.filledQuantity} * ${trades.priceCents} / 100.0), 0)`,
    })
    .from(trades)
    .where(eq(trades.backedUserId, userId));
  return row!;
}

const emptyStats = (userId: string) => ({
  userId,
  totalPredictions: 0,
  settledPredictions: 0,
  correctPredictions: 0,
  accuracy: null,
  score: 0,
  edge: null,
  roi: null,
  avgEntryPriceCents: null,
  currentStreak: 0,
  bestStreak: 0,
  volumeBacked: '0',
  backersCount: 0,
  followersCount: 0,
  followingCount: 0,
  updatedAt: new Date(),
});
