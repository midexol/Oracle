import type {
  DreamDexClient,
  DreamDexEventHandlers,
  DreamDexMarket,
  OrderBook,
  OrderStatus,
  PlaceOrderRequest,
  PlaceOrderResult,
  PublicTrade,
} from '../types.js';
import { upstreamError } from '../../lib/errors.js';

/**
 * Real DreamDEX client - the seam where the Bot Kit gets wired in.
 *
 * Deliberately unimplemented rather than guessed. The PRD flags settlement as
 * the one area not to hand-wave, and the same applies to the exact order and
 * event signatures: writing plausible-looking calls against an API we have not
 * read would produce code that compiles, demos in mock mode, and fails the
 * moment it meets the real exchange.
 *
 * TO IMPLEMENT (each maps to one method below):
 *
 *  1. Market data      - REST list/detail endpoints for Event Contracts, plus
 *                        the WebSocket channels for order book and trades.
 *                        Fan incoming messages into `this.handlers` via the
 *                        same onQuote / onTrade callbacks the mock emits.
 *
 *  2. Order execution  - the current `placeOrder` entry point. Note the Bot
 *                        Kit removed `placeTakerOrderWithoutVault` in the
 *                        June 2026 upgrade; do not reintroduce it. Orders are
 *                        wallet-funded with auto-pull/auto-delivery by default.
 *
 *  3. Fill verification- subscribe to the on-chain `OrderFilled` event on
 *                        Somnia Shannon (chain 50312) with viem's
 *                        `watchContractEvent`, and emit onOrderFilled. The kit
 *                        treats this, not the REST trade feed, as
 *                        authoritative for fill / PnL / inventory.
 *
 *  4. Settlement       - the open question. Inspect the Event Contract's
 *                        settlement/finalisation interface and its events,
 *                        then emit onMarketSettled. Everything downstream -
 *                        the resolver, reputation, leaderboard - already works
 *                        off that single event, so this is the only piece that
 *                        has to change once the interface is known.
 *
 * Until then DREAMDEX_MODE=mock runs the whole product end to end.
 */
export class LiveDreamDexClient implements DreamDexClient {
  readonly mode = 'live' as const;

  private handlers: DreamDexEventHandlers[] = [];
  private connected = false;

  constructor(
    private readonly config: {
      restUrl?: string;
      wsUrl?: string;
      apiKey?: string;
      rpcUrl: string;
      chainId: number;
      exchangeAddress?: string;
    },
  ) {}

  async start(): Promise<void> {
    if (!this.config.restUrl || !this.config.wsUrl) {
      throw upstreamError(
        'DREAMDEX_MODE=live requires DREAMDEX_REST_URL and DREAMDEX_WS_URL. ' +
          'Set DREAMDEX_MODE=mock to run against the simulator.',
      );
    }
    throw notImplemented('start');
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribe(handlers: DreamDexEventHandlers): () => void {
    this.handlers.push(handlers);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handlers);
    };
  }

  async listMarkets(): Promise<DreamDexMarket[]> {
    throw notImplemented('listMarkets');
  }

  async getMarket(_marketId: string): Promise<DreamDexMarket | null> {
    throw notImplemented('getMarket');
  }

  async getOrderBook(_marketId: string, _depth?: number): Promise<OrderBook | null> {
    throw notImplemented('getOrderBook');
  }

  async getRecentTrades(_marketId: string, _limit?: number): Promise<PublicTrade[]> {
    throw notImplemented('getRecentTrades');
  }

  async placeOrder(_req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    throw notImplemented('placeOrder');
  }

  async cancelOrder(_orderId: string): Promise<boolean> {
    throw notImplemented('cancelOrder');
  }

  async getOrder(_orderId: string): Promise<OrderStatus | null> {
    throw notImplemented('getOrder');
  }

  /**
   * Must return null only when the exchange is certain no such order exists.
   * Returning null on a transient lookup failure would let the reconciler
   * mark a real, funded order as FAILED - so surface errors, never swallow.
   */
  async getOrderByClientOrderId(_clientOrderId: string): Promise<OrderStatus | null> {
    throw notImplemented('getOrderByClientOrderId');
  }

  /** Available to the implementation once the transports are connected. */
  protected emit(fn: (h: DreamDexEventHandlers) => void) {
    for (const h of this.handlers) {
      try {
        fn(h);
      } catch {
        /* a subscriber must not break the transport */
      }
    }
  }
}

const notImplemented = (method: string) =>
  upstreamError(
    `LiveDreamDexClient.${method}() is not implemented yet - the DreamDEX Bot Kit ` +
      `has not been wired in. Run with DREAMDEX_MODE=mock.`,
  );
