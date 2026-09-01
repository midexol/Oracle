import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  assetSchema,
  directionSchema,
  durationSchema,
  decimalString,
  parseBody,
  parseParams,
  parseQuery,
  uuidParam,
} from '../../lib/http.js';
import { requireUser } from '../auth/plugin.js';
import { hub } from '../../realtime/hub.js';
import { createPrediction, getFeed, getPredictionDetail } from './service.js';

const feedQuery = z.object({
  asset: assetSchema.optional(),
  duration: durationSchema.optional(),
  direction: directionSchema.optional(),
  userId: z.string().uuid().optional(),
  /** "following" restricts the feed to people the viewer follows. */
  scope: z.enum(['all', 'following']).default('all'),
  includeSettled: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

const createBody = z.object({
  marketId: z.string().uuid(),
  direction: directionSchema,
  stake: decimalString.optional(),
  rationale: z.string().trim().max(280).optional(),
});

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * PAGE 1: HOME - the live prediction feed.
   * Public: a logged-out visitor sees the whole feed. Auth only adds the
   * "following" scope.
   */
  app.get('/feed', { preHandler: [app.optionalAuth] }, async (req) => {
    const q = parseQuery(req, feedQuery);

    if (q.scope === 'following') {
      const { userId } = requireUser(req);
      return getFeed({ ...q, followedBy: userId });
    }

    return getFeed(q);
  });

  /** Make a call. One per user per market, enforced in the database. */
  app.post(
    '/predictions',
    {
      preHandler: [app.requireAuth],
      // A public track record is only meaningful if calls are deliberate;
      // this is well above human pace but blocks scripted spam.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { userId } = requireUser(req);
      const body = parseBody(req, createBody);

      const prediction = await createPrediction({ userId, ...body });

      // Push the new call straight onto the live feed and the market's own
      // channel - a prediction appearing the moment it is made is the most
      // visible part of the loop, and polling for it would feel dead.
      hub.publishMarket(prediction.marketId, {
        type: 'prediction.created',
        predictionId: prediction.id,
        marketId: prediction.marketId,
        userId,
      });

      reply.code(201);
      return prediction;
    },
  );

  /** PAGE 3: PREDICTION DETAIL. */
  app.get('/predictions/:id', async (req) => {
    const { id } = parseParams(req, uuidParam);
    return getPredictionDetail(id);
  });

  /**
   * Shareable prediction receipt.
   *
   * A flattened, screenshot-friendly projection of the same data - what was
   * called, at what price, and how it resolved. Kept separate from the detail
   * endpoint because this is the payload a share card renders from, and it
   * should not change shape when the detail page grows.
   */
  app.get('/predictions/:id/receipt', async (req) => {
    const { id } = parseParams(req, uuidParam);
    const detail = await getPredictionDetail(id);

    const settled = detail.prediction.status === 'WON' || detail.prediction.status === 'LOST';

    return {
      predictionId: detail.prediction.id,
      predictor: {
        username: detail.user.username,
        walletAddress: detail.user.walletAddress,
        avatarUrl: detail.user.avatarUrl,
        score: detail.stats?.score ?? 0,
        accuracy: detail.stats?.accuracy ?? null,
      },
      contract: {
        asset: detail.market.asset,
        duration: detail.market.duration,
        dreamdexMarketId: detail.market.dreamdexMarketId,
      },
      call: detail.prediction.direction,
      calledAtCents: detail.prediction.entryPriceCents,
      calledAt: detail.prediction.createdAt,
      status: detail.prediction.status,
      settled,
      result: settled ? detail.prediction.status : null,
      settledAtCents: detail.settlement?.settlementPriceCents ?? null,
      settledAt: detail.prediction.settledAt,
      marketOutcome: detail.market.outcome,
      backing: detail.backing,
    };
  });
}
