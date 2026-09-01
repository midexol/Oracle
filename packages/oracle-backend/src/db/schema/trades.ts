import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { markets } from './markets.js';
import { predictions } from './predictions.js';
import { directionEnum, tradeStatusEnum, tradeSourceEnum } from './enums.js';

/**
 * A real DreamDEX Event Contract order placed through Oracle.
 *
 * Two columns carry the whole pitch:
 *   source            - why this trade happened
 *   backedPredictionId / backedUserId - whose call drove it
 *
 * Together they answer "how much DreamDEX volume did Oracle originate, and
 * which predictors originated it" — the metric that makes Oracle valuable to
 * the exchange rather than merely decorative.
 *
 * filledQuantity and txHash are written by the fill watcher from the on-chain
 * OrderFilled event, which DreamDEX treats as authoritative over the REST
 * trade feed.
 */
export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),

    /** The call this trade backed, if any. */
    backedPredictionId: uuid('backed_prediction_id').references(() => predictions.id, {
      onDelete: 'set null',
    }),
    /** Denormalised for cheap "volume attributed to predictor X" queries. */
    backedUserId: uuid('backed_user_id').references(() => users.id, { onDelete: 'set null' }),

    source: tradeSourceEnum('source').notNull().default('DIRECT'),

    side: directionEnum('side').notNull(),
    priceCents: integer('price_cents').notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 6 }).notNull(),
    filledQuantity: numeric('filled_quantity', { precision: 20, scale: 6 })
      .notNull()
      .default('0'),

    status: tradeStatusEnum('status').notNull().default('PENDING'),

    /**
     * Caller-supplied Idempotency-Key. A retried HTTP request carrying the same
     * key returns the original trade instead of placing a second real,
     * wallet-funded order. Unique across the table, so the database - not the
     * application - is what enforces it under concurrency.
     */
    idempotencyKey: text('idempotency_key').unique(),

    /** Identifiers from the exchange / chain. */
    dreamdexOrderId: text('dreamdex_order_id').unique(),
    txHash: text('tx_hash'),
    /** Set once settlement pays out; negative for a losing position. */
    realizedPnl: numeric('realized_pnl', { precision: 20, scale: 6 }),
    failureReason: text('failure_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    filledAt: timestamp('filled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trades_user_idx').on(t.userId, t.createdAt),
    index('trades_market_idx').on(t.marketId),
    index('trades_backed_user_idx').on(t.backedUserId),
    index('trades_backed_prediction_idx').on(t.backedPredictionId),
    // Fill watcher reconciliation: everything not yet terminal.
    index('trades_status_idx').on(t.status),
  ],
);

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
