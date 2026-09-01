import { aliasedTable, and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  battles,
  markets,
  predictions,
  trades,
  userStats,
  users,
} from '../../db/schema/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';

/**
 * PAGE 5: BATTLES.
 *
 * A battle promotes two opposing calls on the same contract into a head-to-head.
 * The point is not the card - it is that picking a side means taking the
 * corresponding DreamDEX position, so a battle is a volume driver rather than
 * a poll. Backing a side is just `POST /trades` with that side's
 * `backedPredictionId`, which means battles inherit attribution, fills and
 * settlement for free.
 *
 * Invariant enforced everywhere below: side A is always the UP call and side B
 * always the DOWN call. Normalising at creation is what lets the resolver pick
 * a winner from the market outcome alone, with no extra lookup.
 */

export async function createBattle(predictionAId: string, predictionBId: string) {
  if (predictionAId === predictionBId) throw badRequest('A battle needs two different calls');

  const rows = await db
    .select({ prediction: predictions, market: markets })
    .from(predictions)
    .innerJoin(markets, eq(markets.id, predictions.marketId))
    .where(inArray(predictions.id, [predictionAId, predictionBId]));

  if (rows.length !== 2) throw notFound('Prediction');

  const [first, second] = rows as [(typeof rows)[number], (typeof rows)[number]];

  if (first.market.id !== second.market.id) {
    throw badRequest('Both calls must be on the same market');
  }
  if (first.prediction.direction === second.prediction.direction) {
    throw badRequest('A battle needs one UP call and one DOWN call');
  }
  if (first.prediction.userId === second.prediction.userId) {
    throw badRequest('A predictor cannot battle themselves');
  }
  if (first.market.status !== 'OPEN') {
    throw badRequest('That market is no longer open');
  }

  // Normalise: A is UP, B is DOWN, regardless of the order supplied.
  const up = first.prediction.direction === 'UP' ? first : second;
  const down = first.prediction.direction === 'UP' ? second : first;

  const [created] = await db
    .insert(battles)
    .values({
      marketId: first.market.id,
      predictionAId: up.prediction.id,
      predictionBId: down.prediction.id,
    })
    .onConflictDoNothing({ target: [battles.predictionAId, battles.predictionBId] })
    .returning();

  if (!created) throw conflict('These two calls are already in a battle');

  return created;
}

export interface BattleFilters {
  status?: 'LIVE' | 'SETTLED' | 'VOID';
  marketId?: string;
  limit?: number;
}

export async function listBattles(filters: BattleFilters = {}) {
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(battles.status, filters.status));
  if (filters.marketId) conditions.push(eq(battles.marketId, filters.marketId));

  const rows = await selectBattles(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(battles.createdAt))
    .limit(Math.min(filters.limit ?? 20, 50));

  return Promise.all(rows.map(withBacking));
}

export async function getBattle(battleId: string) {
  const [row] = await selectBattles(eq(battles.id, battleId));
  if (!row) throw notFound('Battle');
  return withBacking(row);
}

/**
 * Opposing calls on live markets that are not yet paired.
 *
 * Lets the app surface "these two disagree - make it a battle" rather than
 * requiring someone to hand-pick prediction ids. Returns the highest-scoring
 * opponent on each side, because a battle between two unproven accounts is not
 * worth anyone's money.
 */
export async function findBattleCandidates(limit = 10) {
  const upStats = aliasedTable(userStats, 'up_stats');
  const downStats = aliasedTable(userStats, 'down_stats');
  const upPred = aliasedTable(predictions, 'up_pred');
  const downPred = aliasedTable(predictions, 'down_pred');

  return db
    .select({
      marketId: markets.id,
      asset: markets.asset,
      duration: markets.duration,
      closesAt: markets.closesAt,
      upPredictionId: upPred.id,
      upUserId: upPred.userId,
      upScore: upStats.score,
      downPredictionId: downPred.id,
      downUserId: downPred.userId,
      downScore: downStats.score,
    })
    .from(markets)
    .innerJoin(upPred, and(eq(upPred.marketId, markets.id), eq(upPred.direction, 'UP')))
    .innerJoin(downPred, and(eq(downPred.marketId, markets.id), eq(downPred.direction, 'DOWN')))
    .leftJoin(upStats, eq(upStats.userId, upPred.userId))
    .leftJoin(downStats, eq(downStats.userId, downPred.userId))
    .where(
      and(
        eq(markets.status, 'OPEN'),
        // Exclude pairs that are already battling.
        sql`NOT EXISTS (
          SELECT 1 FROM ${battles} b
          WHERE b.prediction_a_id = ${upPred.id} AND b.prediction_b_id = ${downPred.id}
        )`,
      ),
    )
    .orderBy(desc(sql`coalesce(${upStats.score}, 0) + coalesce(${downStats.score}, 0)`))
    .limit(Math.min(limit, 50));
}

// ------------------------------------------------------------------ helpers

function selectBattles(where: SQL | undefined) {
  const upPred = aliasedTable(predictions, 'up_pred');
  const downPred = aliasedTable(predictions, 'down_pred');
  const upUser = aliasedTable(users, 'up_user');
  const downUser = aliasedTable(users, 'down_user');
  const upStats = aliasedTable(userStats, 'up_stats');
  const downStats = aliasedTable(userStats, 'down_stats');

  return db
    .select({
      battle: battles,
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
      up: {
        predictionId: upPred.id,
        entryPriceCents: upPred.entryPriceCents,
        rationale: upPred.rationale,
        status: upPred.status,
        userId: upUser.id,
        username: upUser.username,
        walletAddress: upUser.walletAddress,
        avatarUrl: upUser.avatarUrl,
        score: upStats.score,
        accuracy: upStats.accuracy,
      },
      down: {
        predictionId: downPred.id,
        entryPriceCents: downPred.entryPriceCents,
        rationale: downPred.rationale,
        status: downPred.status,
        userId: downUser.id,
        username: downUser.username,
        walletAddress: downUser.walletAddress,
        avatarUrl: downUser.avatarUrl,
        score: downStats.score,
        accuracy: downStats.accuracy,
      },
    })
    .from(battles)
    .innerJoin(markets, eq(markets.id, battles.marketId))
    .innerJoin(upPred, eq(upPred.id, battles.predictionAId))
    .innerJoin(downPred, eq(downPred.id, battles.predictionBId))
    .innerJoin(upUser, eq(upUser.id, upPred.userId))
    .innerJoin(downUser, eq(downUser.id, downPred.userId))
    .leftJoin(upStats, eq(upStats.userId, upPred.userId))
    .leftJoin(downStats, eq(downStats.userId, downPred.userId))
    .where(where);
}

type BattleRow = Awaited<ReturnType<ReturnType<typeof selectBattles>['execute']>>[number];

/**
 * How much real money has gone behind each side.
 *
 * This is the scoreboard the PRD asks for - positions taken and volume traded -
 * and it is measured from actual filled DreamDEX orders, not from views or
 * likes.
 */
async function withBacking(row: BattleRow) {
  const [side] = await db
    .select({
      upTrades: sql<number>`count(*) FILTER (WHERE ${trades.backedPredictionId} = ${row.up.predictionId})::int`,
      downTrades: sql<number>`count(*) FILTER (WHERE ${trades.backedPredictionId} = ${row.down.predictionId})::int`,
      upVolume: sql<string>`coalesce(sum(${trades.filledQuantity} * ${trades.priceCents} / 100.0)
        FILTER (WHERE ${trades.backedPredictionId} = ${row.up.predictionId}), 0)`,
      downVolume: sql<string>`coalesce(sum(${trades.filledQuantity} * ${trades.priceCents} / 100.0)
        FILTER (WHERE ${trades.backedPredictionId} = ${row.down.predictionId}), 0)`,
      backers: sql<number>`count(DISTINCT ${trades.userId})::int`,
    })
    .from(trades)
    .where(
      and(
        inArray(trades.backedPredictionId, [row.up.predictionId, row.down.predictionId]),
        inArray(trades.status, ['FILLED', 'PARTIALLY_FILLED']),
      ),
    );

  return {
    ...row,
    backing: {
      positionsTaken: (side?.upTrades ?? 0) + (side?.downTrades ?? 0),
      backers: side?.backers ?? 0,
      up: { trades: side?.upTrades ?? 0, volume: side?.upVolume ?? '0' },
      down: { trades: side?.downTrades ?? 0, volume: side?.downVolume ?? '0' },
    },
  };
}
