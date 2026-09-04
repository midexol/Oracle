import { fromHuman, type SomniaMarkets, type TxResult } from "@somnia-chain/markets-sdk";

export interface ClaimTestFundsArgs {
  /** Amount to mint, human units of the venue's collateral (tUSDC). Defaults to the contract's own default (10,000). */
  amount?: number;
  /** Collateral decimals for this venue (6 for testnet tUSDC) — only needed if `amount` is passed. */
  decimals?: number;
}

// TestUSDC's faucet() is permissionless and mints to whoever calls it, so
// this can only ever mint into the connected wallet's own address - Oracle
// never touches the tokens. The contract enforces its own per-address cap
// (reverts with FaucetCapExceeded once claimed), so no extra bookkeeping is
// needed here beyond surfacing that revert to the caller.
export async function claimTestFunds(exchange: SomniaMarkets, args: ClaimTestFundsArgs = {}): Promise<TxResult> {
  const amount = args.amount != null ? fromHuman(args.amount, args.decimals ?? 6) : undefined;
  return exchange.trader.faucet(amount != null ? { amount } : {});
}
