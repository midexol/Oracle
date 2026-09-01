import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, userStats } from '../../db/schema/index.js';
import { parseBody } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { createChallenge, verifyChallenge } from './service.js';
import { requireUser } from './plugin.js';

const challengeBody = z.object({
  walletAddress: z.string().min(42).max(42),
});

const verifyBody = z.object({
  walletAddress: z.string().min(42).max(42),
  nonce: z.string().min(8),
  signature: z.string().startsWith('0x'),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Step 1 of sign-in. Returns the exact text the wallet must sign.
   * The client passes `message` straight to personal_sign and sends the
   * signature back with the nonce.
   */
  app.post(
    '/auth/challenge',
    // Each call writes a nonce row; without a limit this is a free way to
    // grow that table indefinitely.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { walletAddress } = parseBody(req, challengeBody);
      return createChallenge(walletAddress);
    },
  );

  /** Step 2. Verifies the signature and issues a session token. */
  app.post('/auth/verify', async (req) => {
    const body = parseBody(req, verifyBody);
    const identity = await verifyChallenge(body);

    const token = app.jwt.sign({ sub: identity.userId, wallet: identity.walletAddress });

    return {
      token,
      user: {
        id: identity.userId,
        walletAddress: identity.walletAddress,
        username: identity.username,
      },
      isNewUser: identity.isNewUser,
    };
  });

  /** The signed-in user, with their reputation. Drives the header and My Profile. */
  app.get('/auth/me', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);

    const [row] = await db
      .select({
        id: users.id,
        walletAddress: users.walletAddress,
        username: users.username,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        createdAt: users.createdAt,
        stats: userStats,
      })
      .from(users)
      .leftJoin(userStats, eq(userStats.userId, users.id))
      .where(eq(users.id, userId));

    if (!row) throw notFound('User');
    return row;
  });
}
