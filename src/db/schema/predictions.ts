import {
  pgTable,
  uuid,
  timestamp,
  integer,
  numeric,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { markets } from './markets.js';
import { directionEnum, predictionStatusEnum } from './enums.js';

/**
 * A public call on an Event Contract. This is the social object of Oracle —
 * everything in the feed, on profiles and on the leaderboard derives from it.
 *
 * entryPriceCents is the market's price for the SIDE THE USER CHOSE at the
 * moment they called it. It is the single most important analytics column:
 * calling UP at 43c and being right is a harder, more valuable call than
 * calling UP at 85c. The reputation engine uses it for difficulty-adjusted
 * scoring (see src/analytics/scoring.ts).
 */
export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),

    direction: directionEnum('direction').notNull(),

    /** Price in cents of the chosen side when the call was made (1..99). */
    entryPriceCents: integer('entry_price_cents').notNull(),

    /** Optional conviction stake, in quote units. Not required to predict. */
    stake: numeric('stake', { precision: 20, scale: 6 }),

    /** Optional short rationale shown on the prediction detail page. */
    rationale: text('rationale'),

    status: predictionStatusEnum('status').notNull().default('PENDING'),
    settledAt: timestamp('settled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One public call per user per market: a predictor cannot hedge both
    // sides and claim a win either way. This constraint is what makes the
    // track record trustworthy.
    uniqueIndex('predictions_user_market_key').on(t.userId, t.marketId),
    // Feed: newest calls first.
    index('predictions_created_at_idx').on(t.createdAt),
    // Profile + reputation recompute.
    index('predictions_user_status_idx').on(t.userId, t.status),
    // Resolver: find everything still pending on a market being settled.
    index('predictions_market_status_idx').on(t.marketId, t.status),
  ],
);

/**
 * Immutable settlement ledger. predictions.status is the mutable current
 * state; this table is the append-only record of how it got there, which is
 * what a shareable prediction receipt renders from.
 */
export const predictionResults = pgTable(
  'prediction_results',
  {
    predictionId: uuid('prediction_id')
      .primaryKey()
      .references(() => predictions.id, { onDelete: 'cascade' }),
    result: predictionStatusEnum('result').notNull(),
    marketOutcome: directionEnum('market_outcome'),
    entryPriceCents: integer('entry_price_cents').notNull(),
    /** 100 if the called side paid out, 0 otherwise. */
    settlementPriceCents: integer('settlement_price_cents'),
    settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type Prediction = typeof predictions.$inferSelect;
export type NewPrediction = typeof predictions.$inferInsert;
export type PredictionResult = typeof predictionResults.$inferSelect;
