import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody, parseParams, parseQuery, uuidParam } from '../../lib/http.js';
import { createBattle, findBattleCandidates, getBattle, listBattles } from './service.js';

const listQuery = z.object({
  status: z.enum(['LIVE', 'SETTLED', 'VOID']).default('LIVE'),
  marketId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const createBody = z.object({
  predictionAId: z.string().uuid(),
  predictionBId: z.string().uuid(),
});

export async function battleRoutes(app: FastifyInstance): Promise<void> {
  /** PAGE 5: BATTLES. Defaults to live head-to-heads. */
  app.get('/battles', async (req) => {
    const q = parseQuery(req, listQuery);
    return { items: await listBattles(q) };
  });

  /**
   * Opposing calls that could become a battle, best-matched first.
   * Lets the app offer a pairing instead of asking anyone to find two
   * prediction ids by hand.
   */
  app.get('/battles/candidates', async (req) => {
    const { limit } = parseQuery(
      req,
      z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }),
    );
    return { items: await findBattleCandidates(limit) };
  });

  app.get('/battles/:id', async (req) => {
    const { id } = parseParams(req, uuidParam);
    return getBattle(id);
  });

  /**
   * Promote two opposing calls into a head-to-head.
   *
   * Order of the two ids does not matter - the service normalises so side A is
   * always UP. Backing a side afterwards is an ordinary
   * `POST /trades { backedPredictionId }`, so battles need no separate
   * execution path.
   */
  app.post(
    '/battles',
    {
      preHandler: [app.requireAuth],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { predictionAId, predictionBId } = parseBody(req, createBody);
      const battle = await createBattle(predictionAId, predictionBId);
      reply.code(201);
      return battle;
    },
  );
}
