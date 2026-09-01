import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * A user is identified by their wallet. Everything else (username, avatar)
 * is cosmetic and optional, so a first-time visitor can connect and predict
 * without an onboarding form.
 *
 * wallet_address is always stored lowercased so lookups are stable.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletAddress: text('wallet_address').notNull().unique(),
    username: text('username').unique(),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_created_at_idx').on(t.createdAt)],
);

/**
 * Single-use nonces for wallet sign-in. The user signs a message containing
 * the nonce; we verify the signature recovers their address, then burn it.
 */
export const authNonces = pgTable(
  'auth_nonces',
  {
    nonce: text('nonce').primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    /** The exact text the wallet was asked to sign. Stored verbatim because
     *  signature verification must run against the identical string - not one
     *  we try to reconstruct later. */
    message: text('message').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_nonces_wallet_idx').on(t.walletAddress)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
