import { and, eq, isNull, lt } from 'drizzle-orm';
import { verifyMessage, isAddress } from 'viem';
import { db } from '../../db/index.js';
import { authNonces, users } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { normalizeAddress, randomHex } from '../../lib/util.js';
import { ensureUserStatsRow } from '../../analytics/reputation.js';

/**
 * Wallet sign-in.
 *
 * There is no password and no email. The user proves control of an address by
 * signing a one-time challenge, and we hand back a JWT. That is the right
 * model here because the wallet is not just an identity - it is the account
 * that funds and settles every DreamDEX order the user places through Oracle.
 *
 * Replay protection comes from the nonce being single-use and short-lived,
 * which is why `consumeNonce` marks it spent inside the same transaction that
 * validates it.
 */

const NONCE_TTL_MS = 10 * 60 * 1000;

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

export async function createChallenge(rawAddress: string): Promise<Challenge> {
  if (!isAddress(rawAddress)) throw badRequest('Not a valid wallet address');

  const walletAddress = normalizeAddress(rawAddress);
  const nonce = randomHex(16);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);

  const message = buildMessage({ domain: env.AUTH_DOMAIN, walletAddress, nonce, issuedAt });

  await db.insert(authNonces).values({ nonce, walletAddress, message, expiresAt });

  // Opportunistic cleanup; cheap and keeps the table from growing unbounded.
  await db.delete(authNonces).where(lt(authNonces.expiresAt, new Date(Date.now() - NONCE_TTL_MS)));

  return { nonce, message, expiresAt: expiresAt.toISOString() };
}

export interface VerifiedIdentity {
  userId: string;
  walletAddress: string;
  username: string | null;
  isNewUser: boolean;
}

export async function verifyChallenge(params: {
  walletAddress: string;
  nonce: string;
  signature: string;
}): Promise<VerifiedIdentity> {
  const walletAddress = normalizeAddress(params.walletAddress);
  if (!isAddress(walletAddress)) throw badRequest('Not a valid wallet address');

  const [record] = await db
    .select()
    .from(authNonces)
    .where(
      and(
        eq(authNonces.nonce, params.nonce),
        eq(authNonces.walletAddress, walletAddress),
        isNull(authNonces.consumedAt),
      ),
    );

  if (!record) throw unauthorized('Challenge not found, already used, or for a different wallet');
  if (record.expiresAt.getTime() < Date.now()) throw unauthorized('Challenge expired');

  const signatureValid = await verifyMessage({
    address: walletAddress as `0x${string}`,
    message: record.message,
    signature: params.signature as `0x${string}`,
  }).catch(() => false);

  if (!signatureValid) throw unauthorized('Signature does not match this wallet');

  // Burn the nonce before issuing anything, so a concurrent duplicate request
  // loses the race rather than producing a second valid session.
  const burned = await db
    .update(authNonces)
    .set({ consumedAt: new Date() })
    .where(and(eq(authNonces.nonce, params.nonce), isNull(authNonces.consumedAt)))
    .returning({ nonce: authNonces.nonce });

  if (burned.length === 0) throw unauthorized('Challenge already used');

  return upsertUser(walletAddress);
}

/**
 * Find-or-create by wallet. A first-time visitor becomes a user the moment
 * they sign in - no onboarding form stands between them and their first
 * prediction.
 */
export async function upsertUser(walletAddress: string): Promise<VerifiedIdentity> {
  const address = normalizeAddress(walletAddress);

  const [existing] = await db.select().from(users).where(eq(users.walletAddress, address));
  if (existing) {
    return {
      userId: existing.id,
      walletAddress: existing.walletAddress,
      username: existing.username,
      isNewUser: false,
    };
  }

  // Two unique columns can block this insert, and they need opposite handling:
  // a wallet clash means the user already exists (fine, load them), while a
  // username clash is an unlucky collision on the generated handle and must
  // not stop someone signing in. Retry with a fresh suffix, then give up on a
  // name entirely rather than deny access - a username is cosmetic, the wallet
  // is the identity.
  let created: typeof users.$inferSelect | undefined;

  for (const candidate of [defaultUsername(address), null, null]) {
    try {
      const [row] = await db
        .insert(users)
        .values({
          walletAddress: address,
          username: candidate ?? `${defaultUsername(address)}_${randomHex(2)}`,
        })
        .onConflictDoNothing({ target: users.walletAddress })
        .returning();
      created = row;
      break;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  if (!created) {
    // Either we lost an insert race on the wallet, or every username attempt
    // collided. Both mean: look up whatever is there now.
    const [row] = await db.select().from(users).where(eq(users.walletAddress, address));
    if (row) {
      return {
        userId: row.id,
        walletAddress: row.walletAddress,
        username: row.username,
        isNewUser: false,
      };
    }
    // No wallet row and no successful insert: fall back to no username at all.
    const [nameless] = await db
      .insert(users)
      .values({ walletAddress: address })
      .onConflictDoNothing({ target: users.walletAddress })
      .returning();
    created = nameless!;
  }

  await ensureUserStatsRow(created.id);

  return {
    userId: created.id,
    walletAddress: created.walletAddress,
    username: created.username,
    isNewUser: true,
  };
}

/**
 * The challenge text. Human-readable on purpose: the user sees this in their
 * wallet, so it should say plainly what they are agreeing to and make clear
 * that it is not a transaction.
 */
function buildMessage(p: {
  domain: string;
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
}): string {
  return [
    `${p.domain} wants you to sign in with your wallet.`,
    '',
    'Signing this message proves you control this address.',
    'It is not a transaction and costs no gas.',
    '',
    `Address: ${p.walletAddress}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
  ].join('\n');
}

/** e.g. 0x1f9a...c3d2 -> "player_1f9ac3d2" until the user picks a name. */
const defaultUsername = (address: string) =>
  `player_${address.slice(2, 6)}${address.slice(-4)}`;

/** Postgres unique_violation. */
const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
