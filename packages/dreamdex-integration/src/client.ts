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
  return new SomniaMarkets({
    indexerUrl: config.indexerUrl,
    chain: config.chain,
    wsRpcUrl: config.wsRpcUrl,
    addresses: config.addresses,
    ...signer,
  });
}

export async function closeExchange(exchange: SomniaMarkets): Promise<void> {
  await exchange.close();
}
