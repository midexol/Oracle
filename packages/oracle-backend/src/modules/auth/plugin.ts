import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { env } from '../../config/env.js';
import { unauthorized } from '../../lib/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler that rejects the request unless a valid token is present. */
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler that attaches the user when a token is present, but allows
     *  anonymous access. Used by feed and market routes so a logged-out
     *  visitor still sees everything. */
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Populated by requireAuth / optionalAuth. */
    currentUser?: { userId: string; walletAddress: string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; wallet: string };
    user: { sub: string; wallet: string };
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    try {
      // jwtVerify populates req.user, which is typed by the FastifyJWT
      // module augmentation above; its own return type is intentionally loose.
      await req.jwtVerify();
      req.currentUser = { userId: req.user.sub, walletAddress: req.user.wallet };
    } catch {
      throw unauthorized('Connect your wallet to continue');
    }
  });

  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    if (!req.headers.authorization) return;
    try {
      await req.jwtVerify();
      req.currentUser = { userId: req.user.sub, walletAddress: req.user.wallet };
    } catch {
      // An expired or malformed token on a public route is not an error -
      // the caller is simply treated as anonymous.
    }
  });
}

/** Throws rather than returning undefined, so handlers can rely on the type. */
export function requireUser(req: FastifyRequest): { userId: string; walletAddress: string } {
  if (!req.currentUser) throw unauthorized('Connect your wallet to continue');
  return req.currentUser;
}
