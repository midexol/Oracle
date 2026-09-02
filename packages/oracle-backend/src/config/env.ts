import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  AUTH_DOMAIN: z.string().default('oracle.local'),

  /**
   * Whether the /api compatibility surface accepts writes with no token,
   * trusting the wallet in the request body.
   *
   * Left unset it follows NODE_ENV: allowed outside production, refused in it.
   * That is the safe default in both directions - a demo keeps working without
   * ceremony, and a real deployment cannot accidentally ship an endpoint where
   * anyone can post a call as anyone else. Set it explicitly to override.
   */
  COMPAT_ALLOW_UNSIGNED_WRITES: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v === 'true' || v === '1')),

  /**
   * 'mock' runs the built-in simulator; 'live' talks to DreamDEX through
   * @signal/dreamdex-integration.
   *
   * Everything else about the live connection - network, indexer URL,
   * contract addresses, DRY_RUN - is that package's config (NETWORK,
   * DREAMDEX_INDEXER_URL, DREAMDEX_WS_RPC_URL, DRY_RUN), deliberately not
   * duplicated here. Two competing sets of connection settings is how a
   * backend ends up pointed at two different chains at once.
   */
  DREAMDEX_MODE: z.enum(['mock', 'live']).default('mock'),
  /** Simulator wall-clock compression; 20 makes a 15M contract settle in 45s. */
  MOCK_TIME_SCALE: z.coerce.number().positive().default(20),


  ENABLE_JOBS: bool(true),
  MARKET_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  RESOLVER_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  RECONCILER_INTERVAL_MS: z.coerce.number().int().positive().default(20000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Resolved here rather than in the schema, which cannot see NODE_ENV. */
export const allowUnsignedCompatWrites =
  env.COMPAT_ALLOW_UNSIGNED_WRITES ?? !isProd;
