import "dotenv/config";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { SOMNIA_TESTNET_ADDRESSES, type SomniaMarketsAddresses } from "@somnia-chain/markets-sdk";
import type { Chain } from "viem";

export interface DreamDexConfig {
  chain: Chain;
  indexerUrl: string;
  wsRpcUrl: string;
  addresses: SomniaMarketsAddresses;
  dryRun: boolean;
}

// Oracle only targets Somnia Shannon testnet for the hackathon build. Mainnet
// (chain 5031, SOMNIA_MAINNET_ADDRESSES) is a config swap away when we're ready
// — see the dreamdex-bot-kit docs/getting-started.md for the mainnet values.
export function loadConfig(): DreamDexConfig {
  const network = process.env.NETWORK ?? "testnet";
  if (network !== "testnet") {
    throw new Error(`Unsupported NETWORK "${network}" — only "testnet" is wired up so far`);
  }
  return {
    chain: somniaShannon,
    indexerUrl: process.env.DREAMDEX_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
    wsRpcUrl: process.env.DREAMDEX_WS_RPC_URL ?? "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    dryRun: process.env.DRY_RUN !== "false",
  };
}
