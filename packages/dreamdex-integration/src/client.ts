import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import type { Account, Hex, WalletClient } from "viem";
import { loadConfig } from "./config.js";

// A market-data exchange never needs a signer — safe to run anywhere (the
// feed, the market page, backend polling). Order placement/redemption needs
// one of these; prefer `walletClient` (the user's own connected wallet,
// signed in the browser) over `privateKey`, which should only ever be a
// dedicated ops/test key, never something that custodies user funds.
export interface ExchangeSigner {
  privateKey?: Hex;
  account?: Account;
  walletClient?: WalletClient;
}

export function createExchange(signer?: ExchangeSigner): SomniaMarkets {
  const config = loadConfig();
  const exchange = new SomniaMarkets({
    indexerUrl: config.indexerUrl,
    chain: config.chain,
    wsRpcUrl: config.wsRpcUrl,
    addresses: config.addresses,
    ...signer,
  });

  // The SDK synthesizes each binary market's trading symbol from the
  // collateral token's on-chain symbol() read, falling back to a truncated
  // address (e.g. "70A86D") whenever that RPC call fails - which Somnia's
  // testnet RPC does often enough that the SAME market has been observed
  // synthesizing to two different symbols across calls (confirmed via two
  // DB rows for one market: "ETH-0-05SEP26/tUSDC" vs ".../70A86D"). A wallet
  // that resolves a stale symbol at trade time then gets "unknown symbol"
  // from the SDK, surfaced to the user as a generic, misleading "signature
  // rejected" error.
  //
  // `currencies` is a real, mutable field at runtime (unified/exchange.js:
  // `currencies = new Map();`, no `#` private-field syntax) - the SDK's own
  // .d.ts marks it `private` to keep it out of the public API surface, not
  // because it's inaccessible, so this cast is a deliberate, narrow escape
  // hatch rather than a type-safety bug. Pre-seeding it makes loadMarkets()
  // skip the on-chain read entirely for our own venue's collateral, so
  // every exchange instance (backend's long-lived one and every fresh
  // browser one) synthesizes the exact same symbol, every time, regardless
  // of RPC health.
  const collateral = config.addresses.collateral ?? config.addresses.testUsdc;
  if (collateral) {
    (exchange as unknown as { currencies: Map<string, { code: string; decimals: number }> }).currencies.set(
      collateral.toLowerCase(),
      { code: "tUSDC", decimals: 6 },
    );
  }

  return exchange;
}

export async function closeExchange(exchange: SomniaMarkets): Promise<void> {
  await exchange.close();
}
