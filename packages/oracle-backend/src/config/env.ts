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

  DREAMDEX_MODE: z.enum(['mock', 'live']).default('mock'),
  DREAMDEX_REST_URL: z.string().optional(),
  DREAMDEX_WS_URL: z.string().optional(),
  DREAMDEX_API_KEY: z.string().optional(),
  /** Simulator wall-clock compression; 20 makes a 15M contract settle in 45s. */
  MOCK_TIME_SCALE: z.coerce.number().positive().default(20),

  SOMNIA_CHAIN_ID: z.coerce.number().int().default(50312),
  SOMNIA_RPC_URL: z.string().default('https://dream-rpc.somnia.network'),
  SOMNIA_WS_RPC_URL: z.string().optional(),
  DREAMDEX_EXCHANGE_ADDRESS: z.string().optional(),

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
