import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { assetEnum, durationEnum, directionEnum, marketStatusEnum } from './enums.js';

/**
 * A local mirror of a DreamDEX Event Contract.
 *
 * Oracle never invents markets — every row here corresponds to a real
 * contract on DreamDEX, keyed by dreamdexMarketId. We cache the last known
 * prices so the feed can render instantly without hitting the exchange
 * once per card.
 *
 * Prices are integer cents (1..99) to match how Event Contracts are quoted
 * and to keep arithmetic exact. upPriceCents + downPriceCents ~= 100.
 */
export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dreamdexMarketId: text('dreamdex_market_id').notNull().unique(),

    asset: assetEnum('asset').notNull(),
    duration: durationEnum('duration').notNull(),

    /** Strike/reference price the contract settles against. */
    openingReference: numeric('opening_reference', { precision: 24, scale: 8 }),
    closingReference: numeric('closing_reference', { precision: 24, scale: 8 }),

    status: marketStatusEnum('status').notNull().default('OPEN'),
    /** Populated only once status = SETTLED. */
    outcome: directionEnum('outcome'),

    /** Last seen quote, refreshed by the market sync job. */
    upPriceCents: integer('up_price_cents'),
    downPriceCents: integer('down_price_cents'),

    opensAt: timestamp('opens_at', { withTimezone: true }).notNull(),
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The feed's hot query: open markets, soonest close first.
    index('markets_status_closes_at_idx').on(t.status, t.closesAt),
    // Powers "BTC 15M" segment lookups used by the analytics engine.
    index('markets_asset_duration_idx').on(t.asset, t.duration),
    index('markets_closes_at_idx').on(t.closesAt),
  ],
);

/**
 * Time series of quotes, written by the market sync job.
 * Backs the price chart on the market page and lets us reconstruct what a
 * market looked like at the moment a prediction was made.
 */
export const marketPriceSnapshots = pgTable(
  'market_price_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),
    upPriceCents: integer('up_price_cents').notNull(),
    downPriceCents: integer('down_price_cents').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('market_snapshots_market_time_idx').on(t.marketId, t.recordedAt),
  ],
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type MarketPriceSnapshot = typeof marketPriceSnapshots.$inferSelect;
