import type { SomniaMarkets, UnifiedOrder } from "@somnia-chain/markets-sdk";
import { loadConfig } from "./config.js";

export type PredictionSide = "UP" | "DOWN";

export interface BackPredictionArgs {
  /** Canonical event-contract symbol, e.g. "BTC-95000-31DEC26/USDC". */
  symbol: string;
  side: PredictionSide;
  /** Dollar stake, matching the PRD's "Amount: $10" UI — converted to a contract quantity at the current price. */
  usdStake: number;
  /** Max acceptable slippage past the best opposite price, as a fraction (0.02 = 2%). */
  slippage?: number;
  /** Defaults to the DRY_RUN env var (see config.ts) — logs the order instead of sending it. */
  dryRun?: boolean;
}

// This is "BACK THIS PREDICTION": a taker market order on the corresponding
// outcome. UP -> the YES tradable, DOWN -> NO (the book only quotes YES; the
// SDK's tradable-symbol grammar addresses NO via the "#NO" suffix).
//
// The exchange passed in must already carry a signer (walletClient for a
// browser flow, or a privateKey for a server/test flow) — see client.ts.
// createOrder throws SignerRequiredError otherwise.
export async function backPrediction(
  exchange: SomniaMarkets,
  args: BackPredictionArgs,
): Promise<UnifiedOrder | { dryRun: true; tradable: string; side: "buy"; quantity: number; referencePrice: number }> {
  const { symbol, side, usdStake, slippage = 0.02, dryRun = loadConfig().dryRun } = args;
  const outcome = side === "UP" ? "YES" : "NO";
  const tradable = `${symbol}#${outcome}`;

  const ticker = await exchange.fetchTicker(tradable);
  const referencePrice = ticker.last;
  if (!referencePrice) {
    throw new Error(`${tradable} has no fills yet — cannot size a $-denominated stake without a reference price`);
  }
  const quantity = usdStake / referencePrice;

  if (dryRun) {
    console.log(`[DRY_RUN] would buy ${quantity} of ${tradable} @ ~${referencePrice} (slippage ${slippage})`);
    return { dryRun: true, tradable, side: "buy", quantity, referencePrice };
  }

  return exchange.createOrder(tradable, "market", "buy", quantity, undefined, { slippage });
}
