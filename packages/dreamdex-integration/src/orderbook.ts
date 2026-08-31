import type { SomniaMarkets, UnifiedOrderBook } from "@somnia-chain/markets-sdk";

export interface OrderBookSubscription {
  stop: () => void;
}

/**
 * Streams live order-book updates for one event-contract symbol (e.g.
 * "BTC-95000-31DEC26/USDC#YES") into `onUpdate`. Each `watchOrderBook` await
 * resolves off the SDK's local store the moment a new block lands — no
 * polling. `stop()` is best-effort: it exits after the in-flight await
 * resolves, matching how the SDK's own examples use this verb.
 */
export function subscribeOrderBook(
  exchange: SomniaMarkets,
  symbol: string,
  onUpdate: (book: UnifiedOrderBook) => void,
  depth = 10,
): OrderBookSubscription {
  let stopped = false;

  (async () => {
    while (!stopped) {
      const book = await exchange.watchOrderBook(symbol, depth);
      if (stopped) break;
      onUpdate(book);
    }
  })().catch((err) => {
    if (!stopped) throw err;
  });

  return { stop: () => (stopped = true) };
}
