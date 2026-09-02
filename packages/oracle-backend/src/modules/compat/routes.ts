import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody, parseParams, parseQuery } from '../../lib/http.js';
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

  app.post(
    '/predictions',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(req, createBody);
      const prediction = await createCompatPrediction(body);

      // A repeat call on the same market is the old contract's idempotent
      // no-op rather than an error, so the UI's retry button stays harmless.
      reply.code(prediction.replayed ? 200 : 201);
      return { data: prediction };
    },
  );
}
