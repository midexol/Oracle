import { and, asc, desc, eq, inArray, gt, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { markets, marketPriceSnapshots, predictions, users, userSegmentStats } from '../../db/schema/index.js';
import { getDreamDexClient } from '../../dreamdex/index.js';
import type { Asset, DreamDexMarket, Duration } from '../../dreamdex/types.js';
import { notFound } from '../../lib/errors.js';

/**
 * Markets are a local mirror of DreamDEX Event Contracts.
 *
 * Oracle never invents a market. Everything in this table arrives from the
 * exchange via `upsertMarket`, keyed on dreamdexMarketId, so a prediction can
 * always be traced back to a real contract.
 */

export async function upsertMarket(m: DreamDexMarket) {
  const [row] = await db
    .insert(markets)
    .values({
      dreamdexMarketId: m.marketId,
      asset: m.asset,
      duration: m.duration,
      openingReference: m.openingReference,
      closingReference: m.closingReference,
      status: m.status,
      outcome: m.outcome,
      upPriceCents: m.upPriceCents,
      downPriceCents: m.downPriceCents,
      opensAt: new Date(m.opensAt),
      closesAt: new Date(m.closesAt),
      settledAt: m.settledAt ? new Date(m.settledAt) : null,
    })
    .onConflictDoUpdate({
      target: markets.dreamdexMarketId,
      set: {
        status: m.status,
        outcome: m.outcome,
        closingReference: m.closingReference,
        upPriceCents: m.upPriceCents,
        downPriceCents: m.downPriceCents,
        settledAt: m.settledAt ? new Date(m.settledAt) : null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row!;
}

/** Fast path for the quote stream - touches two columns, writes no history. */
export async function updateQuote(
  dreamdexMarketId: string,
  upPriceCents: number,
  downPriceCents: number,
): Promise<string | null> {
  const [row] = await db
    .update(markets)
    .set({ upPriceCents, downPriceCents, updatedAt: new Date() })
    .where(eq(markets.dreamdexMarketId, dreamdexMarketId))
    .returning({ id: markets.id });
  return row?.id ?? null;
}

/**
 * Append a point to the price history behind the market chart.
 *
 * Called on a timer rather than on every quote: the simulator and a live
 * exchange both tick far faster than a chart needs, and writing every tick
 * would turn a nice-to-have chart into the heaviest table in the database.
 */
export async function recordPriceSnapshot(
  marketId: string,
  upPriceCents: number,
  downPriceCents: number,
): Promise<void> {
  await db
    .insert(marketPriceSnapshots)
    .values({ marketId, upPriceCents, downPriceCents })
    .onConflictDoNothing();
}

export interface MarketFilters {
  status?: Array<'OPEN' | 'CLOSED' | 'SETTLED' | 'CANCELLED'>;
  asset?: Asset;
  duration?: Duration;
  limit?: number;
}

export async function listMarkets(filters: MarketFilters = {}) {
  const conditions: SQL[] = [];
  if (filters.status?.length) conditions.push(inArray(markets.status, filters.status));
  if (filters.asset) conditions.push(eq(markets.asset, filters.asset));
  if (filters.duration) conditions.push(eq(markets.duration, filters.duration));

  const rows = await db
    .select({
      market: markets,
      predictionCount: sql<number>`(
        SELECT count(*)::int FROM predictions p WHERE p.market_id = ${markets.id}
      )`,
    })
    .from(markets)
    .where(conditions.length ? and(...conditions) : undefined)
    // Soonest to expire first: an Event Contract with 40 seconds left is the
    // most interesting thing on the page, not the one that just opened.
    .orderBy(asc(markets.closesAt))
    .limit(Math.min(filters.limit ?? 50, 100));

  return rows.map((r) => ({ ...r.market, predictionCount: r.predictionCount }));
}

/** Accepts either Oracle's internal UUID or the DreamDEX market id. */
export async function findMarket(idOrDreamdexId: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrDreamdexId,
  );
  const [row] = await db
    .select()
    .from(markets)
    .where(isUuid ? eq(markets.id, idOrDreamdexId) : eq(markets.dreamdexMarketId, idOrDreamdexId));
  return row ?? null;
}

/**
 * Everything the market page needs, in one round trip: the contract, the live
 * book and tape from DreamDEX, the price history, and - the part that makes
 * this Oracle rather than an exchange UI - who is predicting what, with the
 * track record that makes their call worth reading.
 */
export async function getMarketDetail(idOrDreamdexId: string) {
  const market = await findMarket(idOrDreamdexId);
  if (!market) throw notFound('Market');

  const client = getDreamDexClient();

  const [orderBook, recentTrades, history, calls] = await Promise.all([
    client.getOrderBook(market.dreamdexMarketId).catch(() => null),
    client.getRecentTrades(market.dreamdexMarketId, 25).catch(() => []),
    db
      .select({
        upPriceCents: marketPriceSnapshots.upPriceCents,
        downPriceCents: marketPriceSnapshots.downPriceCents,
        recordedAt: marketPriceSnapshots.recordedAt,
      })
      .from(marketPriceSnapshots)
      .where(eq(marketPriceSnapshots.marketId, market.id))
      .orderBy(asc(marketPriceSnapshots.recordedAt))
      .limit(200),
    getMarketPredictions(market.id, market.asset, market.duration),
  ]);

  const upCalls = calls.filter((c) => c.direction === 'UP').length;

  return {
    market,
    orderBook,
    recentTrades,
    priceHistory: history,
    predictions: calls,
    // "What are people predicting?" summarised, for the headline on the page.
    sentiment: {
      total: calls.length,
      up: upCalls,
      down: calls.length - upCalls,
      upShare: calls.length > 0 ? upCalls / calls.length : null,
    },
  };
}

/**
 * Public calls on one market, each with the predictor's accuracy *on this kind
 * of market*. The segment number is the whole point: "78% on BTC 15M" is
 * persuasive in a way that a lifetime average across every asset is not.
 */
export async function getMarketPredictions(marketId: string, asset: Asset, duration: Duration) {
  return db
    .select({
      id: predictions.id,
      direction: predictions.direction,
      entryPriceCents: predictions.entryPriceCents,
      rationale: predictions.rationale,
      status: predictions.status,
      createdAt: predictions.createdAt,
      user: {
        id: users.id,
        username: users.username,
        walletAddress: users.walletAddress,
        avatarUrl: users.avatarUrl,
      },
      segmentAccuracy: userSegmentStats.accuracy,
      segmentScore: userSegmentStats.score,
      segmentSettled: userSegmentStats.settledPredictions,
    })
    .from(predictions)
    .innerJoin(users, eq(users.id, predictions.userId))
    .leftJoin(
      userSegmentStats,
      and(
        eq(userSegmentStats.userId, predictions.userId),
        eq(userSegmentStats.asset, asset),
        eq(userSegmentStats.duration, duration),
      ),
    )
    .where(eq(predictions.marketId, marketId))
    .orderBy(desc(predictions.createdAt))
    .limit(100);
}

/** Open markets that have not yet expired - the tradeable universe. */
export async function listTradableMarkets() {
  return db
    .select()
    .from(markets)
    .where(and(eq(markets.status, 'OPEN'), gt(markets.closesAt, new Date())))
    .orderBy(asc(markets.closesAt));
}
