import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, db } from '../db/index.js';
import { markets, predictions, trades, userStats, users } from '../db/schema/index.js';
import { migrateTestDatabase, resetDatabase } from '../test/db.js';
import { MockDreamDexClient } from '../dreamdex/mock/client.js';
import { setDreamDexClient } from '../dreamdex/index.js';
import type { DreamDexMarket } from '../dreamdex/types.js';
import { upsertMarket } from '../modules/markets/service.js';
import { createPrediction } from '../modules/predictions/service.js';
import { applyOrderFilled, placeTrade } from '../modules/trades/service.js';
import { resolveMarket, voidMarket } from './resolver.js';
import { backfillMissingPnl, reconcileOpenOrders } from './reconciler.js';

/**
 * End-to-end tests for the loop the whole product rests on:
 *
 *   predict -> back with a real order -> fill -> settle -> reputation moves
 *
 * Run against real Postgres and the real simulator, with no mocking between
 * them, because the failure modes worth catching here are ordering and
 * idempotency bugs that only appear when the actual writes interleave.
 */

const WALLET = '0xAbCdEf0123456789abcdef0123456789ABCdEf01';

let client: MockDreamDexClient;

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  // timeScale 1 keeps markets open for the duration of a test; settlement is
  // driven explicitly rather than by the clock.
  client = new MockDreamDexClient({ timeScale: 1, tickMs: 10_000 });
  setDreamDexClient(client);
  await client.start();
});

afterEach(async () => {
  await client.stop();
  setDreamDexClient(null);
});

async function seedUser(username: string, wallet = WALLET) {
  const [row] = await db
    .insert(users)
    .values({ walletAddress: wallet.toLowerCase(), username })
    .returning();
  await db.insert(userStats).values({ userId: row!.id }).onConflictDoNothing();
  return row!;
}

/** Mirrors one live simulator market into the database. */
async function seedMarketFromClient(): Promise<{ local: typeof markets.$inferSelect; remote: DreamDexMarket }> {
  const remote = (await client.listMarkets()).find((m) => m.status === 'OPEN')!;
  const local = await upsertMarket(remote);
  return { local, remote };
}

/** The mock fills marketable orders on a short timer; wait for it. */
function waitForFill(orderId: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fill timed out')), 10_000);
    const unsubscribe = client.subscribe({
      onOrderFilled: async (event) => {
        if (event.orderId !== orderId) return;
        clearTimeout(timer);
        unsubscribe();
        await applyOrderFilled(event);
        resolve();
      },
    });
  });
}

describe('the full loop', () => {
  it('carries a call from prediction through a real fill to reputation', async () => {
    const predictor = await seedUser('mide');
    const backer = await seedUser('follower', '0x1111111111111111111111111111111111111111');
    const { local, remote } = await seedMarketFromClient();

    // 1. A public call, anchored to the live price.
    const prediction = await createPrediction({
      userId: predictor.id,
      marketId: local.id,
      direction: 'UP',
    });
    expect(prediction.status).toBe('PENDING');
    expect(prediction.entryPriceCents).toBe(local.upPriceCents);

    // 2. Someone backs it with a real order.
    const trade = await placeTrade({
      userId: backer.id,
      walletAddress: '0x1111111111111111111111111111111111111111',
      backedPredictionId: prediction.id,
      amountUsd: '10',
    });

    expect(trade.status).toBe('PENDING');
    expect(trade.side).toBe('UP');
    expect(trade.source).toBe('BACK_PREDICTION');
    // Attribution is the whole point: the order is credited to the predictor.
    expect(trade.backedUserId).toBe(predictor.id);

    // 3. The fill arrives asynchronously, on-chain.
    await waitForFill(trade.dreamdexOrderId!);

    const [filled] = await db.select().from(trades).where(eq(trades.id, trade.id));
    expect(filled!.status).toBe('FILLED');
    expect(filled!.txHash).toMatch(/^0x/);

    // 4. The market settles UP, so the call was right.
    const result = await resolveMarket({ dreamdexMarketId: remote.marketId, outcome: 'UP' });
    expect(result).toMatchObject({ won: 1, lost: 0 });

    const [settled] = await db.select().from(predictions).where(eq(predictions.id, prediction.id));
    expect(settled!.status).toBe('WON');
    expect(settled!.settledAt).not.toBeNull();

    // 5. Reputation reflects it.
    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, predictor.id));
    expect(stats!.settledPredictions).toBe(1);
    expect(stats!.correctPredictions).toBe(1);
    expect(Number(stats!.accuracy)).toBe(1);
    expect(stats!.currentStreak).toBe(1);
    expect(Number(stats!.volumeBacked)).toBeGreaterThan(0);
    expect(stats!.backersCount).toBe(1);

    // 6. The backer's position paid out.
    const [paid] = await db.select().from(trades).where(eq(trades.id, trade.id));
    expect(Number(paid!.realizedPnl)).toBeGreaterThan(0);
  });

  it('records a losing call and pays out nothing', async () => {
    const predictor = await seedUser('alpha');
    const { local, remote } = await seedMarketFromClient();

    const prediction = await createPrediction({
      userId: predictor.id,
      marketId: local.id,
      direction: 'UP',
    });

    await resolveMarket({ dreamdexMarketId: remote.marketId, outcome: 'DOWN' });

    const [settled] = await db.select().from(predictions).where(eq(predictions.id, prediction.id));
    expect(settled!.status).toBe('LOST');

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, predictor.id));
    expect(stats!.correctPredictions).toBe(0);
    expect(stats!.currentStreak).toBe(-1);
  });
});

describe('settlement idempotency', () => {
  it('does not change anything when the same settlement is replayed', async () => {
    const predictor = await seedUser('quantx');
    const { local, remote } = await seedMarketFromClient();
    await createPrediction({ userId: predictor.id, marketId: local.id, direction: 'UP' });

    const first = await resolveMarket({ dreamdexMarketId: remote.marketId, outcome: 'UP' });
    const second = await resolveMarket({ dreamdexMarketId: remote.marketId, outcome: 'UP' });

    expect(first).toMatchObject({ won: 1, lost: 0 });
    // Replay finds nothing still PENDING, so it settles nothing.
    expect(second).toMatchObject({ won: 0, lost: 0 });

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, predictor.id));
    expect(stats!.settledPredictions).toBe(1);

    const receipts = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM prediction_results`,
    );
    expect(Number(receipts[0]!.count)).toBe(1);
  });

  it('returns null for a market Oracle does not mirror', async () => {
    await expect(
      resolveMarket({ dreamdexMarketId: 'not-a-real-market', outcome: 'UP' }),
    ).resolves.toBeNull();
  });

  it('voids calls on a cancelled market instead of counting them as losses', async () => {
    const predictor = await seedUser('novachaser');
    const { local, remote } = await seedMarketFromClient();
    const prediction = await createPrediction({
      userId: predictor.id,
      marketId: local.id,
      direction: 'UP',
    });

    await voidMarket(remote.marketId);

    const [voided] = await db.select().from(predictions).where(eq(predictions.id, prediction.id));
    expect(voided!.status).toBe('VOID');

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, predictor.id));
    expect(stats!.settledPredictions).toBe(0);
    expect(stats!.accuracy).toBeNull();
  });
});

describe('prediction constraints', () => {
  it('refuses a second call on the same market by the same user', async () => {
    const user = await seedUser('doubler');
    const { local } = await seedMarketFromClient();

    await createPrediction({ userId: user.id, marketId: local.id, direction: 'UP' });

    await expect(
      createPrediction({ userId: user.id, marketId: local.id, direction: 'DOWN' }),
    ).rejects.toThrow(/already made a call/i);
  });

  it('refuses a call on a settled market', async () => {
    const user = await seedUser('latecomer');
    const { local, remote } = await seedMarketFromClient();
    await resolveMarket({ dreamdexMarketId: remote.marketId, outcome: 'UP' });

    await expect(
      createPrediction({ userId: user.id, marketId: local.id, direction: 'UP' }),
    ).rejects.toThrow(/no longer accepts calls/i);
  });
});

describe('trade idempotency', () => {
  it('returns the original trade when a request is replayed with the same key', async () => {
    const user = await seedUser('retrier');
    const { local } = await seedMarketFromClient();

    const first = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '10',
      idempotencyKey: 'abc-123',
    });

    const second = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '10',
      idempotencyKey: 'abc-123',
    });

    expect(second.id).toBe(first.id);

    const rows = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM trades`,
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('scopes keys per user, so two users can both use the same key', async () => {
    const a = await seedUser('user_a', '0x2222222222222222222222222222222222222222');
    const b = await seedUser('user_b', '0x3333333333333333333333333333333333333333');
    const { local } = await seedMarketFromClient();

    const tradeA = await placeTrade({
      userId: a.id,
      walletAddress: '0x2222222222222222222222222222222222222222',
      marketId: local.id,
      side: 'UP',
      amountUsd: '5',
      idempotencyKey: 'same-key',
    });
    const tradeB = await placeTrade({
      userId: b.id,
      walletAddress: '0x3333333333333333333333333333333333333333',
      marketId: local.id,
      side: 'UP',
      amountUsd: '5',
      idempotencyKey: 'same-key',
    });

    expect(tradeB.id).not.toBe(tradeA.id);
    expect(tradeB.userId).toBe(b.id);
  });

  it('places two orders when no key is supplied', async () => {
    const user = await seedUser('careless');
    const { local } = await seedMarketFromClient();

    const first = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '5',
    });
    const second = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '5',
    });

    // Documents the cost of omitting the header: a retry is a second position.
    expect(second.id).not.toBe(first.id);
  });

  it('converts a dollar amount into contracts at the live price', async () => {
    const user = await seedUser('spender');
    const { local } = await seedMarketFromClient();

    const trade = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '10',
    });

    const expected = 10 / (local.upPriceCents! / 100);
    expect(Number(trade.quantity)).toBeCloseTo(expected, 4);
  });
});

describe('reconciler', () => {
  it('adopts a fill whose on-chain event was never delivered', async () => {
    const user = await seedUser('unlucky');
    const { local } = await seedMarketFromClient();

    const trade = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '10',
    });

    // Let the exchange fill it, but deliberately do NOT apply the event -
    // this is the dropped-socket / mid-restart case.
    await new Promise((r) => setTimeout(r, 1_500));
    const remoteOrder = await client.getOrder(trade.dreamdexOrderId!);
    expect(remoteOrder!.status).toBe('FILLED');

    const [before] = await db.select().from(trades).where(eq(trades.id, trade.id));
    expect(before!.status).toBe('PENDING');

    // Age the row past the reconciler's grace period.
    await db
      .update(trades)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(trades.id, trade.id));

    const result = await reconcileOpenOrders();
    expect(result.updated).toBe(1);

    const [after] = await db.select().from(trades).where(eq(trades.id, trade.id));
    expect(after!.status).toBe('FILLED');
    expect(after!.txHash).toMatch(/^0x/);
  });

  it('leaves an order inside the grace period alone', async () => {
    const user = await seedUser('fresh');
    const { local } = await seedMarketFromClient();

    await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '10',
    });

    const result = await reconcileOpenOrders();
    expect(result.checked).toBe(0);
  });

  it('backfills PnL for a position filled after its market settled', async () => {
    const user = await seedUser('straggler');
    const { local, remote } = await seedMarketFromClient();

    const trade = await placeTrade({
      userId: user.id,
      walletAddress: WALLET,
      marketId: local.id,
      side: 'UP',
      amountUsd: '10',
    });
    await waitForFill(trade.dreamdexOrderId!);

    // Settle first, then clear PnL to simulate a fill that landed too late for
    // the settlement pass to see.
    await resolveMarket({ dreamdexMarketId: remote.marketId, outcome: 'UP' });
    await db.update(trades).set({ realizedPnl: null }).where(eq(trades.id, trade.id));

    const repaired = await backfillMissingPnl();
    expect(repaired).toBe(1);

    const [row] = await db.select().from(trades).where(eq(trades.id, trade.id));
    expect(Number(row!.realizedPnl)).toBeGreaterThan(0);
  });
});
