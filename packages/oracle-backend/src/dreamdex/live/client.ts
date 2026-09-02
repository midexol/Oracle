import {
  backPrediction,
  cancelOrderById,
  closeExchange,
  createExchange,
  getOrder as fetchOrderById,
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
  private contracts = new Map<string, EventContract>();
  private contractsFetchedAt = 0;

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

    // The indexed row already carries the resolution, so no extra call is
    // needed in the common case. Only fall back to an on-chain read when the
    // indexer has not caught up yet.
    if (found.winningOutcome != null || found.voided) return toMarket(found);
    if (!found.marketId) return toMarket(found);

    // NOTE: settlement reads take the bytes32 marketId, NOT the symbol. They
    // are different identifiers; passing the symbol here silently fails.
    const settlement = await getSettlement(this.requireExchange(), found.marketId).catch(
      () => null,
    );
    return toMarket(found, settlement ?? undefined);
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

    // Which outcome token means "up" is a property of this market's question,
    // not a constant. Reading it from the contract keeps a "will X close
    // BELOW y?" market from routing every UP order into the losing side.
    const contract = await this.findContract(req.marketId);

    try {
      const result = await backPrediction(exchange, {
        symbol: req.marketId,
        side: req.side,
        usdStake,
        slippage: this.config.slippage ?? 0.02,
        upOutcome: contract?.upOutcome ?? 'YES',
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
        status: mapOrderStatus(result.status, result.filled, result.amount),
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
    return cancelOrderById(this.requireExchange(), orderId);
  }

  /**
   * Order lookup for the reconciler.
   *
   * Backed by the indexer's full order history, not just resting orders, so
   * an absent order is a positive "no such order" rather than the ambiguous
   * "not currently open". That distinction is what lets the reconciler mark a
   * dead order FAILED without risking abandoning a live position.
   */
  async getOrder(orderId: string): Promise<OrderStatus | null> {
    const match = await fetchOrderById(this.requireExchange(), orderId);
    if (!match) return null;
    return toOrderStatus(match);
  }

  /**
   * Unavailable, and not fakeable: the SDK accepts no client order id, so
   * nothing on the exchange side carries our id to look up. This is exactly
   * why `trades.idempotency_key` is enforced in our own database rather than
   * delegated to the exchange.
   *
   * Throwing (not returning null) is deliberate — the reconciler treats a
   * throw as transient and leaves the trade PENDING, whereas null would let
   * it eventually mark a possibly-live order FAILED.
   */
  async getOrderByClientOrderId(_clientOrderId: string): Promise<OrderStatus | null> {
    throw notExposed(
      'getOrderByClientOrderId',
      'a lookup keyed by our own id - the SDK accepts no client order id, so this would ' +
        'mean correlating on wallet + symbol + timestamp',
    );
  }

  // ---------------------------------------------------------------- internals

  /** Find newly-opened contracts and attach book + settlement watchers. */
  private async discover(): Promise<void> {
    const exchange = this.requireExchange();
    const contracts = await listEventContracts(exchange);
    this.contracts = new Map(contracts.map((c) => [c.symbol, c]));
    this.contractsFetchedAt = Date.now();

    // A market whose question we could not parse is one where UP/DOWN may be
    // inverted - which would flip every prediction on it. Surface it loudly
    // rather than letting it settle silently.
    for (const c of contracts) {
      if (c.upOutcomeAssumed && c.status !== 'unknown') {
        this.emit((h) =>
          h.onError?.(
            new Error(
              `Cannot tell which outcome means UP for ${c.symbol} (question: ` +
                `"${c.question || 'none'}") - assuming YES==UP. Confirm before trusting ` +
                `settled results on this market.`,
            ),
          ),
        );
      }
    }

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

      // Settlement reads take the bytes32 market id. A market we cannot
      // address that way cannot be watched, and silently skipping it would
      // strand every prediction on it - so say so.
      if (!contract.marketId) {
        this.emit((h) =>
          h.onError?.(
            new Error(
              `Contract ${contract.symbol} has no on-chain marketId; settlement cannot be watched`,
            ),
          ),
        );
        continue;
      }

      if (!this.settlements.has(contract.symbol)) {
        const marketId = contract.marketId;
        this.settlements.set(
          contract.symbol,
          watchSettlement(exchange, marketId, (result) => {
            this.settlements.delete(contract.symbol);

            if (result.state === 'voided') {
              this.emit((h) => h.onMarketVoided?.(contract.symbol));
              return;
            }

            // Which outcome token means UP is a property of this market's
            // question, resolved by the integration package. Assuming YES==UP
            // globally would invert every prediction on a "will X close
            // BELOW y?" contract.
            this.emit((h) =>
              h.onMarketSettled?.({
                marketId: contract.symbol,
                outcome: result.winningOutcome === contract.upOutcome ? 'UP' : 'DOWN',
                closingReference: contract.strike,
                settledAt: new Date().toISOString(),
              }),
            );
          }),
        );
      }
    }
  }

  /**
   * One contract by symbol, from a short-lived cache.
   *
   * `listEventContracts` fetches a ticker per market, so calling it on the
   * order path would put an N-request round trip in front of every trade. The
   * fields we need from it - upOutcome, marketId, strike - are immutable for
   * the life of a contract, so a brief cache costs nothing in correctness.
   */
  private async findContract(symbol: string): Promise<EventContract | null> {
    const fresh = Date.now() - this.contractsFetchedAt < CONTRACT_CACHE_MS;
    if (!fresh || !this.contracts.has(symbol)) {
      const contracts = await listEventContracts(this.requireExchange());
      this.contracts = new Map(contracts.map((c) => [c.symbol, c]));
      this.contractsFetchedAt = Date.now();
    }
    return this.contracts.get(symbol) ?? null;
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
/** Contract metadata is immutable, so this only bounds staleness of new listings. */
const CONTRACT_CACHE_MS = 30_000;

const toCents = (price: number): number =>
  Math.min(99, Math.max(1, Math.round(price * 100)));

export function toMarket(
  contract: EventContract,
  settlement?: { state: 'pending' | 'resolved' | 'voided'; winningOutcome?: 'YES' | 'NO' },
): DreamDexMarket {
  const upPriceCents = contract.upPrice != null ? toCents(contract.upPrice) : 50;
  const opensAt = contract.tradingStart > 0 ? new Date(contract.tradingStart * 1000) : new Date();
  const closesAt = new Date(contract.expiry * 1000);

  let status: DreamDexMarket['status'] = mapMarketStatus(contract.status, closesAt);
  let outcome: DreamDexMarket['outcome'] = null;
  let settledAt: string | null = contract.resolvedAt
    ? new Date(contract.resolvedAt * 1000).toISOString()
    : null;

  // Prefer the indexed resolution; fall back to an explicit on-chain read.
  // `winningOutcome` is 0 = YES, 1 = NO; which of those is UP depends on the
  // market's own question, so compare against contract.upOutcome.
  const upIsYes = contract.upOutcome === 'YES';

  if (contract.voided || settlement?.state === 'voided') {
    status = 'CANCELLED';
  } else if (contract.winningOutcome != null) {
    status = 'SETTLED';
    outcome = (contract.winningOutcome === 0) === upIsYes ? 'UP' : 'DOWN';
    settledAt ??= new Date().toISOString();
  } else if (settlement?.state === 'resolved') {
    status = 'SETTLED';
    outcome = settlement.winningOutcome === contract.upOutcome ? 'UP' : 'DOWN';
    settledAt ??= new Date().toISOString();
  }

  return {
    marketId: contract.symbol,
    asset: normalizeAsset(contract.asset),
    duration: inferDuration(contract),
    // The strike is the level the question resolves against - exactly what
    // the PRD calls the opening reference.
    openingReference: contract.strike,
    closingReference: null,
    status,
    outcome,
    upPriceCents,
    downPriceCents: 100 - upPriceCents,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    settledAt: status === 'SETTLED' ? settledAt : null,
  };
}

function toOrderStatus(order: {
  id: string;
  symbol: string;
  price?: number;
  amount: number;
  filled: number;
  status: string;
  txHash?: string;
}): OrderStatus {
  return {
    orderId: order.id,
    clientOrderId: '',
    marketId: order.symbol.replace(/#(YES|NO)$/, ''),
    side: order.symbol.endsWith('#NO') ? 'DOWN' : 'UP',
    quantity: String(order.amount),
    status: mapOrderStatus(order.status, order.filled, order.amount),
    filledQuantity: String(order.filled ?? 0),
    averagePriceCents: order.price != null ? toCents(order.price) : null,
    txHash: order.txHash ?? null,
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

/**
 * Map an SDK order state onto Oracle's.
 *
 * The fill quantity is part of the decision, not decoration. The SDK's
 * vocabulary is "open" | "closed" | "canceled" | "expired", and none of those
 * words say whether anything actually traded - "closed" covers both a
 * complete fill and an order that left the book having done nothing.
 *
 * Two rules:
 *  - Any TERMINAL state with a fill is FILLED. The position is real and final;
 *    `filledQuantity` carries its true size, and PnL is computed from that, so
 *    a partially-filled-then-cancelled order settles for exactly what it got.
 *  - Any terminal state with no fill is CANCELLED.
 *
 * The reconciler polls PENDING and PARTIALLY_FILLED, so mapping a terminal
 * state into either of those would leave it polling that order forever - which
 * is what "expired" did before it was handled here.
 */
export function mapOrderStatus(
  status: string | undefined,
  filled = 0,
  amount = 0,
): PlaceOrderResult['status'] {
  const hasFill = filled > 0;

  switch ((status ?? '').toLowerCase()) {
    case 'open':
      return hasFill ? 'PARTIALLY_FILLED' : 'PENDING';
    case 'closed':
    case 'filled':
      return hasFill || amount === 0 ? 'FILLED' : 'CANCELLED';
    case 'canceled':
    case 'cancelled':
    case 'expired':
      return hasFill ? 'FILLED' : 'CANCELLED';
    case 'rejected':
      return 'FAILED';
    default:
      // An unrecognised state is not evidence of anything terminal. Staying
      // PENDING keeps the order under reconciliation rather than declaring an
      // outcome we cannot support.
      return hasFill ? 'PARTIALLY_FILLED' : 'PENDING';
  }
}

/**
 * Map a contract onto Oracle's duration buckets.
 *
 * Measured across the contract's OWN window (tradingStart -> expiry), which is
 * its real tenor and is fixed for the life of the market. An earlier version
 * used time-remaining, which meant the same contract drifted 1H -> 15M -> 1M
 * as it aged, scattering one market's calls across three different segments
 * and corrupting the per-segment accuracy the feed is sold on.
 *
 * Still an approximation: real Event Contracts are strike-and-expiry
 * ("BTC-95000-31DEC26"), while the PRD assumes rolling tenors ("BTC 15M").
 * Bucketing by window length is the faithful reading of that, but if the live
 * venue turns out to list only long-dated contracts, the product needs to
 * decide what "BTC 15M accuracy" should mean rather than have this guess.
 */
export function inferDuration(contract: EventContract): Duration {
  const windowMinutes =
    contract.tradingStart > 0 && contract.expiry > contract.tradingStart
      ? (contract.expiry - contract.tradingStart) / 60
      : (contract.expiry * 1000 - Date.now()) / 60_000;

  if (windowMinutes <= 3) return '1M';
  if (windowMinutes <= 10) return '5M';
  if (windowMinutes <= 40) return '15M';
  if (windowMinutes <= 150) return '1H';
  if (windowMinutes <= 600) return '4H';
  return '1D';
}

const notExposed = (method: string, suggestion: string) =>
  upstreamError(
    `LiveDreamDexClient.${method}() is unavailable: @signal/dreamdex-integration ` +
      `does not export an order-lookup API yet. Add ${suggestion} to that package ` +
      `and delegate to it here.`,
  );
