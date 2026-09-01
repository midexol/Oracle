import {
  pgTable,
  uuid,
  timestamp,
  index,
  primaryKey,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { markets } from './markets.js';
import { predictions } from './predictions.js';
import { battleStatusEnum } from './enums.js';

/** Directed follow edge. Composite PK makes follow/unfollow idempotent. */
export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followingId] }),
    index('follows_following_idx').on(t.followingId),
    check('follows_no_self', sql`${t.followerId} <> ${t.followingId}`),
  ],
);

/**
 * Two opposing public calls on the same market, promoted into a head-to-head.
 * Viewers pick a side by taking the corresponding DreamDEX position, so a
 * battle is a volume driver, not just a card.
 */
export const battles = pgTable(
  'battles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),

    /** Always the UP side. */
    predictionAId: uuid('prediction_a_id')
      .notNull()
      .references(() => predictions.id, { onDelete: 'cascade' }),
    /** Always the DOWN side. */
    predictionBId: uuid('prediction_b_id')
      .notNull()
      .references(() => predictions.id, { onDelete: 'cascade' }),

    status: battleStatusEnum('status').notNull().default('LIVE'),
    winnerUserId: uuid('winner_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('battles_status_idx').on(t.status),
    index('battles_market_idx').on(t.marketId),
    // The same two calls can only ever be paired once.
    uniqueIndex('battles_pair_key').on(t.predictionAId, t.predictionBId),
    check('battles_distinct_sides', sql`${t.predictionAId} <> ${t.predictionBId}`),
  ],
);

export type Follow = typeof follows.$inferSelect;
export type Battle = typeof battles.$inferSelect;
