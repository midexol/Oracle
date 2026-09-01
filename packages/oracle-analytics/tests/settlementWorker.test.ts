import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementWorker } from '../src/workers/settlementWorker.js';

// --- Minimal in-memory fake of the slice of PrismaClient we use ------------
// This keeps the worker's unit tests fast and DB-free, while still
// exercising the real control flow (transaction -> query -> update -> upsert).

interface FakePrediction {
  id: string;
  userId: string;
  marketId: string;
  asset: string;
  duration: string;
  prediction: 'UP' | 'DOWN';
  entryPrice: number;
  status: 'PENDING' | 'RESOLVED';
  result: 'WON' | 'LOST' | 'CANCELLED' | null;
  resolvedAt: Date | null;
}

function createFakePrisma(seedPredictions: FakePrediction[]) {
  const predictions = new Map(seedPredictions.map((p) => [p.id, { ...p }]));
  const analytics = new Map<string, { totalPredictions: number; totalWins: number; totalLosses: number; accuracy: number; predictionScore: number; scoreSum: number }>();
  const categoryStats = new Map<string, { totalPredictions: number; totalWins: number; accuracy: number; scoreSum: number; categoryScore: number }>();

  const tx = {
    prediction: {
      findMany: async ({ where }: { where: { marketId: string; status: string } }) =>
        Array.from(predictions.values()).filter(
          (p) => p.marketId === where.marketId && p.status === where.status,
        ),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakePrediction> }) => {
        const existing = predictions.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data } as FakePrediction;
        predictions.set(where.id, updated);
        return updated;
      },
    },
    userAnalytics: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        analytics.get(where.userId) ? { userId: where.userId, ...analytics.get(where.userId)! } : null,
      upsert: async ({ where, create, update }: any) => {
        const key = where.userId;
        const value = analytics.has(key) ? { ...analytics.get(key)!, ...update } : create;
        analytics.set(key, value);
        return { userId: key, ...value };
      },
    },
    userCategoryStats: {
      findUnique: async ({ where }: any) => {
        const key = `${where.userId_asset_duration.userId}:${where.userId_asset_duration.asset}:${where.userId_asset_duration.duration}`;
        return categoryStats.has(key) ? { id: key, ...categoryStats.get(key)! } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.userId_asset_duration.userId}:${where.userId_asset_duration.asset}:${where.userId_asset_duration.duration}`;
        const value = categoryStats.has(key) ? { ...categoryStats.get(key)!, ...update } : create;
        categoryStats.set(key, value);
        return { id: key, ...value };
      },
    },
  };

  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    _internal: { predictions, analytics, categoryStats },
  } as any;
}

describe('SettlementWorker.resolveMarket', () => {
  let fakePrisma: ReturnType<typeof createFakePrisma>;

  beforeEach(() => {
    fakePrisma = createFakePrisma([
      {
        id: 'p1',
        userId: 'user-1',
        marketId: 'market-A',
        asset: 'BTC',
        duration: '15M',
        prediction: 'UP',
        entryPrice: 0.43,
        status: 'PENDING',
        result: null,
        resolvedAt: null,
      },
      {
        id: 'p2',
        userId: 'user-2',
        marketId: 'market-A',
        asset: 'BTC',
        duration: '15M',
        prediction: 'DOWN',
        entryPrice: 0.6,
        status: 'PENDING',
        result: null,
        resolvedAt: null,
      },
      {
        id: 'p3',
        userId: 'user-3',
        marketId: 'market-B',
        asset: 'ETH',
        duration: '1H',
        prediction: 'UP',
        entryPrice: 0.5,
        status: 'PENDING',
        result: null,
        resolvedAt: null,
      },
    ]);
  });

  it('resolves only PENDING predictions for the given market', async () => {
    const worker = new SettlementWorker(fakePrisma);
    const summary = await worker.resolveMarket('market-A', 'UP');

    expect(summary.resolvedCount).toBe(2);
    expect(summary.winners).toBe(1);
    expect(summary.losers).toBe(1);

    const p1 = fakePrisma._internal.predictions.get('p1');
    const p2 = fakePrisma._internal.predictions.get('p2');
    const p3 = fakePrisma._internal.predictions.get('p3');

    expect(p1.status).toBe('RESOLVED');
    expect(p1.result).toBe('WON');
    expect(p2.status).toBe('RESOLVED');
    expect(p2.result).toBe('LOST');
    // Untouched — different market
    expect(p3.status).toBe('PENDING');
  });

  it('updates UserAnalytics for every affected user', async () => {
    const worker = new SettlementWorker(fakePrisma);
    await worker.resolveMarket('market-A', 'UP');

    const user1Stats = fakePrisma._internal.analytics.get('user-1');
    const user2Stats = fakePrisma._internal.analytics.get('user-2');

    expect(user1Stats.totalWins).toBe(1);
    expect(user1Stats.totalPredictions).toBe(1);
    expect(user2Stats.totalLosses).toBe(1);
  });

  it('returns a zero-count summary for a market with no pending predictions', async () => {
    const worker = new SettlementWorker(fakePrisma);
    const summary = await worker.resolveMarket('market-nonexistent', 'DOWN');
    expect(summary.resolvedCount).toBe(0);
    expect(summary.winners).toBe(0);
    expect(summary.losers).toBe(0);
  });

  it('throws if marketId is empty', async () => {
    const worker = new SettlementWorker(fakePrisma);
    await expect(worker.resolveMarket('', 'UP')).rejects.toThrow();
  });
});

describe('SettlementWorker.voidMarket', () => {
  let fakePrisma: ReturnType<typeof createFakePrisma>;

  beforeEach(() => {
    fakePrisma = createFakePrisma([
      {
        id: 'p1',
        userId: 'user-1',
        marketId: 'market-A',
        asset: 'BTC',
        duration: '15M',
        prediction: 'UP',
        entryPrice: 0.43,
        status: 'PENDING',
        result: null,
        resolvedAt: null,
      },
      {
        id: 'p2',
        userId: 'user-2',
        marketId: 'market-B',
        asset: 'ETH',
        duration: '1H',
        prediction: 'DOWN',
        entryPrice: 0.6,
        status: 'PENDING',
        result: null,
        resolvedAt: null,
      },
    ]);
  });

  it('marks only PENDING predictions for the voided market as CANCELLED', async () => {
    const worker = new SettlementWorker(fakePrisma);
    const summary = await worker.voidMarket('market-A');

    expect(summary.voidedCount).toBe(1);

    const p1 = fakePrisma._internal.predictions.get('p1');
    const p2 = fakePrisma._internal.predictions.get('p2');

    expect(p1.status).toBe('RESOLVED');
    expect(p1.result).toBe('CANCELLED');
    // Untouched — different market
    expect(p2.status).toBe('PENDING');
  });

  it('does not record a win or loss for a voided prediction', async () => {
    const worker = new SettlementWorker(fakePrisma);
    await worker.voidMarket('market-A');

    expect(fakePrisma._internal.analytics.get('user-1')).toBeUndefined();
  });

  it('throws if marketId is empty', async () => {
    const worker = new SettlementWorker(fakePrisma);
    await expect(worker.voidMarket('')).rejects.toThrow();
  });
});
