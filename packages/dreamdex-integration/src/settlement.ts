import type { SomniaMarkets } from "@somnia-chain/markets-sdk";
import type { Hex } from "viem";

export type SettlementResult =
  | { state: "pending" }
  | { state: "resolved"; winningOutcome: "YES" | "NO" }
  | { state: "voided" };

// Resolution on DreamDEX is oracle-driven and automatic — a pre-scheduled
// oracle posts the answer and Somnia's on-chain reactivity flips the market
// state with no keeper needed. This module does NOT resolve anything itself;
// it only reads the flip so the backend can update its own Predictions row
// (PENDING -> WON/LOST/VOID). Mapping "YES"/"NO" back onto a specific
// prediction's UP/DOWN call is the backend's job, since only it knows which
// side that prediction backed.
export async function getSettlement(exchange: SomniaMarkets, marketId: Hex): Promise<SettlementResult> {
  const onchain = await exchange.client.getMarketOnchain(marketId);
  if (onchain.isVoided) return { state: "voided" };
  if (onchain.isResolved) return { state: "resolved", winningOutcome: onchain.winningOutcome === 0 ? "YES" : "NO" };
  return { state: "pending" };
}

export interface SettlementSubscription {
  stop: () => void;
}

/**
 * Polls a market until it resolves or voids, then calls `onSettled` once and
 * stops. Polling (not a chain event subscription) because indexer/on-chain
 * reads here are cheap point-in-time reads, and the protocol docs' own gotcha
 * list recommends polling with a deadline over trusting a single read.
 */
export function watchSettlement(
  exchange: SomniaMarkets,
  marketId: Hex,
  onSettled: (result: Exclude<SettlementResult, { state: "pending" }>) => void,
  pollMs = 15_000,
): SettlementSubscription {
  let stopped = false;

  (async () => {
    while (!stopped) {
      const result = await getSettlement(exchange, marketId);
      if (result.state !== "pending") {
        onSettled(result);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  })().catch((err) => {
    if (!stopped) throw err;
  });

  return { stop: () => (stopped = true) };
}
