import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody, parseParams } from '../../lib/http.js';
import { requireUser } from '../auth/plugin.js';
import {
  followUser,
  getInfluence,
  getProfile,
  listFollows,
  unfollowUser,
  updateProfile,
} from './service.js';

const handleParam = z.object({ handle: z.string().min(1) });
const idParam = z.object({ id: z.string().uuid() });

const patchBody = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscores only')
    .optional(),
  avatarUrl: z.string().url().max(500).optional(),
  bio: z.string().trim().max(200).optional(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /**
   * PAGE 4 / PAGE 7 - predictor profile.
   * Accepts a UUID, username or wallet address. Auth is optional and only
   * affects whether `isFollowing` is populated.
   */
  app.get('/users/:handle', { preHandler: [app.optionalAuth] }, async (req) => {
    const { handle } = parseParams(req, handleParam);
    return getProfile(handle, req.currentUser?.userId);
  });

  /** How much DreamDEX volume this predictor's calls have driven. */
  app.get('/users/:handle/influence', async (req) => {
    const { handle } = parseParams(req, handleParam);
    const profile = await getProfile(handle);
    return getInfluence(profile.user.id);
  });

  app.get('/users/:id/followers', async (req) => {
    const { id } = parseParams(req, idParam);
    return { items: await listFollows(id, 'followers') };
  });

  app.get('/users/:id/following', async (req) => {
    const { id } = parseParams(req, idParam);
    return { items: await listFollows(id, 'following') };
  });

  app.post('/users/:id/follow', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);
    const { id } = parseParams(req, idParam);
    return followUser(userId, id);
  });

  app.delete('/users/:id/follow', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);
    const { id } = parseParams(req, idParam);
    return unfollowUser(userId, id);
  });

  /** Set a username, avatar or bio. */
  app.patch('/users/me', { preHandler: [app.requireAuth] }, async (req) => {
    const { userId } = requireUser(req);
    const patch = parseBody(req, patchBody);
    return updateProfile(userId, patch);
  });
}
