import { afterEach, describe, expect, it } from 'vitest';
import { MockDreamDexClient } from './client.js';
import { upProbability, probabilityToCents, normalCdf } from './pricing.js';
import type { MarketSettledEvent, OrderFilledEvent } from '../types.js';

/**
 * The simulator is not a stub - the whole backend is developed and demoed
 * against it, so its lifecycle guarantees are worth asserting. If it stops
 * settling markets or stops emitting fills, every downstream feature quietly
 * stops working too.
 */

const clients: MockDreamDexClient[] = [];

const makeClient = (timeScale: number) => {
  const c = new MockDreamDexClient({ timeScale, tickMs: 50, settlementDelaySeconds: 0.2 });
  clients.push(c);
  return c;
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.stop()));
});

const waitFor = <T>(register: (resolve: (v: T) => void) => void, ms = 15_000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    register((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });

describe('pricing', () => {
  it('prices a coin-flip at 50c', () => {
    expect(probabilityToCents(normalCdf(0))).toBe(50);
  });

  it('converges toward certainty as expiry approaches', () => {
    // Spot above strike, shrinking time left.
    const far = upProbability(101, 100, 3600, 0.6);
    const near = upProbability(101, 100, 10, 0.6);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.95);
  });

  it('never quotes 0 or 100', () => {
    expect(probabilityToCents(0)).toBe(1);
    expect(probabilityToCents(1)).toBe(99);
  });
});

describe('MockDreamDexClient', () => {
  it('opens a market for every contract series on start', async () => {
    const client = makeClient(1);
    await client.start();

    const markets = await client.listMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(6);
    expect(markets.every((m) => m.status === 'OPEN')).toBe(true);
    expect(markets.every((m) => m.upPriceCents + m.downPriceCents === 100)).toBe(true);
  });

  it('quotes a two-sided book around the current price', async () => {
    const client = makeClient(1);
    await client.start();
    const [market] = await client.listMarkets();

    const book = await client.getOrderBook(market!.marketId);
    expect(book).not.toBeNull();
    expect(book!.bids.length).toBeGreaterThan(0);
    expect(book!.asks.length).toBeGreaterThan(0);
    // Best bid below best ask, and everything inside the tradeable range.
    expect(book!.bids[0]!.priceCents).toBeLessThan(book!.asks[0]!.priceCents);
    for (const level of [...book!.bids, ...book!.asks]) {
      expect(level.priceCents).toBeGreaterThanOrEqual(1);
      expect(level.priceCents).toBeLessThanOrEqual(99);
    }
  });

  it('accepts an order as PENDING and fills it asynchronously on-chain', async () => {
    const client = makeClient(1);
    await client.start();
    const [market] = await client.listMarkets();

    const fillPromise = waitFor<OrderFilledEvent>((resolve) => {
      client.subscribe({ onOrderFilled: resolve });
    });

    const result = await client.placeOrder({
      marketId: market!.marketId,
      side: 'UP',
      quantity: '10',
      walletAddress: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
      clientOrderId: 'client-1',
    });

    // The exchange acknowledges before it fills - the backend must not assume
    // placeOrder returns a completed trade.
    expect(result.status).toBe('PENDING');
    expect(result.orderId).toMatch(/^dx_/);

    const fill = await fillPromise;
    expect(fill.orderId).toBe(result.orderId);
    expect(fill.quantity).toBe('10');
    expect(fill.txHash).toMatch(/^0x[0-9a-f]+$/);
    expect(fill.walletAddress).toBe('0xabcdef0123456789abcdef0123456789abcdef01');

    const settledOrder = await client.getOrder(result.orderId);
    expect(settledOrder!.status).toBe('FILLED');
  });

  it('is idempotent on clientOrderId, so a retry cannot double-spend', async () => {
    const client = makeClient(1);
    await client.start();
    const [market] = await client.listMarkets();

    const req = {
      marketId: market!.marketId,
      side: 'UP' as const,
      quantity: '5',
      walletAddress: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
      clientOrderId: 'retried-order',
    };

    const first = await client.placeOrder(req);
    const second = await client.placeOrder(req);

    expect(second.orderId).toBe(first.orderId);
  });

  it('rejects an order on an unknown market instead of throwing', async () => {
    const client = makeClient(1);
    await client.start();

    const result = await client.placeOrder({
      marketId: 'does-not-exist',
      side: 'UP',
      quantity: '1',
      walletAddress: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
      clientOrderId: 'bad-market',
    });

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('Unknown market');
  });

  it('settles a market with an outcome and rolls the series forward', async () => {
    // 1M contract at 2000x settles in ~30ms of wall clock.
    const client = makeClient(2000);

    const settledPromise = waitFor<MarketSettledEvent>((resolve) => {
      client.subscribe({ onMarketSettled: resolve });
    });

    await client.start();
    const settled = await settledPromise;

    expect(['UP', 'DOWN']).toContain(settled.outcome);

    const market = await client.getMarket(settled.marketId);
    expect(market!.status).toBe('SETTLED');
    expect(market!.outcome).toBe(settled.outcome);
    // A settled contract is worth 100c on the winning side.
    expect(market!.upPriceCents).toBe(settled.outcome === 'UP' ? 99 : 1);
    expect(market!.closingReference).not.toBeNull();

    // The series must not run dry: a replacement contract opens.
    const open = (await client.listMarkets()).filter(
      (m) => m.status === 'OPEN' && m.asset === market!.asset && m.duration === market!.duration,
    );
    expect(open.length).toBeGreaterThan(0);
  });

  it('refuses orders once a market is no longer open', async () => {
    const client = makeClient(2000);

    const settledPromise = waitFor<MarketSettledEvent>((resolve) => {
      client.subscribe({ onMarketSettled: resolve });
    });

    await client.start();
    const settled = await settledPromise;

    const result = await client.placeOrder({
      marketId: settled.marketId,
      side: 'UP',
      quantity: '1',
      walletAddress: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
      clientOrderId: 'too-late',
    });

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toContain('SETTLED');
  });

  it('stops cleanly and reports disconnection', async () => {
    const client = makeClient(1);
    await client.start();
    expect(client.isConnected()).toBe(true);
    await client.stop();
    expect(client.isConnected()).toBe(false);
  });
});
