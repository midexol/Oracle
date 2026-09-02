import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, db } from '../../db/index.js';
import { markets, predictions, users } from '../../db/schema/index.js';
import { migrateTestDatabase, resetDatabase } from '../../test/db.js';
import { recomputeUserStats } from '../../analytics/reputation.js';
import type { Asset, Direction, Duration } from '../../dreamdex/types.js';
import {
  createCompatPrediction,
  getCompatLeaderboard,
  getCompatPredictionContext,
  getCompatProfile,
  getCompatScoreBreakdown,
} from './service.js';

/**
 * Contract tests for the retired oracle-analytics API.
 *
 * These assert the exact field names, types and SCALES the frontend reads.
 * Scale is the dangerous part: the UI renders `accuracy.toFixed(0)%` and
 * `$${price.toFixed(2)}`, so a fraction where a percentage belongs shows "1%"
 * instead of "74%" and nothing throws. Only a test pinned to the rendering
 * convention catches that.
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

let seq = 0;

async function seedUser(username: string) {
  seq++;
  const [row] = await db
    .insert(users)
    .values({
      walletAddress: `0x${String(seq).padStart(40, 'a')}`,
      username,
    })
    .returning();
  return row!;
}

async function seedSettled(opts: {
  userId: string;
  asset: Asset;
  duration: Duration;
  direction: Direction;
  entryPriceCents: number;
  won: boolean;
  settledAt?: Date;
}) {
  seq++;
  const closesAt = new Date(Date.now() - seq * 60_000);
  const [market] = await db
    .insert(markets)
    .values({
      dreamdexMarketId: `compat-${seq}`,
      asset: opts.asset,
      duration: opts.duration,
      status: 'SETTLED',
      outcome: opts.won ? opts.direction : opts.direction === 'UP' ? 'DOWN' : 'UP',
      opensAt: new Date(closesAt.getTime() - 60_000),
      closesAt,
      settledAt: closesAt,
    })
    .returning();

  const [prediction] = await db
    .insert(predictions)
    .values({
      userId: opts.userId,
      marketId: market!.id,
      direction: opts.direction,
      entryPriceCents: opts.entryPriceCents,
      status: opts.won ? 'WON' : 'LOST',
      settledAt: opts.settledAt ?? closesAt,
    })
    .returning();

  return { market: market!, prediction: prediction! };
}

/** 47-for-63 on BTC 15M, the PRD's worked example. */
async function seedVeteran(username = 'mide') {
  const user = await seedUser(username);
  for (let i = 0; i < 63; i++) {
    await seedSettled({
      userId: user.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 45,
      won: i < 47,
    });
  }
  await recomputeUserStats(user.id);
  return user;
}

describe('GET /users/:wallet/profile', () => {
  it('returns accuracy as a percentage, not a fraction', async () => {
    const user = await seedVeteran();
    const profile = await getCompatProfile(user.walletAddress);

    expect(profile.totalPredictions).toBe(63);
    expect(profile.totalWins).toBe(47);
    expect(profile.totalLosses).toBe(16);

    // 47/63 = 74.6%. As a fraction this would be 0.746 and render as "1%".
    expect(profile.winRate).toBeCloseTo(74.6, 1);
    expect(profile.winRate).toBeGreaterThan(1);
  });

  it('returns a 0-100 prediction score', async () => {
    const user = await seedVeteran();
    const profile = await getCompatProfile(user.walletAddress);
    expect(profile.predictionScore).toBeGreaterThan(0);
    expect(profile.predictionScore).toBeLessThanOrEqual(100);
    // Wilson sits below raw accuracy - that is the point of it.
    expect(profile.predictionScore).toBeLessThan(profile.winRate);
  });

  it('resolves by username as well as wallet', async () => {
    const user = await seedVeteran('alpha');
    const byWallet = await getCompatProfile(user.walletAddress);
    const byName = await getCompatProfile('alpha');
    expect(byName.wallet).toBe(byWallet.wallet);
  });

  it('is case-insensitive on the wallet address', async () => {
    const user = await seedVeteran();
    const upper = await getCompatProfile(user.walletAddress.toUpperCase());
    expect(upper.wallet).toBe(user.walletAddress);
  });

  it('prices history entries in dollars, since the UI renders $x.xx', async () => {
    const user = await seedUser('pricer');
    await seedSettled({
      userId: user.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 43,
      won: true,
    });
    await recomputeUserStats(user.id);

    const profile = await getCompatProfile(user.walletAddress);
    expect(profile.history).toHaveLength(1);
    expect(profile.history[0]!.price).toBeCloseTo(0.43, 6);
    expect(profile.history[0]!.result).toBe('WON');
    expect(profile.history[0]!.dir).toBe('UP');
    expect(profile.history[0]!.market).toBe('BTC 15M');
  });

  it('labels category breakdown as the UI expects and uses percentages', async () => {
    const user = await seedUser('specialist');
    for (const won of [true, true, true, false]) {
      await seedSettled({
        userId: user.id,
        asset: 'ETH',
        duration: '1H',
        direction: 'UP',
        entryPriceCents: 50,
        won,
      });
    }
    await recomputeUserStats(user.id);

    const profile = await getCompatProfile(user.walletAddress);
    const eth = profile.categoryBreakdown.find((c) => c.label === 'ETH 1H');

    expect(eth).toBeDefined();
    expect(eth!.asset).toBe('ETH');
    expect(eth!.duration).toBe('1H');
    expect(eth!.totalPredictions).toBe(4);
    expect(eth!.totalWins).toBe(3);
    expect(eth!.accuracy).toBeCloseTo(75, 6);
  });

  it('returns a coherent profile for a user with no history', async () => {
    const user = await seedUser('newcomer');
    const profile = await getCompatProfile(user.walletAddress);

    expect(profile.totalPredictions).toBe(0);
    expect(profile.totalWins).toBe(0);
    expect(profile.winRate).toBe(0);
    expect(profile.momentumScore).toBe(50);
    expect(profile.categoryBreakdown).toEqual([]);
    expect(profile.history).toEqual([]);
    // Every field the UI reads must be present and non-null.
    expect(profile.predictionScore).not.toBeNull();
    expect(profile.credibleInterval90).toBeDefined();
  });

  it('rejects an unknown wallet with a 404', async () => {
    await expect(getCompatProfile('0xdeadbeef')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('GET /leaderboard', () => {
  it('ranks from 1 and returns percentages', async () => {
    await seedVeteran('veteran');
    const rookie = await seedUser('rookie');
    await seedSettled({
      userId: rookie.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });
    await recomputeUserStats(rookie.id);

    const board = await getCompatLeaderboard({ limit: 10 });

    expect(board[0]!.rank).toBe(1);
    expect(board[1]!.rank).toBe(2);
    // Wilson, not raw accuracy: the 1-for-1 rookie must not outrank 47-for-63.
    expect(board[0]!.username).toBe('veteran');
    expect(board[0]!.accuracy).toBeGreaterThan(1);
    expect(board[0]!.totalPredictions).toBe(63);
  });

  it('never returns a null username or avatar, which the UI would crash on', async () => {
    seq++;
    const [nameless] = await db
      .insert(users)
      .values({ walletAddress: `0x${String(seq).padStart(40, 'b')}` })
      .returning();
    await seedSettled({
      userId: nameless!.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });
    await recomputeUserStats(nameless!.id);

    const [entry] = await getCompatLeaderboard();
    expect(entry!.username).toBeTruthy();
    expect(typeof entry!.avatar).toBe('string');
  });

  it('filters by asset and duration', async () => {
    const btc = await seedUser('btc_only');
    await seedSettled({
      userId: btc.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });
    await recomputeUserStats(btc.id);

    const eth = await seedUser('eth_only');
    await seedSettled({
      userId: eth.id,
      asset: 'ETH',
      duration: '1H',
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });
    await recomputeUserStats(eth.id);

    expect((await getCompatLeaderboard({ asset: 'BTC' })).map((e) => e.username)).toEqual([
      'btc_only',
    ]);
    expect((await getCompatLeaderboard({ duration: '1H' })).map((e) => e.username)).toEqual([
      'eth_only',
    ]);
    // "all" is the old contract's way of saying unfiltered.
    expect(await getCompatLeaderboard({ asset: 'all', duration: 'all' })).toHaveLength(2);
  });

  it('sorts by accuracy when asked', async () => {
    await seedVeteran('veteran');
    const perfect = await seedUser('perfect');
    for (let i = 0; i < 3; i++) {
      await seedSettled({
        userId: perfect.id,
        asset: 'BTC',
        duration: '15M',
        direction: 'UP',
        entryPriceCents: 50,
        won: true,
      });
    }
    await recomputeUserStats(perfect.id);

    const byAccuracy = await getCompatLeaderboard({ sortBy: 'accuracy' });
    expect(byAccuracy[0]!.username).toBe('perfect');

    const byScore = await getCompatLeaderboard({ sortBy: 'prediction_score' });
    expect(byScore[0]!.username).toBe('veteran');
  });

  it('returns an empty array rather than failing on an empty database', async () => {
    expect(await getCompatLeaderboard()).toEqual([]);
  });
});

describe('GET /predictions/:id/context', () => {
  it('states the predictor record on that exact segment', async () => {
    const user = await seedVeteran('mide');
    const { prediction } = await seedSettled({
      userId: user.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 43,
      won: true,
    });
    await recomputeUserStats(user.id);

    const context = await getCompatPredictionContext(prediction.id);

    expect(context.predictionId).toBe(prediction.id);
    expect(context.contextText).toContain('mide');
    expect(context.contextText).toContain('BTC 15M');
    expect(context.stats).not.toBeNull();
    expect(context.stats!.totalPredictions).toBe(64);
    expect(context.stats!.accuracy).toBeGreaterThan(1);
  });

  it('says so plainly when there is no track record', async () => {
    const user = await seedUser('fresh');
    const { prediction } = await seedSettled({
      userId: user.id,
      asset: 'BTC',
      duration: '15M',
      direction: 'UP',
      entryPriceCents: 50,
      won: true,
    });
    // Deliberately not recomputing: no segment row exists.
    const context = await getCompatPredictionContext(prediction.id);
    expect(context.contextText).toContain('no track record');
    expect(context.stats).toBeNull();
  });
});

describe('POST /predictions', () => {
  it('creates the user and market on first use', async () => {
    const created = await createCompatPrediction({
      wallet: '0x00000000000000000000000000000000000000ff',
      marketId: 'BTC-15M-demo',
      asset: 'btc',
      duration: '15m',
      prediction: 'UP',
      entryPrice: 0.43,
      username: 'walker',
    });

    expect(created.direction).toBe('UP');
    // 0.43 dollars becomes 43 cents.
    expect(created.entryPriceCents).toBe(43);
    expect(created.status).toBe('PENDING');

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.walletAddress, '0x00000000000000000000000000000000000000ff'));
    expect(user!.username).toBe('walker');

    const [market] = await db
      .select()
      .from(markets)
      .where(eq(markets.dreamdexMarketId, 'BTC-15M-demo'));
    expect(market!.asset).toBe('BTC');
    expect(market!.duration).toBe('15M');
  });

  it('is idempotent on a repeat call for the same market', async () => {
    const payload = {
      wallet: '0x00000000000000000000000000000000000000ee',
      marketId: 'BTC-15M-repeat',
      asset: 'BTC',
      duration: '15M',
      prediction: 'UP' as const,
      entryPrice: 0.5,
    };

    const first = await createCompatPrediction(payload);
    const second = await createCompatPrediction(payload);

    expect(second.id).toBe(first.id);
    expect(second.replayed).toBe(true);
    expect(first.replayed).toBe(false);
  });

  it('rejects an entry price outside the tradeable range', async () => {
    for (const entryPrice of [0, 1, 1.5, -0.2]) {
      await expect(
        createCompatPrediction({
          wallet: '0x00000000000000000000000000000000000000dd',
          marketId: `bad-${entryPrice}`,
          asset: 'BTC',
          duration: '15M',
          prediction: 'UP',
          entryPrice,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('rejects an unsupported duration', async () => {
    await expect(
      createCompatPrediction({
        wallet: '0x00000000000000000000000000000000000000cc',
        marketId: 'bad-duration',
        asset: 'BTC',
        duration: '7M',
        prediction: 'UP',
        entryPrice: 0.5,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('feeds straight through to the profile it will be read back from', async () => {
    const wallet = '0x00000000000000000000000000000000000000bb';
    await createCompatPrediction({
      wallet,
      marketId: 'BTC-15M-roundtrip',
      asset: 'BTC',
      duration: '15M',
      prediction: 'UP',
      entryPrice: 0.6,
      username: 'roundtrip',
    });

    const profile = await getCompatProfile(wallet);
    // Still PENDING, so it counts toward nothing yet - but the user resolves.
    expect(profile.wallet).toBe(wallet);
    expect(profile.username).toBe('roundtrip');
    expect(profile.totalPredictions).toBe(0);
  });
});

describe('GET /users/:wallet/score-breakdown', () => {
  it('explains the score with no NaN or undefined leaking into the copy', async () => {
    const user = await seedVeteran();
    const explanation = await getCompatScoreBreakdown(user.walletAddress);

    expect(explanation.settled).toBe(63);
    expect(explanation.correct).toBe(47);
    expect(explanation.factors.length).toBeGreaterThan(0);

    for (const factor of explanation.factors) {
      expect(factor.value).not.toMatch(/NaN|undefined/);
      expect(factor.detail).not.toMatch(/NaN|undefined/);
    }
  });

  it('handles a predictor with no settled calls', async () => {
    const user = await seedUser('empty');
    const explanation = await getCompatScoreBreakdown(user.walletAddress);
    expect(explanation.settled).toBe(0);
    expect(explanation.momentum).toBe(50);
  });
});
