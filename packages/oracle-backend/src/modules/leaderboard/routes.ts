import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assetSchema, durationSchema, parseQuery } from '../../lib/http.js';
import {
  getLeaderboard,
  getProgressToTop,
  getUserRank,
  getVolumeLeaderboard,
} from '../../analytics/leaderboard.js';
import { requireUser } from '../auth/plugin.js';

const boardQuery = z.object({
  asset: assetSchema.optional(),
  duration: durationSchema.optional(),
  sort: z.enum(['score', 'accuracy', 'edge', 'volume', 'streak']).default('score'),
  minPredictions: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  /**
   * PAGE 6: LEADERBOARD.
   *
   * The PRD's tabs - ALL | BTC | ETH | 15M | 1H - are just combinations of
   * `asset` and `duration`, so one endpoint serves every tab.
   *
   * Default sort is Prediction Score, not raw accuracy: a board topped by
   * someone who is 1-for-1 is not a board anyone competes on.
   */
  app.get('/leaderboard', async (req) => {
    const q = parseQuery(req, boardQuery);
    const items = await getLeaderboard(q);
    return { items, filters: q };
  });

  /** Where the signed-in user sits on a given board. */
  app.get('/leaderboard/me', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);
    const q = parseQuery(
      req,
      z.object({
        asset: assetSchema.optional(),
        duration: durationSchema.optional(),
        minPredictions: z.coerce.number().int().min(1).max(100).default(1),
      }),
    );
    const rank = await getUserRank(userId, q);
    return rank ?? { rank: null, total: 0 };
  });

  /**
   * "You are 4 correct calls from the top 10."
   * The nudge that turns a ranking into a reason to keep predicting.
   */
  app.get('/leaderboard/me/progress', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);
    const { topN } = parseQuery(
      req,
      z.object({ topN: z.coerce.number().int().min(3).max(100).default(10) }),
    );
    return getProgressToTop(userId, topN);
  });

  /**
   * Predictors ranked by the DreamDEX volume their calls originated.
   * Being right and being followed into a trade are different achievements.
   */
  app.get('/leaderboard/influence', async (req) => {
    const { limit } = parseQuery(
      req,
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
    );
    return { items: await getVolumeLeaderboard(limit) };
  });
}
