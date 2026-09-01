import { fromHuman, type SomniaMarkets, type TxResult } from "@somnia-chain/markets-sdk";
import type { Address, Hex } from "viem";

export interface RedeemArgs {
  marketId: Hex;
  /** BinaryMarket contract address (EventContract.info.info.marketAddress when info.marketType === "BINARY"). */
  marketAddress: Address;
  outcome: "YES" | "NO";
  /** Outcome-token amount to redeem, human units (== $ payout at 1:1 before the settlement fee). */
  amount: number;
  /** Collateral decimals for this venue (6 for testnet tUSDC, 18 for mainnet USDso) — read from the market, don't hard-code. */
  decimals: number;
}

// Winners redeem 1 collateral per contract (minus a settlement fee, currently
// zero on dreamDEX); a voided market pays both sides 0.5. Either way this is
// an explicit claim — DreamDEX does not push payouts to a wallet automatically.
export async function redeemPosition(exchange: SomniaMarkets, args: RedeemArgs): Promise<TxResult> {
  return exchange.trader.redeem({
    marketId: args.marketId,
    market: args.marketAddress,
    outcomeIdx: args.outcome === "YES" ? 0 : 1,
    amount: fromHuman(args.amount, args.decimals),
  });
}
