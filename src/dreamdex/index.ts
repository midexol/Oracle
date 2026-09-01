import { env } from '../config/env.js';
import type { DreamDexClient } from './types.js';
import { MockDreamDexClient } from './mock/client.js';
import { LiveDreamDexClient } from './live/client.js';

export * from './types.js';

let client: DreamDexClient | null = null;

/**
 * Process-wide DreamDEX client, selected by DREAMDEX_MODE.
 *
 * Everything else in the backend depends on the DreamDexClient interface and
 * calls this factory, so switching mock -> live is a config change rather than
 * a code change.
 */
export function getDreamDexClient(): DreamDexClient {
  if (client) return client;

  client =
    env.DREAMDEX_MODE === 'live'
      ? new LiveDreamDexClient({
          restUrl: env.DREAMDEX_REST_URL,
          wsUrl: env.DREAMDEX_WS_URL,
          apiKey: env.DREAMDEX_API_KEY,
          rpcUrl: env.SOMNIA_RPC_URL,
          chainId: env.SOMNIA_CHAIN_ID,
          exchangeAddress: env.DREAMDEX_EXCHANGE_ADDRESS,
        })
      : new MockDreamDexClient({ timeScale: env.MOCK_TIME_SCALE });

  return client;
}

/** Test hook: swap in a stub without touching the environment. */
export function setDreamDexClient(next: DreamDexClient | null): void {
  client = next;
}
