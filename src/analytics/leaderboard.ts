import { eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { userStats } from '../db/schema/index.js';
import type { Asset, Duration } from '../dreamdex/types.js';
import { toNumber } from '../lib/util.js';
import { callsToReachScore } from './scoring.js';

/**
 * Leaderboard queries.
 *
 * The board supports the PRD's filter set - Overall | BTC | ETH | 15M | 1H -
 * and any combination of them. Rather than materialise a table per filter
 * combination, every board is one aggregate over `predictions`, with the
 * Wilson lower bound computed in SQL so Postgres can do the ranking, sorting
 * and pagination itself instead of us pulling every user into memory.
 *
 * This deliberately reads from the source of truth rather than `user_stats`.
 * A leaderboard that can silently disagree with a profile page is worse than a
 * slightly slower one, and the supporting index (predictions_user_status_idx
 * plus markets_asset_duration_idx) keeps it cheap at the scale this runs at.
 *
 * `user_stats` still earns its place elsewhere: the feed renders an accuracy
 * badge for every card, and that has to be an O(1) lookup, not an aggregate.
 */

export type LeaderboardSort = 'score' | 'accuracy' | 'edge' | 'volume' | 'streak';

export interface LeaderboardFilters {
  asset?: Asset;
  duration?: Duration;
  /** Hide users with too little history. Wilson already handles small samples,
   *  so this defaults to 1 rather than an arbitrary cutoff. */
  minPredictions?: number;
  sort?: LeaderboardSort;
  limit?: number;
  offset?: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  avatarUrl: string | null;
  settledPredictions: number;
  correctPredictions: number;
  accuracy: number;
  score: number;
  edge: number;
  roi: number;
  avgEntryPriceCents: number;
  volumeBacked: number;
}

/**
 * Wilson score lower bound, as a SQL expression.
 *
 * Mirrors `wilsonLowerBound` in scoring.ts exactly - same z, same algebra - so
 * the leaderboard and a user's profile can never show different scores.
 *
 * Two implementations of one formula is a standing hazard: change one and the
 * profile and the board start disagreeing. If you touch either, touch both,
 * and add the cross-check test once a test database is wired up.
 */
const Z = 1.96;

// Emitted as SQL literals rather than bind parameters. Postgres cannot infer a
// type for an untyped parameter used only in arithmetic ("could not determine
// data type of parameter $1"), and these are compile-time constants of ours,
// never user input, so inlining them is safe.
const ZL = sql.raw(String(Z));
const Z2 = sql.raw(String(Z * Z));

export const wilsonSql = (correct: SQL, total: SQL): SQL => sql`
  CASE WHEN ${total} = 0 THEN 0 ELSE
    (
      ((${correct}::float / ${total}) + ${Z2} / (2 * ${total}))
      - ${ZL} * sqrt(
          (
            (${correct}::float / ${total}) * (1 - (${correct}::float / ${total}))
            + ${Z2} / (4 * ${total})
          ) / ${total}
        )
    ) / (1 + ${Z2} / ${total})
  END`;

export async function getLeaderboard(
  filters: LeaderboardFilters = {},
): Promise<LeaderboardEntry[]> {
  const { asset, duration, minPredictions = 1, sort = 'score' } = filters;
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const conditions: SQL[] = [sql`p.status IN ('WON','LOST')`];
  if (asset) conditions.push(sql`m.asset = ${asset}`);
  if (duration) conditions.push(sql`m.duration = ${duration}`);
  const where = sql.join(conditions, sql` AND `);

  const settled = sql`count(*)`;
  const correct = sql`count(*) FILTER (WHERE p.status = 'WON')`;
  const score = wilsonSql(correct, settled);

  const orderBy = orderExpression(sort, score);

  const rows = await db.execute<{
    user_id: string;
    username: string | null;
    wallet_address: string;
    avatar_url: string | null;
    settled: number;
    correct: number;
    accuracy: string;
    score: string;
    edge: string;
    roi: string;
    avg_entry: string;
    volume_backed: string;
  }>(sql`
    SELECT
      u.id                AS user_id,
      u.username,
      u.wallet_address,
      u.avatar_url,
      ${settled}::int     AS settled,
      ${correct}::int     AS correct,
      (${correct}::float / NULLIF(${settled}, 0))            AS accuracy,
      ${score}                                                AS score,
      avg(
        (CASE WHEN p.status = 'WON' THEN 1.0 ELSE 0.0 END)
        - (p.entry_price_cents / 100.0)
      )                                                       AS edge,
      (
        sum(CASE WHEN p.status = 'WON'
                 THEN 100 - p.entry_price_cents
                 ELSE -p.entry_price_cents END)::float
        / NULLIF(sum(p.entry_price_cents), 0) * 100
      )                                                       AS roi,
      avg(p.entry_price_cents)                                AS avg_entry,
      coalesce(max(s.volume_backed), 0)                       AS volume_backed
    FROM predictions p
    JOIN markets m ON m.id = p.market_id
    JOIN users   u ON u.id = p.user_id
    LEFT JOIN user_stats s ON s.user_id = u.id
    WHERE ${where}
    GROUP BY u.id, u.username, u.wallet_address, u.avatar_url
    HAVING count(*) >= ${minPredictions}
    ORDER BY ${orderBy}, ${settled} DESC, u.created_at ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return rows.map((r, i) => ({
    rank: offset + i + 1,
    userId: r.user_id,
    username: r.username,
    walletAddress: r.wallet_address,
    avatarUrl: r.avatar_url,
    settledPredictions: Number(r.settled),
    correctPredictions: Number(r.correct),
    accuracy: toNumber(r.accuracy),
    score: Math.round(toNumber(r.score) * 100),
    edge: toNumber(r.edge),
    roi: toNumber(r.roi),
    avgEntryPriceCents: Math.round(toNumber(r.avg_entry)),
    volumeBacked: toNumber(r.volume_backed),
  }));
}

/**
 * Where one user sits on a given board.
 *
 * Shown as "you are #23" on the user's own profile, which is what turns a
 * ranking into a reason to make another prediction.
 */
export async function getUserRank(
  userId: string,
  filters: Omit<LeaderboardFilters, 'limit' | 'offset' | 'sort'> = {},
): Promise<{ rank: number; total: number } | null> {
  const { asset, duration, minPredictions = 1 } = filters;

  const conditions: SQL[] = [sql`p.status IN ('WON','LOST')`];
  if (asset) conditions.push(sql`m.asset = ${asset}`);
  if (duration) conditions.push(sql`m.duration = ${duration}`);
  const where = sql.join(conditions, sql` AND `);

  const settled = sql`count(*)`;
  const correct = sql`count(*) FILTER (WHERE p.status = 'WON')`;

  const rows = await db.execute<{ rank: number; total: number; user_id: string }>(sql`
    WITH ranked AS (
      SELECT
        p.user_id,
        rank() OVER (ORDER BY ${wilsonSql(correct, settled)} DESC, ${settled} DESC) AS rank,
        count(*) OVER () AS total
      FROM predictions p
      JOIN markets m ON m.id = p.market_id
      WHERE ${where}
      GROUP BY p.user_id
    )
    SELECT user_id, rank::int, total::int FROM ranked WHERE user_id = ${userId}
  `);

  const row = rows[0];
  return row ? { rank: Number(row.rank), total: Number(row.total) } : null;
}

/**
 * Predictors whose calls drove the most DreamDEX volume.
 *
 * Separate from the accuracy board on purpose: being right and being followed
 * into a trade are different achievements, and this is the one that shows the
 * exchange what Oracle is worth.
 */
export async function getVolumeLeaderboard(limit = 20): Promise<
  Array<{
    userId: string;
    username: string | null;
    walletAddress: string;
    volumeBacked: number;
    backersCount: number;
    tradesOriginated: number;
  }>
> {
  const rows = await db.execute<{
    user_id: string;
    username: string | null;
    wallet_address: string;
    volume: string;
    backers: number;
    trade_count: number;
  }>(sql`
    SELECT
      u.id                                                     AS user_id,
      u.username,
      u.wallet_address,
      coalesce(sum(t.filled_quantity * t.price_cents / 100.0), 0) AS volume,
      count(DISTINCT t.user_id)::int                           AS backers,
      count(t.id)::int                                         AS trade_count
    FROM users u
    JOIN trades t ON t.backed_user_id = u.id
    WHERE t.status IN ('FILLED', 'PARTIALLY_FILLED')
    GROUP BY u.id, u.username, u.wallet_address
    ORDER BY volume DESC
    LIMIT ${Math.min(limit, 100)}
  `);

  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    walletAddress: r.wallet_address,
    volumeBacked: toNumber(r.volume),
    backersCount: Number(r.backers),
    tradesOriginated: Number(r.trade_count),
  }));
}

/**
 * How far a user is from breaking into the top N.
 *
 * Turns a rank into a reason to make another call - "4 correct calls from the
 * top 10" is actionable in a way that "#23" is not. Uses the same Wilson
 * scoring as the board itself, so the target is honest: with a weak record,
 * reaching the top can genuinely require many more calls, and the answer is
 * then `null` rather than a number that flatters.
 */
export async function getProgressToTop(
  userId: string,
  topN = 10,
): Promise<{
  rank: number | null;
  total: number;
  score: number;
  inTop: boolean;
  targetScore: number | null;
  correctCallsNeeded: number | null;
}> {
  const [board, rank, stats] = await Promise.all([
    getLeaderboard({ limit: topN }),
    getUserRank(userId),
    db
      .select({
        correct: userStats.correctPredictions,
        settled: userStats.settledPredictions,
        score: userStats.score,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .then((r) => r[0]),
  ]);

  const score = stats?.score ?? 0;
  const inTop = rank !== null && rank.rank <= topN;

  // A board with fewer than topN entries has no threshold to clear.
  const threshold = board.length >= topN ? (board[board.length - 1]?.score ?? null) : null;

  return {
    rank: rank?.rank ?? null,
    total: rank?.total ?? 0,
    score,
    inTop,
    targetScore: inTop ? null : threshold,
    correctCallsNeeded:
      inTop || threshold === null || !stats
        ? null
        : callsToReachScore(stats.correct, stats.settled, threshold),
  };
}

function orderExpression(sort: LeaderboardSort, score: SQL): SQL {
  switch (sort) {
    case 'accuracy':
      return sql`(count(*) FILTER (WHERE p.status = 'WON')::float / NULLIF(count(*), 0)) DESC`;
    case 'edge':
      return sql`avg((CASE WHEN p.status = 'WON' THEN 1.0 ELSE 0.0 END) - (p.entry_price_cents / 100.0)) DESC`;
    case 'volume':
      return sql`coalesce(max(s.volume_backed), 0) DESC`;
    case 'streak':
      return sql`coalesce(max(s.current_streak), 0) DESC`;
    case 'score':
    default:
      return sql`${score} DESC`;
  }
}
