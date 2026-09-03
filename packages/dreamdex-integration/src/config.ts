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

// No `dotenv/config` import here on purpose: this package is imported from
// packages/frontend's browser bundle too (for wallet-signed trades), and a
// top-level side-effecting Node import would break that. Every consumer that
// needs .env loaded (oracle-backend today) already does it themselves before
// touching this module - see packages/oracle-backend/src/config/env.ts.
//
// `process` itself doesn't exist in a browser bundle either - every env read
// below has a working default, so treat a missing `process` the same as an
// unset var rather than crashing on import.
function env(key: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[key] : undefined;
}

// Oracle only targets Somnia Shannon testnet for the hackathon build. Mainnet
// (chain 5031, SOMNIA_MAINNET_ADDRESSES) is a config swap away when we're ready
// — see the dreamdex-bot-kit docs/getting-started.md for the mainnet values.
export function loadConfig(): DreamDexConfig {
  const network = env("NETWORK") ?? "testnet";
  if (network !== "testnet") {
    throw new Error(`Unsupported NETWORK "${network}" — only "testnet" is wired up so far`);
  }
  return {
    chain: somniaShannon,
    indexerUrl: env("DREAMDEX_INDEXER_URL") ?? "https://dev.smk.somnia.host/v1/graphql",
    wsRpcUrl: env("DREAMDEX_WS_RPC_URL") ?? "wss://api.infra.testnet.somnia.network/ws",
    addresses: SOMNIA_TESTNET_ADDRESSES,
    dryRun: env("DRY_RUN") !== "false",
  };
}
