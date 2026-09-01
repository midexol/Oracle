import {
  backPrediction,
  closeExchange,
  createExchange,
  getSettlement,
  listEventContracts,
  subscribeOrderBook,
  watchSettlement,
  type EventContract,
  type OrderBookSubscription,
  type SettlementSubscription,
} from '@signal/dreamdex-integration';
import type { SomniaMarkets } from '@somnia-chain/markets-sdk';
import type { Hex } from 'viem';
import type {
  Asset,
  DreamDexClient,
  DreamDexEventHandlers,
  DreamDexMarket,
  Duration,
  OrderBook,
  OrderStatus,
  PlaceOrderRequest,
  PlaceOrderResult,
  PublicTrade,
} from '../types.js';
import { upstreamError } from '../../lib/errors.js';

/**
 * Live DreamDEX client, backed by `@signal/dreamdex-integration`.
 *
 * Per CLAUDE.md, that package is the only thing in the monorepo allowed to
 * import `@somnia-chain/markets-sdk`; this class adapts it to the
 * DreamDexClient interface the rest of the backend is written against, so the
 * resolver, reputation engine and API never learn the difference between
 * `DREAMDEX_MODE=mock` and `live`.
 *
 * Three shape differences are handled here and nowhere else:
 *
 *  1. PRICES. The SDK quotes probabilities as fractions (0..1); Oracle stores
 *     integer cents. Converted at this boundary so nothing downstream has to
 *     remember which unit it is holding.
 *
 *  2. IDENTITY. A DreamDEX market is addressed by symbol
 *     ("BTC-95000-31DEC26/USDC"), not an opaque id. That symbol is what we
 *     persist as `markets.dreamdex_market_id`.
 *
 *  3. SETTLEMENT. Resolution is oracle-driven and automatic on Somnia; there
 *     is no event to subscribe to, so the package polls each open market and
 *     reports the flip. We start one watcher per open market and emit
 *     onMarketSettled, which is exactly what the resolver already consumes.
 */
export class LiveDreamDexClient implements DreamDexClient {
  readonly mode = 'live' as const;

  private exchange: SomniaMarkets | null = null;
  private handlers: DreamDexEventHandlers[] = [];
  private connected = false;

  private books = new Map<string, OrderBookSubscription>();
  private settlements = new Map<string, SettlementSubscription>();
  private discoverTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: {
      /** How often to look for newly-opened contracts. */
      discoverIntervalMs?: number;
      /** Order-book depth to stream per market. */
      depth?: number;
      /** Max slippage past the best opposite price, as a fraction. */
      slippage?: number;
    } = {},
  ) {}

  async start(): Promise<void> {
    if (this.connected) return;

    // Network, indexer URL, addresses and DRY_RUN all come from the
    // integration package's own config, so there is one source of truth for
    // them rather than two competing sets of env vars.
    this.exchange = createExchange();
    this.connected = true;

    await this.discover();
    const every = this.config.discoverIntervalMs ?? 30_000;
    this.discoverTimer = setInterval(() => {
      void this.discover().catch((err) => this.emit((h) => h.onError?.(err)));
    }, every);
    this.discoverTimer.unref?.();

    this.emit((h) => h.onStatusChange?.(true));
  }

  async stop(): Promise<void> {
    if (this.discoverTimer) clearInterval(this.discoverTimer);
    this.discoverTimer = null;

    for (const sub of this.books.values()) sub.stop();
    for (const sub of this.settlements.values()) sub.stop();
    this.books.clear();
    this.settlements.clear();

    if (this.exchange) await closeExchange(this.exchange).catch(() => undefined);
    this.exchange = null;
    this.connected = false;
    this.emit((h) => h.onStatusChange?.(false));
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
    const contracts = await listEventContracts(this.requireExchange());
    return contracts.map((c) => toMarket(c));
  }

  async getMarket(marketId: string): Promise<DreamDexMarket | null> {
    const contracts = await listEventContracts(this.requireExchange());
    const found = contracts.find((c) => c.symbol === marketId);
    if (!found) return null;

    // The contract list carries the live quote but not the resolved outcome,
    // so read settlement separately and merge it in.
    const settlement = await getSettlement(this.requireExchange(), marketId as Hex);
    return toMarket(found, settlement);
  }

  async getOrderBook(marketId: string, depth = 10): Promise<OrderBook | null> {
    const exchange = this.requireExchange();
    // The book is only ever quoted on the YES side; DOWN is its complement.
    const book = await exchange.fetchOrderBook(`${marketId}#YES`, depth).catch(() => null);
    if (!book) return null;

    return {
      marketId,
      bids: (book.bids ?? []).map(([price, size]) => ({
        priceCents: toCents(price),
        quantity: String(size),
      })),
      asks: (book.asks ?? []).map(([price, size]) => ({
        priceCents: toCents(price),
        quantity: String(size),
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Not available through the integration package.
   *
   * The SDK exposes the signer's OWN fills (`watchMyTrades`), which is what
   * fill verification uses, but Oracle's public tape would need a market-wide
   * trade feed. Returning [] rather than throwing: a market page missing its
   * "recent trades" strip should degrade, not 500.
   */
  async getRecentTrades(_marketId: string, _limit?: number): Promise<PublicTrade[]> {
    return [];
  }

  /**
   * "Back this prediction" — a taker order on the corresponding outcome.
   *
   * Note what is NOT here: `clientOrderId`. The SDK has no field to echo one
   * back, so there is no exchange-side dedup on retry. Idempotency is
   * therefore enforced entirely by the unique `trades.idempotency_key` in our
   * own database, which is why that column exists and why the API asks
   * clients for an Idempotency-Key header.
   */
  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const exchange = this.requireExchange();

    // The package sizes orders in dollars, matching the PRD's "$10" control;
    // our interface carries a contract quantity, so convert back.
    const priceCents = req.priceCents ?? 50;
    const usdStake = Number(req.quantity) * (priceCents / 100);

    try {
      const result = await backPrediction(exchange, {
        symbol: req.marketId,
        side: req.side,
        usdStake,
        slippage: this.config.slippage ?? 0.02,
      });

      // DRY_RUN is on by default in the integration package's config. Surface
      // that as an explicit failure rather than reporting a phantom fill.
      if ('dryRun' in result) {
        return {
          orderId: '',
          clientOrderId: req.clientOrderId,
          status: 'FAILED',
          filledQuantity: '0',
          averagePriceCents: toCents(result.referencePrice),
          txHash: null,
          failureReason:
            'DreamDEX integration is in DRY_RUN mode - no order was sent. Set DRY_RUN=false to trade for real.',
        };
      }

      return {
        orderId: String(result.id),
        clientOrderId: req.clientOrderId,
        status: mapOrderStatus(result.status),
        filledQuantity: String(result.filled ?? 0),
        averagePriceCents: result.price != null ? toCents(result.price) : null,
        txHash: result.txHash ?? null,
      };
    } catch (err) {
      return {
        orderId: '',
        clientOrderId: req.clientOrderId,
        status: 'FAILED',
        filledQuantity: '0',
        averagePriceCents: null,
        txHash: null,
        failureReason: err instanceof Error ? err.message : 'Order submission failed',
      };
    }
  }

  /**
   * The SDK's cancelOrder needs the tradable symbol as well as the id, which
   * our interface does not carry - so find the order among the signer's open
   * orders first and take the symbol from there.
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const exchange = this.requireExchange();
    const open = await exchange.fetchOpenOrders();
    const match = open.find((o) => o.id === orderId);
    if (!match) return false;

    await exchange.cancelOrder(orderId, match.symbol);
    return true;
  }

  /**
   * Order lookup for the reconciler.
   *
   * The SDK exposes `fetchOpenOrders`, not a fetch-by-id, and that asymmetry
   * matters here. If the order is still resting we can report it exactly. If
   * it is absent we cannot distinguish "filled and closed" from "never
   * existed" - and those demand opposite actions on real money.
   *
   * So we throw rather than return null. The reconciler treats a throw as
   * transient and leaves the trade PENDING, which is the safe direction to be
   * wrong in: a position that shows as pending can be repaired, one wrongly
   * marked FAILED has already lied to the user about their money.
   *
   * To close this properly, add a fetch-by-id to
   * `@signal/dreamdex-integration` that can positively report a closed order.
   */
  async getOrder(orderId: string): Promise<OrderStatus | null> {
    const exchange = this.requireExchange();
    const open = await exchange.fetchOpenOrders();
    const match = open.find((o) => o.id === orderId);

    if (!match) {
      throw upstreamError(
        `Order ${orderId} is not among the open orders, and DreamDEX exposes no ` +
          `fetch-by-id - cannot tell a filled order from an unknown one. ` +
          `Leaving the trade untouched.`,
      );
    }

    const priceCents = match.price != null ? toCents(match.price) : 50;
    return {
      orderId: match.id,
      clientOrderId: '',
      marketId: match.symbol.replace(/#(YES|NO)$/, ''),
      side: match.symbol.endsWith('#NO') ? 'DOWN' : 'UP',
      quantity: String(match.amount),
      status: mapOrderStatus(match.status),
      filledQuantity: String(match.filled ?? 0),
      averagePriceCents: priceCents,
      txHash: match.txHash ?? null,
    };
  }

  /**
   * Unavailable, and not fakeable: the SDK accepts no client order id, so
   * there is nothing on the exchange side carrying our id to look up. This is
   * also why `trades.idempotency_key` is enforced in our own database rather
   * than delegated to the exchange.
   */
  async getOrderByClientOrderId(_clientOrderId: string): Promise<OrderStatus | null> {
    throw notExposed(
      'getOrderByClientOrderId',
      'a lookup keyed by our own id - the SDK accepts no client order id today, so this ' +
        'likely means correlating on wallet + symbol + timestamp',
    );
  }

  // ---------------------------------------------------------------- internals

  /** Find newly-opened contracts and attach book + settlement watchers. */
  private async discover(): Promise<void> {
    const exchange = this.requireExchange();
    const contracts = await listEventContracts(exchange);

    for (const contract of contracts) {
      const market = toMarket(contract);

      if (market.status !== 'OPEN') continue;

      if (!this.books.has(contract.symbol)) {
        this.books.set(
          contract.symbol,
          subscribeOrderBook(
            exchange,
            `${contract.symbol}#YES`,
            (book) => {
              const best = book.bids?.[0]?.[0] ?? book.asks?.[0]?.[0];
              if (best == null) return;
              const upPriceCents = toCents(best);
              this.emit((h) =>
                h.onQuote?.({
                  marketId: contract.symbol,
                  upPriceCents,
                  downPriceCents: 100 - upPriceCents,
                  timestamp: new Date().toISOString(),
                }),
              );
            },
            this.config.depth ?? 10,
          ),
        );
      }

      if (!this.settlements.has(contract.symbol)) {
        this.settlements.set(
          contract.symbol,
          watchSettlement(exchange, contract.symbol as Hex, (result) => {
            this.settlements.delete(contract.symbol);

            if (result.state === 'voided') {
              this.emit((h) => h.onMarketVoided?.(contract.symbol));
              return;
            }

            // KNOWN UNKNOWN (CLAUDE.md): YES == UP is assumed, not yet
            // confirmed against a real market's `question` field. If that
            // turns out to be inverted, every settled prediction flips - so
            // confirm before trusting a live leaderboard.
            this.emit((h) =>
              h.onMarketSettled?.({
                marketId: contract.symbol,
                outcome: result.winningOutcome === 'YES' ? 'UP' : 'DOWN',
                closingReference: null,
                settledAt: new Date().toISOString(),
              }),
            );
          }),
        );
      }
    }
  }

  private requireExchange(): SomniaMarkets {
    if (!this.exchange) {
      throw upstreamError('DreamDEX client is not started - call start() first');
    }
    return this.exchange;
  }

  private emit(fn: (h: DreamDexEventHandlers) => void) {
    for (const h of this.handlers) {
      try {
        fn(h);
      } catch {
        /* a subscriber must not break the transport */
      }
    }
  }
}

// -------------------------------------------------------------------- helpers

/** Probability fraction (0..1) -> integer cents, clamped to a tradeable 1..99. */
const toCents = (price: number): number =>
  Math.min(99, Math.max(1, Math.round(price * 100)));

function toMarket(
  contract: EventContract,
  settlement?: { state: 'pending' | 'resolved' | 'voided'; winningOutcome?: 'YES' | 'NO' },
): DreamDexMarket {
  const upPriceCents = contract.upPrice != null ? toCents(contract.upPrice) : 50;
  const closesAt = new Date(contract.expiry * 1000);

  let status: DreamDexMarket['status'] = mapMarketStatus(contract.status, closesAt);
  let outcome: DreamDexMarket['outcome'] = null;

  if (settlement?.state === 'voided') {
    status = 'CANCELLED';
  } else if (settlement?.state === 'resolved') {
    status = 'SETTLED';
    outcome = settlement.winningOutcome === 'YES' ? 'UP' : 'DOWN';
  }

  return {
    marketId: contract.symbol,
    asset: normalizeAsset(contract.asset),
    duration: inferDuration(contract),
    openingReference: null,
    closingReference: null,
    status,
    outcome,
    upPriceCents,
    downPriceCents: 100 - upPriceCents,
    opensAt: new Date().toISOString(),
    closesAt: closesAt.toISOString(),
    settledAt: status === 'SETTLED' ? new Date().toISOString() : null,
  };
}

const normalizeAsset = (asset: string): Asset => {
  const upper = asset.toUpperCase();
  return (['BTC', 'ETH', 'SOL', 'SOMI'] as const).includes(upper as Asset)
    ? (upper as Asset)
    : 'BTC';
};

function mapMarketStatus(status: string, closesAt: Date): DreamDexMarket['status'] {
  const s = status.toUpperCase();
  if (s.includes('RESOLV') || s.includes('SETTLED')) return 'SETTLED';
  if (s.includes('VOID') || s.includes('CANCEL')) return 'CANCELLED';
  if (closesAt.getTime() <= Date.now()) return 'CLOSED';
  return 'OPEN';
}

function mapOrderStatus(status: string | undefined): PlaceOrderResult['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'closed':
    case 'filled':
      return 'FILLED';
    case 'canceled':
    case 'cancelled':
      return 'CANCELLED';
    case 'rejected':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/**
 * Map a contract onto Oracle's duration buckets.
 *
 * MODELLING GAP, flagged rather than papered over: real DreamDEX Event
 * Contracts are strike-and-expiry based ("BTC-95000-31DEC26"), while the PRD
 * assumes rolling tenors ("BTC 15M"). Per-segment reputation - the
 * "BTC 15M accuracy: 81%" that makes the feed persuasive - depends on this
 * bucketing being meaningful, so it needs a product decision, not a guess.
 * Time-to-expiry is the least-wrong stand-in until then.
 */
function inferDuration(contract: EventContract): Duration {
  const msToExpiry = contract.expiry * 1000 - Date.now();
  const minutes = msToExpiry / 60_000;

  if (minutes <= 3) return '1M';
  if (minutes <= 10) return '5M';
  if (minutes <= 40) return '15M';
  if (minutes <= 150) return '1H';
  if (minutes <= 600) return '4H';
  return '1D';
}

const notExposed = (method: string, suggestion: string) =>
  upstreamError(
    `LiveDreamDexClient.${method}() is unavailable: @signal/dreamdex-integration ` +
      `does not export an order-lookup API yet. Add ${suggestion} to that package ` +
      `and delegate to it here.`,
  );
