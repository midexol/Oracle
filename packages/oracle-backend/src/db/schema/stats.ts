import {
  pgTable,
  uuid,
  integer,
  numeric,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { assetEnum, durationEnum } from './enums.js';

/**
 * Materialised reputation, recomputed by the analytics engine whenever a
 * prediction settles.
 *
 * These are derived values — predictions is the source of truth and every
 * number here can be rebuilt from it (see `recomputeUserStats`). We
 * materialise because the leaderboard must sort thousands of users on every
 * page load, which is not something to do with live aggregates.
 */
export const userStats = pgTable(
  'user_stats',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    totalPredictions: integer('total_predictions').notNull().default(0),
    settledPredictions: integer('settled_predictions').notNull().default(0),
    correctPredictions: integer('correct_predictions').notNull().default(0),

    /** correct / settled, 0..1. Null until the user has a settled call. */
    accuracy: numeric('accuracy', { precision: 6, scale: 5 }),

    /**
     * Headline 0..100 Prediction Score. Wilson lower bound on accuracy, so a
     * 1-for-1 newcomer cannot outrank a proven 74%-over-63 predictor.
     */
    score: integer('score').notNull().default(0),

    /**
     * Difficulty-adjusted edge: mean of (outcome - market implied probability
     * at entry). Positive means the predictor beats the market's own price.
     * This is the number that separates a genuine forecaster from someone who
     * only ever calls heavy favourites.
     */
    edge: numeric('edge', { precision: 7, scale: 6 }),

    /**
     * Return on cost, in percent. Buying a side at 43c that pays 100c returns
     * +133%; being wrong returns -100%. This is the economic twin of `edge`:
     * edge measures forecasting skill in probability points, roi measures what
     * that skill was actually worth per contract on DreamDEX.
     */
    roi: numeric('roi', { precision: 10, scale: 4 }),

    /** Mean price of the side called, in cents. Reveals favourite-backers. */
    avgEntryPriceCents: integer('avg_entry_price_cents'),

    currentStreak: integer('current_streak').notNull().default(0),
    bestStreak: integer('best_streak').notNull().default(0),

    /** Attribution: how much DreamDEX volume this predictor's calls drove. */
    volumeBacked: numeric('volume_backed', { precision: 24, scale: 6 }).notNull().default('0'),
    backersCount: integer('backers_count').notNull().default(0),

    followersCount: integer('followers_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The leaderboard's primary sort.
    index('user_stats_score_idx').on(t.score),
    index('user_stats_accuracy_idx').on(t.accuracy),
  ],
);

/**
 * Per-segment reputation — "Mide's BTC 15M accuracy is 78%".
 *
 * A segment is an (asset, duration) pair, matching how DreamDEX lists Event
 * Contracts. This table is what makes the feed card persuasive: the number
 * shown is the predictor's record on *this exact kind of market*, not their
 * lifetime average across everything.
 */
export const userSegmentStats = pgTable(
  'user_segment_stats',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    asset: assetEnum('asset').notNull(),
    duration: durationEnum('duration').notNull(),

    settledPredictions: integer('settled_predictions').notNull().default(0),
    correctPredictions: integer('correct_predictions').notNull().default(0),
    accuracy: numeric('accuracy', { precision: 6, scale: 5 }),
    score: integer('score').notNull().default(0),
    edge: numeric('edge', { precision: 7, scale: 6 }),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.asset, t.duration] }),
    // Filtered leaderboards: "top BTC 15M predictors".
    index('segment_stats_leaderboard_idx').on(t.asset, t.duration, t.score),
  ],
);

export type UserStats = typeof userStats.$inferSelect;
export type UserSegmentStats = typeof userSegmentStats.$inferSelect;
