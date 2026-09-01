import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decimalString, directionSchema, parseBody, parseQuery } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { requireUser } from '../auth/plugin.js';
import { getPlatformAttribution, getUserTrades, placeTrade } from './service.js';

const placeBody = z
  .object({
    backedPredictionId: z.string().uuid().optional(),
    marketId: z.string().uuid().optional(),
    side: directionSchema.optional(),
    quantity: decimalString.optional(),
    amountUsd: decimalString.optional(),
    limitPriceCents: z.number().int().min(1).max(99).optional(),
  })
  .refine((v) => v.backedPredictionId || (v.marketId && v.side), {
    message: 'Provide backedPredictionId, or both marketId and side',
  })
  .refine((v) => Boolean(v.quantity) !== Boolean(v.amountUsd), {
    message: 'Provide exactly one of quantity or amountUsd',
  });

export async function tradeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Execute a DreamDEX Event Contract order.
   *
   * Two shapes, one endpoint:
   *   { backedPredictionId, amountUsd }   - back someone's call from the feed
   *   { marketId, side, amountUsd }       - trade a market directly
   *
   * Backing does not let the caller pick a side: the side comes from the
   * prediction being backed. That is what makes the attribution trustworthy.
   *
   * Returns as soon as the order is accepted, typically PENDING. The fill
   * arrives asynchronously as an on-chain OrderFilled event and is pushed over
   * the realtime channel - the client should not block waiting for it.
   */
  app.post(
    '/trades',
    {
      preHandler: [app.requireAuth],
      // Order placement spends the user's wallet and reaches an external
      // exchange, so it gets a far tighter budget than the global read limit.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { userId, walletAddress } = requireUser(req);
      const body = parseBody(req, placeBody);

      // Strongly recommended. Without it, a retried request places a second
      // real, funded order - see the note in the README.
      const idempotencyKey = req.headers['idempotency-key'];

      const trade = await placeTrade({
        userId,
        walletAddress,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
        ...body,
      });

      if (trade.status === 'FAILED') {
        throw badRequest(trade.failureReason ?? 'Order was rejected by DreamDEX', {
          tradeId: trade.id,
        });
      }

      reply.code(201);
      return trade;
    },
  );

  /** The signed-in user's order history, for My Profile. */
  app.get('/trades/me', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);
    const { limit } = parseQuery(req, z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }));
    return { items: await getUserTrades(userId, limit) };
  });

  /**
   * Platform-level attribution: how much DreamDEX volume Oracle originated,
   * and how much of it came from the social layer rather than direct trading.
   * This is the slide, not a debug endpoint.
   */
  app.get('/stats/attribution', async () => getPlatformAttribution());
}
