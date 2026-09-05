/**
 * Non-custodial trade execution: the user's own wallet signs the order, in
 * the browser. Oracle's backend never sees or holds a key that can move
 * funds — see CLAUDE.md's "Decision: no custom smart contract" section.
 *
 * This is the only file in packages/frontend that touches
 * @signal/dreamdex-integration (and, through it, the DreamDEX SDK) — nothing
 * else in the frontend should import either directly.
 */
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import {
  backPrediction,
  claimTestFunds,
  closeExchange,
  createExchange,
  loadConfig,
  type PredictionSide,
} from "@signal/dreamdex-integration";

// Fixed for the hackathon build (see loadConfig()) - safe to read once at
// module load so the UI can show the expected network's name without
// round-tripping through the wallet first.
export const EXPECTED_CHAIN = loadConfig().chain;

// `collateral` is the current field name, `testUsdc` its legacy alias -
// SOMNIA_TESTNET_ADDRESSES always sets both today, but fall back just in
// case a future config only sets one.
const testUsdcAddress = loadConfig().addresses.collateral ?? loadConfig().addresses.testUsdc;
if (!testUsdcAddress) throw new Error("No collateral/testUsdc address configured for this network");

/** Watch-asset params for TestUSDC - most wallets (MetaMask, Rabby, ...) only
 * auto-discover a chain's native gas token, not arbitrary ERC-20s, so a
 * freshly-faucet'd balance is otherwise invisible until a user adds this
 * manually. */
export const TEST_USDC_TOKEN = {
  address: testUsdcAddress,
  symbol: "tUSDC",
  decimals: 6,
} as const;

/**
 * Some mobile wallet in-app browsers (Rabby's included) occasionally never
 * surface the native prompt for a `provider.request()` call - the promise
 * then never resolves or rejects, and the caller hangs forever with no
 * feedback. Every wallet-facing request in this module goes through this so
 * a silent wallet fails loudly instead of leaving the UI stuck on "Confirm
 * the signature in your wallet..." indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Prompts the wallet's own "Add token" dialog (EIP-747) for TestUSDC. */
export async function addTestUsdcToWallet(provider: EIP1193Provider) {
  return provider.request({
    method: "wallet_watchAsset",
    params: {
      type: "ERC20",
      options: TEST_USDC_TOKEN,
    },
  } as any);
}

/** Switches (or, if unrecognized, registers) the wallet onto Somnia testnet. */
export async function ensureChain(provider: EIP1193Provider) {
  const { chain } = loadConfig();
  const hexChainId = `0x${chain.id.toString(16)}`;

  const currentChainId = await withTimeout(
    provider.request({ method: "eth_chainId" }),
    10_000,
    "Wallet didn't respond to a network check - try again",
  );
  if (currentChainId === hexChainId) return chain;

  try {
    await withTimeout(
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      }),
      60_000,
      "Wallet didn't respond to the network switch prompt - open your wallet app and try again",
    );
  } catch (switchError: any) {
    // 4902: wallet doesn't know this chain yet - register it, then retry the
    // switch (some wallets auto-switch after adding; others don't).
    if (switchError?.code === 4902) {
      await withTimeout(
        provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexChainId,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [...(chain.rpcUrls.default.http ?? [])],
              blockExplorerUrls: chain.blockExplorers?.default
                ? [chain.blockExplorers.default.url]
                : undefined,
            },
          ],
        }),
        60_000,
        "Wallet didn't respond to the add-network prompt - open your wallet app and try again",
      );
      await withTimeout(
        provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChainId }],
        }),
        60_000,
        "Wallet didn't respond to the network switch prompt - open your wallet app and try again",
      );
    } else {
      throw switchError;
    }
  }
  return chain;
}

export interface WalletTradeParams {
  address: `0x${string}`;
  symbol: string;
  side: PredictionSide;
  usdStake: number;
  upOutcome?: "YES" | "NO";
}

/** Builds a signer-bound exchange over the connected browser wallet, switching it to Somnia testnet if needed. */
async function buildExchange(address: `0x${string}`) {
  const provider = window.ethereum as EIP1193Provider | undefined;
  if (!provider) throw new Error("No wallet provider found");

  const chain = await ensureChain(provider);

  const walletClient = createWalletClient({
    account: address,
    chain,
    transport: custom(provider),
  });

  return createExchange({ walletClient });
}

/**
 * Builds a viem WalletClient over the connected browser wallet, switches it
 * to Somnia testnet if needed, and submits a real market order. Every step
 * from here on prompts the wallet for a signature - nothing is pre-signed
 * or relayed through Oracle's backend.
 */
export async function placeWalletTrade({
  address,
  symbol,
  side,
  usdStake,
  upOutcome,
}: WalletTradeParams) {
  const exchange = await buildExchange(address);
  try {
    return await withTimeout(
      backPrediction(exchange, {
        symbol,
        side,
        usdStake,
        upOutcome,
        dryRun: false,
      }),
      90_000,
      "Wallet didn't respond to the signature request - open your wallet app and try again",
    );
  } finally {
    await closeExchange(exchange);
  }
}

export type FaucetClaimResult = { status: "claimed"; txHash: string } | { status: "already-claimed" };

/**
 * Mints test tUSDC to the connected wallet via TestUSDC's own permissionless
 * faucet() - mint-to-self only, so this never touches funds on Oracle's
 * behalf. The contract enforces its own per-address cap (reverts with
 * FaucetCapExceeded), which is treated as a normal, expected outcome rather
 * than an error - most repeat callers will hit it.
 *
 * Still a real signed transaction: the wallet will prompt once, and it needs
 * native gas already in the wallet to submit (see the Somnia faucet link in
 * the UI for that - Oracle only automates the token side).
 */
export async function claimTestnetFunds(address: `0x${string}`): Promise<FaucetClaimResult> {
  const exchange = await buildExchange(address);
  try {
    const result = await claimTestFunds(exchange);
    return { status: "claimed", txHash: result.hash };
  } catch (err: any) {
    const chain = [err, err?.cause, err?.cause?.cause, err?.cause?.cause?.cause];
    const alreadyClaimed = chain.some(
      (e) => typeof e?.message === "string" && e.message.includes("FaucetCapExceeded"),
    );
    if (alreadyClaimed) return { status: "already-claimed" };
    throw err;
  } finally {
    await closeExchange(exchange);
  }
}
