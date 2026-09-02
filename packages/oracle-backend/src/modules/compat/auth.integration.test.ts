import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeDatabase } from '../../db/index.js';
import { migrateTestDatabase, resetDatabase } from '../../test/db.js';
import { buildServer } from '../../server.js';

/**
 * Authentication on the compatibility write endpoint.
 *
 * The endpoint is deliberately "optional-but-honoured": a client that has not
 * implemented sign-in keeps working outside production, while a signed request
 * is authoritative and cannot be forged. Each of those four paths is a
 * separate way to get it wrong, so each has a test.
 *
 * Driven through `app.inject()` rather than the service, because the auth
 * decision lives in the route and the header handling is the thing under test.
 */

// A fixed key so the signature is reproducible; this address owns nothing.
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(TEST_KEY);

let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestDatabase();
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Full wallet sign-in over the compat surface, returning a bearer token. */
async function signIn(): Promise<string> {
  const challenge = await app.inject({
    method: 'POST',
    url: '/api/auth/challenge',
    payload: { walletAddress: account.address },
  });
  expect(challenge.statusCode).toBe(200);

  const { nonce, message } = challenge.json().data;
  const signature = await account.signMessage({ message });

  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/verify',
    payload: { walletAddress: account.address, nonce, signature },
  });
  expect(verified.statusCode).toBe(200);

  return verified.json().data.token as string;
}

const payload = (over: Record<string, unknown> = {}) => ({
  wallet: account.address,
  marketId: `BTC-15M-${Math.random().toString(36).slice(2, 10)}`,
  asset: 'BTC',
  duration: '15M',
  prediction: 'UP',
  entryPrice: 0.43,
  ...over,
});

describe('compat sign-in', () => {
  it('issues a token for a correctly signed challenge', async () => {
    const token = await signIn();
    expect(token.split('.')).toHaveLength(3);
  });

  it('refuses a signature from a different wallet', async () => {
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/auth/challenge',
      payload: { walletAddress: account.address },
    });
    const { nonce, message } = challenge.json().data;

    const impostor = privateKeyToAccount(
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    );
    const signature = await impostor.signMessage({ message });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { walletAddress: account.address, nonce, signature },
    });

    expect(res.statusCode).toBe(401);
  });

  it('burns the nonce so a captured signature cannot be replayed', async () => {
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/auth/challenge',
      payload: { walletAddress: account.address },
    });
    const { nonce, message } = challenge.json().data;
    const signature = await account.signMessage({ message });
    const body = { walletAddress: account.address, nonce, signature };

    expect((await app.inject({ method: 'POST', url: '/api/auth/verify', payload: body })).statusCode).toBe(200);
    // Same nonce, same signature, second time.
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify', payload: body })).statusCode).toBe(401);
  });
});

describe('POST /api/predictions authentication', () => {
  it('accepts a signed request and attributes it to the token wallet', async () => {
    const token = await signIn();

    const res = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      headers: { authorization: `Bearer ${token}` },
      payload: payload(),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.entryPriceCents).toBe(43);
  });

  /** The attack the token is there to stop. */
  it('refuses a signed request that claims a different wallet', async () => {
    const token = await signIn();

    const res = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      headers: { authorization: `Bearer ${token}` },
      payload: payload({ wallet: '0x000000000000000000000000000000000000dEaD' }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/does not belong/i);
  });

  it('still accepts an unsigned request outside production', async () => {
    // NODE_ENV is 'test' here, so unsigned writes remain permitted - this is
    // what keeps the existing frontend working while it has no sign-in.
    const res = await app.inject({ method: 'POST', url: '/api/predictions', payload: payload() });
    expect(res.statusCode).toBe(201);
  });

  it('ignores a malformed token rather than failing the request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: payload(),
    });
    // optionalAuth treats an unusable token as anonymous; outside production
    // that is allowed, so the call still lands.
    expect(res.statusCode).toBe(201);
  });

  it('is still idempotent on a replay when signed', async () => {
    const token = await signIn();
    const body = payload();
    const headers = { authorization: `Bearer ${token}` };

    const first = await app.inject({ method: 'POST', url: '/api/predictions', headers, payload: body });
    const second = await app.inject({ method: 'POST', url: '/api/predictions', headers, payload: body });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
  });
});

describe('read endpoints stay public', () => {
  it('serves the leaderboard with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});
