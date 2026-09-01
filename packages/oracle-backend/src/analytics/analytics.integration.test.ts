import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, db } from '../db/index.js';
import { markets, predictions, trades, users } from '../db/schema/index.js';
import { migrateTestDatabase, resetDatabase } from '../test/db.js';
import { getLeaderboard, getUserRank, getVolumeLeaderboard, wilsonSql } from './leaderboard.js';
import { recomputeUserStats } from './reputation.js';
import { computeReputation, wilsonLowerBound } from './scoring.js';
import type { Asset, Direction, Duration } from '../dreamdex/types.js';

/**
 * Integration tests for the analytics engine.
 *
 * The unit tests prove the TypeScript scoring model is right. These prove the
 * SQL agrees with it and actually executes - which is where the real risk sits,
 * because a wrong aggregate produces a plausible number rather than an error.
 */

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

let marketCounter = 0;

async function makeUser(username: string) {
  const [row] = await db
    .insert(users)
    .values({
      walletAddress: `0x${username.padEnd(40, '0').slice(0, 40)}`,
      username,
    })
    .returning();
  return row!;
}

async function makeSettledMarket(asset: Asset, duration: Duration, outcome: Direction) {
  marketCounter++;
  const closesAt = new Date(Date.now() - marketCounter * 60_000);
  const [row] = await db
    .insert(markets)
    .values({
      dreamdexMarketId: `test-${asset}-${duration}-${marketCounter}`,
      asset,
      duration,
      status: 'SETTLED',
      outcome,
      opensAt: new Date(closesAt.getTime() - 60_000),
      closesAt,
      settledAt: closesAt,
    })
    .returning();
  return row!;
}

/** Records a settled call directly, bypassing the API. */
async function makeSettledPrediction(opts: {
  userId: string;
  marketId: string;
  direction: Direction;
  entryPriceCents: number;
  won: boolean;
}) {
  const settledAt = new Date();
  const [row] = await db
    .insert(predictions)
    .values({
      userId: opts.userId,
      marketId: opts.marketId,
      direction: opts.direction,
      entryPriceCents: opts.entryPriceCents,
      status: opts.won ? 'WON' : 'LOST',
      settledAt,
    })
    .returning();
  return row!;
}

describe('Wilson score: SQL vs TypeScript', () => {
  /**
   * The one test that matters most in this file.
   *
   * The score is implemented twice - once in TS for profiles, once in SQL for
   * the leaderboard. If they drift, a user's profile and their rank disagree
   * and nothing errors. This pins them together.
   */
  it('agrees to 6 decimal places across a grid of records', async () => {
    const grid: Array<[number, number]> = [
      [0, 1],
      [1, 1],
      [2, 2],
      [3, 4],
      [7, 10],
      [8, 10],
      [47, 63],
      [52, 76],
      [91, 118],
      [700, 1000],
      [0, 25],
      [25, 25],
    ];

    const values = sql.join(
      grid.map(([c, n]) => sql`(${sql.raw(String(c))}::bigint, ${sql.raw(String(n))}::bigint)`),
      sql`, `,
    );

    const rows = await db.execute<{ c: string; n: string; w: string }>(sql`
      SELECT c, n, ${wilsonSql(sql`c`, sql`n`)} AS w
      FROM (VALUES ${values}) AS t(c, n)
    `);

    expect(rows.length).toBe(grid.length);

    for (const row of rows) {
      const c = Number(row.c);
      const n = Number(row.n);
      expect(Number(row.w)).toBeCloseTo(wilsonLowerBound(c, n), 6);
    }
  });
});

describe('recomputeUserStats', () => {
  it('derives the same metrics the pure scoring model does', async () => {
    const user = await makeUser('mide');
    const m1 = await makeSettledMarket('BTC', '15M', 'UP');
    const m2 = await makeSettledMarket('BTC', '15M', 'DOWN');
    const m3 = await makeSettledMarket('ETH', '1H', 'UP');

    const calls = [
      { market: m1, direction: 'UP' as const, entryPriceCents: 40, won: true },
      { market: m2, direction: 'UP' as const, entryPriceCents: 60, won: false },
      { market: m3, direction: 'UP' as const, entryPriceCents: 30, won: true },
    ];

    for (const c of calls) {
      await makeSettledPrediction({
        userId: user.id,
        marketId: c.market.id,
        direction: c.direction,
        entryPriceCents: c.entryPriceCents,
        won: c.won,
      });
    }

    const result = await recomputeUserStats(user.id);

    const expected = computeReputation(
      calls.map((c) => ({
        won: c.won,
        entryPriceCents: c.entryPriceCents,
        settledAt: new Date(),
      })),
    );

    expect(result.overall.settled).toBe(3);
    expect(result.overall.correct).toBe(2);
    expect(result.overall.score).toBe(expected.score);
    expect(result.overall.accuracy).toBeCloseTo(expected.accuracy!, 6);
    expect(result.overall.edge).toBeCloseTo(expected.edge!, 6);
    expect(result.overall.roi).toBeCloseTo(expected.roi!, 6);
  });

  it('splits reputation by asset and duration', async () => {
    const user = await makeUser('alpha');

    // 2/2 on BTC 15M, 0/1 on ETH 1H.
    for (const won of [true, true]) {
      const m = await makeSettledMarket('BTC', '15M', 'UP');
      await makeSettledPrediction({
        userId: user.id,
        marketId: m.id,
        direction: 'UP',
        entryPriceCents: 45,
        won,
      });
    }
    const eth = await makeSettledMarket('ETH', '1H', 'DOWN');
    await makeSettledPrediction({
      userId: user.id,
      marketId: eth.id,
      direction: 'UP',
      entryPriceCents: 50,
      won: false,
    });

    const { segments } = await recomputeUserStats(user.id);

    const btc = segments.find((s) => s.asset === 'BTC' && s.duration === '15M');
    const ethSeg = segments.find((s) => s.asset === 'ETH' && s.duration === '1H');

    expect(btc?.metrics.accuracy).toBe(1);
    expect(btc?.metrics.settled).toBe(2);
    expect(ethSeg?.metrics.accuracy).toBe(0);
  });

  it('excludes VOID predictions so a cancelled market harms nobody', async () => {
    const user = await makeUser('novachaser');
    const won = await makeSettledMarket('BTC', '15M', 'UP');
    await makeSettledPrediction({
      userId: user.id,
      marketId: won.id,
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });

    const cancelled = await makeSettledMarket('BTC', '15M', 'DOWN');
    await db.insert(predictions).values({
      userId: user.id,
      marketId: cancelled.id,
      direction: 'UP',
      entryPriceCents: 50,
      status: 'VOID',
      settledAt: new Date(),
    });

    const { overall } = await recomputeUserStats(user.id);
    expect(overall.settled).toBe(1);
    expect(overall.accuracy).toBe(1);
  });

  it('is idempotent - running twice does not double-count', async () => {
    const user = await makeUser('quantx');
    const m = await makeSettledMarket('BTC', '15M', 'UP');
    await makeSettledPrediction({
      userId: user.id,
      marketId: m.id,
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });

    const first = await recomputeUserStats(user.id);
    const second = await recomputeUserStats(user.id);

    expect(second.overall).toEqual(first.overall);
    expect(second.segments.length).toBe(first.segments.length);
  });
});

describe('leaderboard SQL', () => {
  /** Builds a user with an exact record so ordering is deterministic. */
  async function seedPredictor(
    username: string,
    record: { correct: number; total: number; entryPriceCents: number },
    segment: { asset: Asset; duration: Duration } = { asset: 'BTC', duration: '15M' },
  ) {
    const user = await makeUser(username);
    for (let i = 0; i < record.total; i++) {
      const m = await makeSettledMarket(segment.asset, segment.duration, 'UP');
      await makeSettledPrediction({
        userId: user.id,
        marketId: m.id,
        direction: 'UP',
        entryPriceCents: record.entryPriceCents,
        won: i < record.correct,
      });
    }
    await recomputeUserStats(user.id);
    return user;
  }

  it('ranks by Wilson score, not raw accuracy', async () => {
    await seedPredictor('rookie', { correct: 2, total: 2, entryPriceCents: 50 });
    await seedPredictor('veteran', { correct: 47, total: 63, entryPriceCents: 50 });

    const board = await getLeaderboard();

    expect(board[0]?.username).toBe('veteran');
    expect(board[1]?.username).toBe('rookie');
    // Raw accuracy would have put the rookie first.
    expect(board[1]!.accuracy).toBeGreaterThan(board[0]!.accuracy);
  });

  it('matches the TypeScript score exactly for each entry', async () => {
    await seedPredictor('a', { correct: 7, total: 10, entryPriceCents: 50 });
    await seedPredictor('b', { correct: 12, total: 20, entryPriceCents: 50 });

    for (const entry of await getLeaderboard()) {
      const expected = Math.round(
        100 * wilsonLowerBound(entry.correctPredictions, entry.settledPredictions),
      );
      expect(entry.score).toBe(expected);
    }
  });

  it('separates accuracy from edge', async () => {
    // Same record; one only ever backed heavy favourites.
    await seedPredictor('favourite_backer', { correct: 8, total: 10, entryPriceCents: 90 });
    await seedPredictor('contrarian', { correct: 8, total: 10, entryPriceCents: 30 });

    const byEdge = await getLeaderboard({ sort: 'edge' });
    expect(byEdge[0]?.username).toBe('contrarian');

    const backer = byEdge.find((e) => e.username === 'favourite_backer')!;
    const contrarian = byEdge.find((e) => e.username === 'contrarian')!;

    expect(contrarian.edge).toBeGreaterThan(backer.edge);
    expect(contrarian.roi).toBeGreaterThan(backer.roi);
    // 8/10 at 30c: cost 300, profit 8*70 - 2*30 = 500 => +166.7%
    expect(contrarian.roi).toBeCloseTo((500 / 300) * 100, 4);
    expect(backer.edge).toBeLessThan(0);
  });

  it('filters by asset and duration', async () => {
    await seedPredictor('btc_only', { correct: 9, total: 10, entryPriceCents: 50 }, {
      asset: 'BTC',
      duration: '15M',
    });
    await seedPredictor('eth_only', { correct: 9, total: 10, entryPriceCents: 50 }, {
      asset: 'ETH',
      duration: '1H',
    });

    const btc = await getLeaderboard({ asset: 'BTC' });
    expect(btc.map((e) => e.username)).toEqual(['btc_only']);

    const oneHour = await getLeaderboard({ duration: '1H' });
    expect(oneHour.map((e) => e.username)).toEqual(['eth_only']);

    expect((await getLeaderboard()).length).toBe(2);
  });

  it('honours minPredictions', async () => {
    await seedPredictor('thin', { correct: 1, total: 1, entryPriceCents: 50 });
    await seedPredictor('thick', { correct: 6, total: 10, entryPriceCents: 50 });

    const filtered = await getLeaderboard({ minPredictions: 5 });
    expect(filtered.map((e) => e.username)).toEqual(['thick']);
  });

  it('paginates with stable ranks', async () => {
    await seedPredictor('p1', { correct: 20, total: 20, entryPriceCents: 50 });
    await seedPredictor('p2', { correct: 15, total: 20, entryPriceCents: 50 });
    await seedPredictor('p3', { correct: 10, total: 20, entryPriceCents: 50 });

    const page1 = await getLeaderboard({ limit: 2 });
    const page2 = await getLeaderboard({ limit: 2, offset: 2 });

    expect(page1.map((e) => e.rank)).toEqual([1, 2]);
    expect(page2.map((e) => e.rank)).toEqual([3]);
    expect(page1[0]!.username).toBe('p1');
    expect(page2[0]!.username).toBe('p3');
  });

  it('returns an empty board rather than failing when there is no history', async () => {
    await makeUser('silent');
    expect(await getLeaderboard()).toEqual([]);
  });

  describe('getUserRank', () => {
    it('reports the user position and field size', async () => {
      const top = await seedPredictor('top', { correct: 20, total: 20, entryPriceCents: 50 });
      const mid = await seedPredictor('mid', { correct: 12, total: 20, entryPriceCents: 50 });

      await expect(getUserRank(top.id)).resolves.toEqual({ rank: 1, total: 2 });
      await expect(getUserRank(mid.id)).resolves.toEqual({ rank: 2, total: 2 });
    });

    it('returns null for a user with no settled calls', async () => {
      const ghost = await makeUser('ghost');
      await expect(getUserRank(ghost.id)).resolves.toBeNull();
    });
  });
});

describe('attribution', () => {
  it('credits originated volume to the predictor whose call was backed', async () => {
    const predictor = await makeUser('influencer');
    const backer = await makeUser('follower');

    const market = await makeSettledMarket('BTC', '15M', 'UP');
    const call = await makeSettledPrediction({
      userId: predictor.id,
      marketId: market.id,
      direction: 'UP',
      entryPriceCents: 40,
      won: true,
    });

    await db.insert(trades).values({
      userId: backer.id,
      marketId: market.id,
      backedPredictionId: call.id,
      backedUserId: predictor.id,
      source: 'BACK_PREDICTION',
      side: 'UP',
      priceCents: 40,
      quantity: '25',
      filledQuantity: '25',
      status: 'FILLED',
      dreamdexOrderId: 'dx_test_1',
    });

    const board = await getVolumeLeaderboard();
    expect(board).toHaveLength(1);
    // 25 contracts at 40c = $10 notional.
    expect(board[0]!.volumeBacked).toBeCloseTo(10, 6);
    expect(board[0]!.backersCount).toBe(1);
    expect(board[0]!.username).toBe('influencer');

    const { overall: _o } = await recomputeUserStats(predictor.id);
    const [stats] = await db.execute<{ volume_backed: string; backers_count: number }>(sql`
      SELECT volume_backed, backers_count FROM user_stats WHERE user_id = ${predictor.id}
    `);
    expect(Number(stats!.volume_backed)).toBeCloseTo(10, 6);
    expect(Number(stats!.backers_count)).toBe(1);
  });

  it('ignores unfilled orders when counting volume', async () => {
    const predictor = await makeUser('quiet');
    const backer = await makeUser('hesitant');
    const market = await makeSettledMarket('BTC', '15M', 'UP');
    const call = await makeSettledPrediction({
      userId: predictor.id,
      marketId: market.id,
      direction: 'UP',
      entryPriceCents: 40,
      won: true,
    });

    await db.insert(trades).values({
      userId: backer.id,
      marketId: market.id,
      backedPredictionId: call.id,
      backedUserId: predictor.id,
      source: 'BACK_PREDICTION',
      side: 'UP',
      priceCents: 40,
      quantity: '25',
      filledQuantity: '0',
      status: 'PENDING',
    });

    expect(await getVolumeLeaderboard()).toEqual([]);
  });
});
