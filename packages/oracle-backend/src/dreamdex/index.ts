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
      ? // Network, indexer URL, addresses and DRY_RUN come from
        // @signal/dreamdex-integration's own config, so there is exactly one
        // place that decides which chain we are pointed at.
        new LiveDreamDexClient({ discoverIntervalMs: env.MARKET_SYNC_INTERVAL_MS })
      : new MockDreamDexClient({ timeScale: env.MOCK_TIME_SCALE });

  return client;
}

/** Test hook: swap in a stub without touching the environment. */
export function setDreamDexClient(next: DreamDexClient | null): void {
  client = next;
}
