import type { SomniaMarkets, UnifiedTrade } from "@somnia-chain/markets-sdk";

export interface FillSubscription {
  stop: () => void;
}

/**
 * Confirms a "Back This Prediction" trade actually happened, by streaming the
 * signer's own fills on `symbol` (its outcome side included, e.g.
 * "BTC-95000-31DEC26/USDC#YES"). Backed by the SDK's live store, which is fed
 * by on-chain OrderFilled events — not the REST trade feed, which the
 * protocol docs warn can lag or stall. `exchange` must carry the same signer
 * the order was placed with.
 */
export function subscribeFills(
  exchange: SomniaMarkets,
  symbol: string,
  onFill: (trade: UnifiedTrade) => void,
): FillSubscription {
  let stopped = false;

  (async () => {
    while (!stopped) {
      const trades = await exchange.watchMyTrades(symbol, 1);
      if (stopped) break;
      const [latest] = trades;
      if (latest) onFill(latest);
    }
  })().catch((err) => {
    if (!stopped) throw err;
  });

  return { stop: () => (stopped = true) };
}
