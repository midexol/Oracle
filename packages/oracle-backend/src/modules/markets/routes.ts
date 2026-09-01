import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assetSchema, durationSchema, parseParams, parseQuery } from '../../lib/http.js';
import { getMarketDetail, listMarkets } from './service.js';

const listQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',') as Array<'OPEN' | 'CLOSED' | 'SETTLED' | 'CANCELLED'>) : undefined)),
  asset: assetSchema.optional(),
  duration: durationSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParam = z.object({ id: z.string().min(1) });

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  /** The Markets page. Defaults to open contracts, soonest expiry first. */
  app.get('/markets', async (req) => {
    const q = parseQuery(req, listQuery);
    const items = await listMarkets({
      status: q.status ?? ['OPEN'],
      asset: q.asset,
      duration: q.duration,
      limit: q.limit,
    });
    return { items };
  });

  /**
   * PAGE 2: MARKET - contract, live book, tape, chart history, and who is
   * predicting what. Accepts the internal UUID or the DreamDEX market id.
   */
  app.get('/markets/:id', async (req) => {
    const { id } = parseParams(req, idParam);
    return getMarketDetail(id);
  });
}
