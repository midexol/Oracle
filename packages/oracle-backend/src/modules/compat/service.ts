import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  markets,
  predictions,
  userSegmentStats,
  userStats,
  users,
} from '../../db/schema/index.js';
import { buildScoreExplanation, credibleInterval, momentumScore } from '../../analytics/confidence.js';
import type { ScoredPrediction } from '../../analytics/scoring.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { normalizeAddress } from '../../lib/util.js';
import type { Asset, Direction, Duration } from '../../dreamdex/types.js';

/**
 * Compatibility layer for the retired `oracle-analytics` API.
 *
 * The frontend was written against that package's contract, which differs from
 * this backend's in five ways at once: a `/api` base rather than `/api/v1`, a
 * `{ data: ... }` envelope, `/users/:wallet/profile` rather than
 * `/users/:handle`, accuracy as a percentage rather than a fraction, and
 * different field names throughout (`predictionScore`/`winRate`/`totalWins`
 * against `score`/`accuracy`/`correctPredictions`).
 *
 * Rather than ask the frontend to migrate mid-hackathon — or, worse, rename
 * this backend's own fields to match a retired package — the old shape is
 * served here as a translation over the same tables. `/api/v1` remains the
 * real API; this is a shim with an expiry date.
 *
 * TWO CONVENTIONS, both inherited from the old contract and both different
 * from `/api/v1`:
 *   - percentages are 0–100 here, fractions 0–1 there;
 *   - prices are dollars here (0.43), integer cents there (43).
 */

/**
 * Fraction (0–1) to the percentage the old contract used.
 *
 * Accepts strings because Postgres `numeric` arrives as one - reading it as a
 * JS number would silently lose precision on large values, so the driver hands
 * back the text and conversion happens here, at the edge.
 */
const pct = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : Math.round(Number(v) * 1000) / 10;

const dollars = (cents: string | number | null | undefined): number =>
  cents === null || cents === undefined ? 0 : Math.round(Number(cents)) / 100;

/**
 * The old API accepted either a wallet address or a username in :wallet.
 *
 * Addresses are compared lowercased because that is how they are stored, and
 * because callers send every casing there is: lowercase from
 * `eth_requestAccounts`, EIP-55 mixed case from a checksummed display, and
 * occasionally fully uppercased. Sniffing for a "0x" prefix does not survive
 * that last one - the prefix itself uppercases to "0X".
 *
 * Usernames are matched exactly; only the address arm is case-insensitive.
 */
async function resolveUser(handle: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(or(eq(users.walletAddress, handle.toLowerCase()), eq(users.username, handle)));

  if (!row) throw notFound('User');
  return row;
}

/** Settled calls for a user, newest first, in the scoring engine's shape. */
async function settledCalls(userId: string) {
  const rows = await db
    .select({
      id: predictions.id,
      won: sql<boolean>`${predictions.status} = 'WON'`,
      entryPriceCents: predictions.entryPriceCents,
      settledAt: predictions.settledAt,
      direction: predictions.direction,
      asset: markets.asset,
      duration: markets.duration,
    })
    .from(predictions)
    .innerJoin(markets, eq(markets.id, predictions.marketId))
    .where(and(eq(predictions.userId, userId), sql`${predictions.status} IN ('WON','LOST')`))
    .orderBy(desc(predictions.settledAt));

  return rows;
}

const toScored = (rows: Awaited<ReturnType<typeof settledCalls>>): ScoredPrediction[] =>
  rows.map((r) => ({
    won: r.won,
    entryPriceCents: r.entryPriceCents,
    settledAt: r.settledAt ?? new Date(0),
  }));

// --------------------------------------------------------------- profile

export async function getCompatProfile(handle: string) {
  const user = await resolveUser(handle);

  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, user.id));
  const segments = await db
    .select()
    .from(userSegmentStats)
    .where(eq(userSegmentStats.userId, user.id))
    .orderBy(userSegmentStats.asset, userSegmentStats.duration);

  const calls = await settledCalls(user.id);

  const settled = stats?.settledPredictions ?? calls.length;
  const wins = stats?.correctPredictions ?? calls.filter((c) => c.won).length;
  const ci = credibleInterval(wins, settled);

  return {
    wallet: user.walletAddress,
    username: user.username ?? undefined,
    avatar: user.avatarUrl ?? undefined,
    totalPredictions: settled,
    totalWins: wins,
    totalLosses: Math.max(settled - wins, 0),
    winRate: pct(stats?.accuracy ?? (settled > 0 ? wins / settled : 0)),
    predictionScore: stats?.score ?? 0,
    momentumScore: momentumScore(calls.map((c) => c.won)),
    // Percentages, to match winRate in the same payload.
    credibleInterval90: { lower: pct(ci.lower), upper: pct(ci.upper) },
    categoryBreakdown: segments.map((s) => ({
      label: `${s.asset} ${s.duration}`,
      asset: s.asset,
      duration: s.duration,
      totalPredictions: s.settledPredictions,
      totalWins: s.correctPredictions,
      accuracy: pct(s.accuracy),
      categoryScore: s.score,
    })),
    history: calls.map((c) => ({
      id: c.id,
      market: `${c.asset} ${c.duration}`,
      asset: c.asset,
      dir: c.direction,
      result: c.won ? ('WON' as const) : ('LOST' as const),
      // Dollars: the UI renders this as `$0.43`.
      price: dollars(c.entryPriceCents),
      resolvedAt: c.settledAt ? c.settledAt.toISOString() : null,
    })),
  };
}

export async function getCompatScoreBreakdown(handle: string) {
  const user = await resolveUser(handle);
  const calls = await settledCalls(user.id);
  return buildScoreExplanation(toScored(calls));
}

// --------------------------------------------------------------- context

/**
 * The "why this matters" line on the prediction detail page: this predictor's
 * record on this exact asset and tenor.
 */
export async function getCompatPredictionContext(predictionId: string) {
  const [row] = await db
    .select({
      id: predictions.id,
      userId: predictions.userId,
      username: users.username,
      walletAddress: users.walletAddress,
      asset: markets.asset,
      duration: markets.duration,
    })
    .from(predictions)
    .innerJoin(markets, eq(markets.id, predictions.marketId))
    .innerJoin(users, eq(users.id, predictions.userId))
    .where(eq(predictions.id, predictionId));

  if (!row) throw notFound('Prediction');

  const [segment] = await db
    .select()
    .from(userSegmentStats)
    .where(
      and(
        eq(userSegmentStats.userId, row.userId),
        eq(userSegmentStats.asset, row.asset),
        eq(userSegmentStats.duration, row.duration),
      ),
    );

  const displayName = row.username ?? shortenWallet(row.walletAddress);
  const label = `${row.asset} ${row.duration}`;

  const contextText =
    !segment || segment.settledPredictions === 0
      ? `${displayName} has no track record on ${label} markets yet.`
      : `${displayName} has correctly predicted ${label} markets ${pct(segment.accuracy)}% of ` +
        `the time (${segment.correctPredictions}/${segment.settledPredictions}).`;

  return {
    predictionId: row.id,
    contextText,
    stats: segment
      ? {
          accuracy: pct(segment.accuracy),
          totalWins: segment.correctPredictions,
          totalPredictions: segment.settledPredictions,
          categoryScore: segment.score,
        }
      : null,
  };
}

// --------------------------------------------------------------- leaderboard

export interface CompatLeaderboardParams {
  asset?: string;
  duration?: string;
  sortBy?: 'prediction_score' | 'accuracy';
  limit?: number;
}

export async function getCompatLeaderboard(params: CompatLeaderboardParams = {}) {
  const limit = Math.min(params.limit ?? 50, 100);
  const asset = params.asset && params.asset.toLowerCase() !== 'all' ? params.asset.toUpperCase() : null;
  const duration =
    params.duration && params.duration.toLowerCase() !== 'all' ? params.duration.toUpperCase() : null;
  const byAccuracy = params.sortBy === 'accuracy';

  // Filtered boards read the per-segment table; the overall board reads the
  // aggregate. Same numbers either way - both are projections of `predictions`.
  if (asset || duration) {
    const conditions: SQL[] = [sql`${userSegmentStats.settledPredictions} > 0`];
    if (asset) conditions.push(eq(userSegmentStats.asset, asset as Asset));
    if (duration) conditions.push(eq(userSegmentStats.duration, duration as Duration));

    const rows = await db
      .select({
        wallet: users.walletAddress,
        username: users.username,
        avatar: users.avatarUrl,
        asset: userSegmentStats.asset,
        duration: userSegmentStats.duration,
        totalPredictions: userSegmentStats.settledPredictions,
        totalWins: userSegmentStats.correctPredictions,
        accuracy: userSegmentStats.accuracy,
        score: userSegmentStats.score,
      })
      .from(userSegmentStats)
      .innerJoin(users, eq(users.id, userSegmentStats.userId))
      .where(and(...conditions))
      .orderBy(
        byAccuracy ? desc(userSegmentStats.accuracy) : desc(userSegmentStats.score),
        desc(userSegmentStats.settledPredictions),
      )
      .limit(limit);

    return rows.map((r, i) => ({
      rank: i + 1,
      wallet: r.wallet,
      username: r.username ?? shortenWallet(r.wallet),
      avatar: r.avatar ?? '',
      asset: r.asset,
      duration: r.duration,
      totalPredictions: r.totalPredictions,
      totalWins: r.totalWins,
      totalLosses: Math.max(r.totalPredictions - r.totalWins, 0),
      accuracy: pct(r.accuracy),
      predictionScore: r.score,
    }));
  }

  const rows = await db
    .select({
      wallet: users.walletAddress,
      username: users.username,
      avatar: users.avatarUrl,
      totalPredictions: userStats.settledPredictions,
      totalWins: userStats.correctPredictions,
      accuracy: userStats.accuracy,
      score: userStats.score,
    })
    .from(userStats)
    .innerJoin(users, eq(users.id, userStats.userId))
    .where(sql`${userStats.settledPredictions} > 0`)
    .orderBy(
      byAccuracy ? desc(userStats.accuracy) : desc(userStats.score),
      desc(userStats.settledPredictions),
    )
    .limit(limit);

  return rows.map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    username: r.username ?? shortenWallet(r.wallet),
    avatar: r.avatar ?? '',
    totalPredictions: r.totalPredictions,
    totalWins: r.totalWins,
    totalLosses: Math.max(r.totalPredictions - r.totalWins, 0),
    accuracy: pct(r.accuracy),
    predictionScore: r.score,
  }));
}

// --------------------------------------------------------------- create

const DURATION_MINUTES: Record<Duration, number> = {
  '1M': 1,
  '5M': 5,
  '15M': 15,
  '1H': 60,
  '4H': 240,
  '1D': 1440,
};

export interface CompatCreatePredictionInput {
  wallet: string;
  marketId: string;
  asset: string;
  duration: string;
  prediction: Direction;
  /** Dollars, 0–1, as the old contract sent it. */
  entryPrice: number;
  username?: string;
  avatar?: string;
}

/**
 * Record a call, creating the user and the market row if they are new.
 *
 * NOTE: unauthenticated, and it trusts the `wallet` in the body — which is how
 * the retired API worked and what the frontend still expects. Anyone can post
 * a call as any wallet. That is acceptable for a demo and NOT acceptable
 * beyond one: `POST /api/v1/predictions` is the authenticated equivalent
 * (wallet signature -> JWT), and the frontend should move to it before this is
 * exposed to anyone who has a reason to lie.
 */
export async function createCompatPrediction(input: CompatCreatePredictionInput) {
  if (!input.wallet?.startsWith('0x')) throw badRequest('A wallet address is required');

  const walletAddress = normalizeAddress(input.wallet);
  const asset = input.asset.toUpperCase() as Asset;
  const duration = input.duration.toUpperCase() as Duration;

  if (!(duration in DURATION_MINUTES)) {
    throw badRequest(`Unsupported duration "${input.duration}"`);
  }

  // Entry price anchors difficulty, so a nonsense value would corrupt this
  // user's edge and ROI permanently. Reject rather than clamp silently.
  const entryPriceCents = Math.round(input.entryPrice * 100);
  if (!Number.isFinite(entryPriceCents) || entryPriceCents < 1 || entryPriceCents > 99) {
    throw badRequest('entryPrice must be between 0.01 and 0.99');
  }

  const [user] = await db
    .insert(users)
    .values({
      walletAddress,
      username: input.username ?? null,
      avatarUrl: input.avatar ?? null,
    })
    .onConflictDoNothing({ target: users.walletAddress })
    .returning();

  const account =
    user ?? (await db.select().from(users).where(eq(users.walletAddress, walletAddress)))[0];
  if (!account) throw badRequest('Could not resolve the account for that wallet');

  const now = new Date();
  const closesAt = new Date(now.getTime() + DURATION_MINUTES[duration] * 60_000);

  const [inserted] = await db
    .insert(markets)
    .values({
      dreamdexMarketId: input.marketId,
      asset,
      duration,
      status: 'OPEN',
      upPriceCents: input.prediction === 'UP' ? entryPriceCents : 100 - entryPriceCents,
      downPriceCents: input.prediction === 'UP' ? 100 - entryPriceCents : entryPriceCents,
      opensAt: now,
      closesAt,
    })
    .onConflictDoNothing({ target: markets.dreamdexMarketId })
    .returning();

  const market =
    inserted ??
    (await db.select().from(markets).where(eq(markets.dreamdexMarketId, input.marketId)))[0];
  if (!market) throw badRequest('Could not resolve that market');

  const [created] = await db
    .insert(predictions)
    .values({
      userId: account.id,
      marketId: market.id,
      direction: input.prediction,
      entryPriceCents,
    })
    .onConflictDoNothing({ target: [predictions.userId, predictions.marketId] })
    .returning();

  if (!created) {
    const [existing] = await db
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, account.id), eq(predictions.marketId, market.id)));
    return { ...existing!, replayed: true };
  }

  return { ...created, replayed: false };
}

const shortenWallet = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
