import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { allowUnsignedCompatWrites } from '../../config/env.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../../lib/http.js';
import { createChallenge, verifyChallenge } from '../auth/service.js';
import {
  createCompatPrediction,
  getCompatLeaderboard,
  getCompatPredictionContext,
  getCompatProfile,
  getCompatScoreBreakdown,
} from './service.js';

/**
 * The retired `oracle-analytics` HTTP contract, served over this backend.
 *
 * Mounted at `/api` (not `/api/v1`) and wrapping every payload as
 * `{ data: ... }`, because that is what the frontend's client expects. See
 * service.ts for the full list of differences and why this shim exists.
 *
 * Everything here is a read-only projection except `POST /predictions`, which
 * is unauthenticated by inheritance — see the note on `createCompatPrediction`.
 */

const walletParam = z.object({ wallet: z.string().min(1) });
const idParam = z.object({ id: z.string().uuid() });

const leaderboardQuery = z.object({
  asset: z.string().optional(),
  duration: z.string().optional(),
  sortBy: z.enum(['prediction_score', 'accuracy']).default('prediction_score'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createBody = z.object({
  wallet: z.string().min(1),
  marketId: z.string().min(1),
  asset: z.string().min(1),
  duration: z.string().min(1),
  prediction: z.enum(['UP', 'DOWN']),
  entryPrice: z.coerce.number(),
  username: z.string().optional(),
  avatar: z.string().optional(),
});

export async function compatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/leaderboard', async (req) => {
    const q = parseQuery(req, leaderboardQuery);
    return { data: await getCompatLeaderboard(q) };
  });

  app.get('/users/:wallet/profile', async (req) => {
    const { wallet } = parseParams(req, walletParam);
    return { data: await getCompatProfile(wallet) };
  });

  app.get('/users/:wallet/score-breakdown', async (req) => {
    const { wallet } = parseParams(req, walletParam);
    return { data: await getCompatScoreBreakdown(wallet) };
  });

  app.get('/predictions/:id/context', async (req) => {
    const { id } = parseParams(req, idParam);
    return { data: await getCompatPredictionContext(id) };
  });

  /**
   * Wallet sign-in, mirrored from /api/v1 so a client using this surface never
   * has to reach across to the other one. Same nonce, same signature check,
   * same token - only the envelope differs.
   */
  app.post(
    '/auth/challenge',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { walletAddress } = parseBody(req, z.object({ walletAddress: z.string().min(42).max(42) }));
      return { data: await createChallenge(walletAddress) };
    },
  );

  app.post('/auth/verify', async (req) => {
    const body = parseBody(
      req,
      z.object({
        walletAddress: z.string().min(42).max(42),
        nonce: z.string().min(8),
        signature: z.string().startsWith('0x'),
      }),
    );
    const identity = await verifyChallenge(body);

    return {
      data: {
        token: app.jwt.sign({ sub: identity.userId, wallet: identity.walletAddress }),
        user: {
          id: identity.userId,
          wallet: identity.walletAddress,
          username: identity.username,
        },
        isNewUser: identity.isNewUser,
      },
    };
  });

  /**
   * Record a call.
   *
   * Authentication is optional-but-honoured, which is what lets this be
   * secured without breaking a client that has not implemented sign-in yet:
   *
   *   - With a token, the token's wallet is authoritative. A body claiming a
   *     different wallet is refused rather than silently overridden - posting
   *     a call under someone else's name is the exact thing being prevented.
   *   - Without one, the body's wallet is trusted only where unsigned writes
   *     are permitted (outside production by default). In production the
   *     request is refused, so this cannot ship open by accident.
   */
  app.post(
    '/predictions',
    {
      preHandler: [app.optionalAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = parseBody(req, createBody);
      const signedIn = req.currentUser;

      if (signedIn) {
        if (body.wallet.toLowerCase() !== signedIn.walletAddress.toLowerCase()) {
          throw forbidden('That token does not belong to the wallet in the request');
        }
      } else if (!allowUnsignedCompatWrites) {
        throw unauthorized(
          'Sign in first: POST /api/auth/challenge, sign the message, then POST /api/auth/verify ' +
            'and send the token as "Authorization: Bearer <token>".',
        );
      }

      const prediction = await createCompatPrediction({
        ...body,
        // The token wins where present, so a forged body cannot pick the author.
        wallet: signedIn?.walletAddress ?? body.wallet,
      });

      // A repeat call on the same market is the old contract's idempotent
      // no-op rather than an error, so the UI's retry button stays harmless.
      reply.code(prediction.replayed ? 200 : 201);
      return { data: prediction };
    },
  );
}
