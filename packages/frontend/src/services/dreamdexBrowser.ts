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

/** Switches (or, if unrecognized, registers) the wallet onto Somnia testnet. */
async function ensureChain(provider: EIP1193Provider) {
  const { chain } = loadConfig();
  const hexChainId = `0x${chain.id.toString(16)}`;

  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (currentChainId === hexChainId) return chain;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (switchError: any) {
    // 4902: wallet doesn't know this chain yet - register it, then retry the
    // switch (some wallets auto-switch after adding; others don't).
    if (switchError?.code === 4902) {
      await provider.request({
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
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
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
    return await backPrediction(exchange, {
      symbol,
      side,
      usdStake,
      upOutcome,
      dryRun: false,
    });
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
