import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { prisma } from '../lib/prisma.js';
import { SettlementWorker } from '../workers/settlementWorker.js';

/**
 * Somnia Shannon Testnet (chain 50312) chain definition. viem doesn't ship
 * this chain built-in, so we define it inline.
 */
export const somniaTestnet = {
  id: 50312,
  name: 'Somnia Shannon Testnet',
  nativeCurrency: { name: 'Somnia Test Token', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.SOMNIA_RPC_URL ?? 'https://dream-rpc.somnia.network'] },
  },
} as const;

/**
 * NOTE: this event signature is illustrative — replace with the actual
 * DreamDEX Event Contract ABI once available. It assumes an event of the
 * shape `MarketResolved(bytes32 marketId, uint8 winningOutcome)` where
 * winningOutcome maps 0 -> DOWN, 1 -> UP.
 */
const marketResolvedEvent = parseAbiItem(
  'event MarketResolved(bytes32 marketId, uint8 winningOutcome)',
);

export interface StartListenerOptions {
  contractAddress: Address;
  onError?: (err: unknown) => void;
}

/**
 * Subscribes to DreamDEX `MarketResolved` events and pipes each one into
 * the settlement worker. Returns an unwatch() function for graceful shutdown.
 */
export function startSomniaResolutionListener({
  contractAddress,
  onError,
}: StartListenerOptions): () => void {
  const client = createPublicClient({
    chain: somniaTestnet,
    transport: http(),
  });

  const settlementWorker = new SettlementWorker(prisma);

  const unwatch = client.watchEvent({
    address: contractAddress,
    event: marketResolvedEvent,
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const { marketId, winningOutcome } = log.args;
          if (marketId === undefined || winningOutcome === undefined) continue;

          const direction = winningOutcome === 1 ? 'UP' : 'DOWN';
          const summary = await settlementWorker.resolveMarket(marketId, direction);

          // eslint-disable-next-line no-console
          console.log(
            `[somniaListener] resolved market ${summary.marketId}: ${summary.winners}W/${summary.losers}L`,
          );
        } catch (err) {
          onError?.(err);
        }
      }
    },
    onError,
  });

  return unwatch;
}
