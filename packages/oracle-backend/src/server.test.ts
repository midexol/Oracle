import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

/**
 * Wiring smoke tests.
 *
 * These assert the things that break silently when a plugin is registered in
 * the wrong order or a route is mounted under the wrong prefix: the app
 * assembles at all, the auth guard actually guards, validation rejects before
 * a handler runs, and every failure comes back in one error envelope.
 *
 * No database is touched. postgres.js connects lazily, so routes that never
 * query work fine here; the ones that do query are covered separately against
 * a real database.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('server wiring', () => {
  it('serves the API under /api/v1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns one error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/totally-unknown' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('registers the websocket endpoint', () => {
    // printRoutes would omit it entirely if @fastify/websocket failed to load.
    expect(app.printRoutes()).toContain('ws');
  });
});

describe('auth guard', () => {
  it.each([
    ['GET', '/api/v1/auth/me'],
    ['POST', '/api/v1/predictions'],
    ['POST', '/api/v1/trades'],
    ['GET', '/api/v1/trades/me'],
    ['PATCH', '/api/v1/users/me'],
    ['GET', '/api/v1/leaderboard/me'],
  ])('rejects unauthenticated %s %s', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects a malformed token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('request validation', () => {
  it('rejects a wallet address that is not 42 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: '0x123' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details?.[0]).toHaveProperty('field');
  });

  it('rejects a missing body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/challenge' });
    expect(res.statusCode).toBe(400);
  });

  it('validates before authorising, but only after the auth guard', async () => {
    // No token and a bad body: the guard must win, so the caller is told to
    // sign in rather than shown the shape of a route they cannot reach.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/predictions',
      payload: { direction: 'SIDEWAYS' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a prediction id that is not a UUID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/predictions/abc' });
    expect(res.statusCode).toBe(400);
  });
});

describe('health', () => {
  it('reports the DreamDEX mode and degrades when the database is unreachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.dreamdex.mode).toBe('mock');
    expect(['ok', 'degraded']).toContain(body.status);
    // The fixture URL points nowhere, so this must report down rather than throw.
    expect(body.database).toBe('down');
    expect(res.statusCode).toBe(503);
  });
});
