import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { env, isProd, isTest } from './config/env.js';
import { AppError } from './lib/errors.js';
import { pingDatabase } from './db/index.js';
import { getDreamDexClient } from './dreamdex/index.js';
import { registerAuth } from './modules/auth/plugin.js';
import { authRoutes } from './modules/auth/routes.js';
import { marketRoutes } from './modules/markets/routes.js';
import { predictionRoutes } from './modules/predictions/routes.js';
import { tradeRoutes } from './modules/trades/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { leaderboardRoutes } from './modules/leaderboard/routes.js';
import { battleRoutes } from './modules/battles/routes.js';
import { compatRoutes } from './modules/compat/routes.js';
import { realtimeRoutes } from './realtime/routes.js';

/** Narrowing helper: Fastify types the handler's error as unknown-ish. */
const isZodError = (e: unknown): e is ZodError => e instanceof ZodError;

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // pino-pretty runs in a worker thread; skip it in tests so a suite
      // cannot hang on an open handle.
      transport:
        isProd || isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
    },
    // Neon and most hosts sit behind a proxy; without this every client looks
    // like it has the proxy's IP, which would make rate limiting global.
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // A generous default for read traffic. The wallet-touching and
    // row-creating routes each narrow this via `config.rateLimit` on the
    // route: POST /trades 30/min, POST /predictions 60/min,
    // POST /auth/challenge 20/min.
    allowList: () => false,
  });

  await app.register(websocket);
  await registerAuth(app);

  /**
   * One error shape for the whole API. Handlers throw AppError (or a Zod
   * error via the parse helpers) and never build error responses by hand, so
   * the client only ever has to understand this envelope.
   */
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) req.log.error({ err: error }, error.message);
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (isZodError(error)) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid request',
          details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply
        .code(429)
        .send({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } });
    }

    // Postgres unique violation - almost always a duplicate the caller can fix.
    if ((error as { code?: string }).code === '23505') {
      return reply
        .code(409)
        .send({ error: { code: 'CONFLICT', message: 'That already exists' } });
    }

    req.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        // Never leak internals to the client in production.
        message: isProd ? 'Something went wrong' : (error as Error).message,
      },
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}` } }),
  );

  /** Liveness + the two dependencies that matter. */
  app.get('/health', async (_req, reply) => {
    const client = getDreamDexClient();
    const dbOk = await pingDatabase();
    const healthy = dbOk;

    reply.code(healthy ? 200 : 503);
    return {
      status: healthy ? 'ok' : 'degraded',
      database: dbOk ? 'up' : 'down',
      dreamdex: { mode: client.mode, connected: client.isConnected() },
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  await app.register(
    async (api) => {
      await authRoutes(api);
      await marketRoutes(api);
      await predictionRoutes(api);
      await tradeRoutes(api);
      await userRoutes(api);
      await leaderboardRoutes(api);
      await battleRoutes(api);
    },
    { prefix: '/api/v1' },
  );

  /**
   * The retired oracle-analytics contract, for the existing frontend.
   *
   * Registered as its own plugin so its error shape can differ: that client
   * reads `error.message` at the top level, while /api/v1 nests it under
   * `error`. Sending both keeps either reader working.
   */
  await app.register(
    async (compat) => {
      compat.setErrorHandler((error, req, reply) => {
        const err = error as Error & { statusCode?: number; code?: string };
        const status = error instanceof AppError ? error.statusCode : (err.statusCode ?? 500);
        const message =
          error instanceof AppError
            ? error.message
            : isZodError(error)
              ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
              : status >= 500
                ? 'Internal server error'
                : err.message;

        if (status >= 500) req.log.error({ err: error }, 'Unhandled error on the compat API');

        return reply.code(isZodError(error) ? 400 : status).send({
          message,
          error: { code: error instanceof AppError ? error.code : 'ERROR', message },
        });
      });

      await compatRoutes(compat);
    },
    { prefix: '/api' },
  );

  await app.register(realtimeRoutes);

  return app;
}
