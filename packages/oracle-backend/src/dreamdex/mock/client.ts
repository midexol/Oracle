import { randomUUID } from 'node:crypto';
import type {
  Asset,
  Direction,
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
import { probabilityToCents, stepSpot, upProbability } from './pricing.js';

const DURATION_SECONDS: Record<Duration, number> = {
  '1M': 60,
  '5M': 300,
  '15M': 900,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

/**
 * Starting spot and annualised vol per asset. Vol is deliberately high so
 * short-dated contracts actually move within a demo.
 */
const ASSET_PARAMS: Record<Asset, { spot: number; vol: number }> = {
  BTC: { spot: 96_400, vol: 0.55 },
  ETH: { spot: 3_420, vol: 0.7 },
  SOL: { spot: 198, vol: 0.95 },
  SOMI: { spot: 0.82, vol: 1.4 },
};

/** The contract series the simulator keeps rolling. */
const SERIES: Array<{ asset: Asset; duration: Duration }> = [
  { asset: 'BTC', duration: '15M' },
  { asset: 'BTC', duration: '1H' },
  { asset: 'ETH', duration: '15M' },
  { asset: 'ETH', duration: '1H' },
  { asset: 'SOL', duration: '15M' },
  { asset: 'SOMI', duration: '15M' },
];

interface SimMarket extends DreamDexMarket {
  strike: number;
  totalSeconds: number;
}

interface SimOrder extends OrderStatus {
  walletAddress: string;
  createdAt: number;
}

export interface MockClientOptions {
  /**
   * Wall-clock compression. A 15M contract at scale 20 settles in 45 seconds,
   * which is what makes the full loop - predict, back, settle, reputation
   * moves, leaderboard reorders - demoable inside a single sitting.
   * Set to 1 for real-time behaviour.
   */
  timeScale?: number;
  tickMs?: number;
  /** Seconds (unscaled) between a market closing and its settlement event. */
  settlementDelaySeconds?: number;
}

/**
 * In-process DreamDEX simulator.
 *
 * Implements the full DreamDexClient contract: rolling Event Contract series,
 * converging binary prices, an order book, marketable order execution with
 * simulated on-chain OrderFilled events, and settlement.
 *
 * Nothing here touches the network, so the API, resolver and reputation engine
 * can be built and demoed before the Bot Kit is wired in.
 */
export class MockDreamDexClient implements DreamDexClient {
  readonly mode = 'mock' as const;

  private markets = new Map<string, SimMarket>();
  private orders = new Map<string, SimOrder>();
  private clientOrderIndex = new Map<string, string>();
  private trades = new Map<string, PublicTrade[]>();
  private spot: Record<Asset, number>;
  private handlers: DreamDexEventHandlers[] = [];
  private timer: NodeJS.Timeout | null = null;
  private connected = false;

  private readonly timeScale: number;
  private readonly tickMs: number;
  private readonly settlementDelayMs: number;

  constructor(opts: MockClientOptions = {}) {
    this.timeScale = opts.timeScale ?? 20;
    this.tickMs = opts.tickMs ?? 1000;
    this.settlementDelayMs = ((opts.settlementDelaySeconds ?? 3) * 1000) / this.timeScale;
    this.spot = Object.fromEntries(
      (Object.keys(ASSET_PARAMS) as Asset[]).map((a) => [a, ASSET_PARAMS[a].spot]),
    ) as Record<Asset, number>;
  }

  async start(): Promise<void> {
    if (this.connected) return;
    for (const s of SERIES) this.openMarket(s.asset, s.duration);
    this.connected = true;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    // Never keep the process alive purely for the simulator loop.
    this.timer.unref?.();
    this.emit((h) => h.onStatusChange?.(true));
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
    return [...this.markets.values()].map(toPublic);
  }

  async getMarket(marketId: string): Promise<DreamDexMarket | null> {
    const m = this.markets.get(marketId);
    return m ? toPublic(m) : null;
  }

  async getOrderBook(marketId: string, depth = 8): Promise<OrderBook | null> {
    const m = this.markets.get(marketId);
    if (!m) return null;

    // Synthesise a book around the current quote: deeper away from the touch,
    // which is roughly how these contracts sit.
    const mid = m.upPriceCents;
    const bids: OrderBook['bids'] = [];
    const asks: OrderBook['asks'] = [];
    for (let i = 0; i < depth; i++) {
      const bidPrice = mid - 1 - i;
      const askPrice = mid + 1 + i;
      if (bidPrice >= 1) bids.push({ priceCents: bidPrice, quantity: qty(120 / (i + 1)) });
      if (askPrice <= 99) asks.push({ priceCents: askPrice, quantity: qty(120 / (i + 1)) });
    }
    return { marketId, bids, asks, timestamp: new Date().toISOString() };
  }

  async getRecentTrades(marketId: string, limit = 30): Promise<PublicTrade[]> {
    return (this.trades.get(marketId) ?? []).slice(0, limit);
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    // Idempotency: one clientOrderId never produces two exchange orders, so a
    // retried HTTP request cannot double-spend the user's wallet.
    const existingId = this.clientOrderIndex.get(req.clientOrderId);
    if (existingId) return stripOrder(this.orders.get(existingId)!);

    const market = this.markets.get(req.marketId);
    if (!market) return failure(req, 'Unknown market');
    if (market.status !== 'OPEN') return failure(req, `Market is ${market.status}`);

    const quantity = Number(req.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return failure(req, 'Quantity must be a positive number');
    }

    const best = req.side === 'UP' ? market.upPriceCents : market.downPriceCents;
    const limitPrice = req.priceCents ?? best;
    // Each side is quoted as the cost of that side, so any limit at or above
    // the offer crosses. A limit below it rests on the book instead.
    const marketable = limitPrice >= best;

    const orderId = `dx_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const order: SimOrder = {
      orderId,
      clientOrderId: req.clientOrderId,
      marketId: req.marketId,
      side: req.side,
      quantity: req.quantity,
      status: 'PENDING',
      filledQuantity: '0',
      averagePriceCents: null,
      txHash: null,
      walletAddress: req.walletAddress.toLowerCase(),
      createdAt: Date.now(),
    };
    this.orders.set(orderId, order);
    this.clientOrderIndex.set(req.clientOrderId, orderId);

    if (marketable) {
      // Fill asynchronously, as a real exchange does: placeOrder returns
      // PENDING and the fill arrives later as an on-chain OrderFilled event.
      // The backend has to cope with that ordering, so the mock enforces it.
      const t = setTimeout(() => this.fillOrder(orderId, best), 400 + Math.random() * 600);
      t.unref?.();
    }

    return stripOrder(order);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order || order.status === 'FILLED' || order.status === 'CANCELLED') return false;
    order.status = 'CANCELLED';
    return true;
  }

  async getOrder(orderId: string): Promise<OrderStatus | null> {
    const o = this.orders.get(orderId);
    if (!o) return null;
    return { ...stripOrder(o), marketId: o.marketId, side: o.side, quantity: o.quantity };
  }

  async getOrderByClientOrderId(clientOrderId: string): Promise<OrderStatus | null> {
    const orderId = this.clientOrderIndex.get(clientOrderId);
    return orderId ? this.getOrder(orderId) : null;
  }

  // ---------------------------------------------------------------- internals

  private fillOrder(orderId: string, priceCents: number) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'PENDING') return;
    const market = this.markets.get(order.marketId);
    if (!market || market.status !== 'OPEN') {
      order.status = 'FAILED';
      return;
    }

    // A cent of slippage some of the time, as a taker would see.
    const fillPrice = Math.min(99, Math.max(1, priceCents + (Math.random() < 0.25 ? 1 : 0)));
    order.status = 'FILLED';
    order.filledQuantity = order.quantity;
    order.averagePriceCents = fillPrice;
    order.txHash = `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`.slice(
      0,
      66,
    );

    const filledAt = new Date().toISOString();
    this.emit((h) =>
      h.onOrderFilled?.({
        orderId,
        marketId: order.marketId,
        walletAddress: order.walletAddress,
        side: order.side,
        priceCents: fillPrice,
        quantity: order.quantity,
        txHash: order.txHash!,
        blockNumber: Math.floor(Date.now() / 1000),
        timestamp: filledAt,
      }),
    );

    this.recordTrade({
      tradeId: randomUUID(),
      marketId: order.marketId,
      side: order.side,
      priceCents: fillPrice,
      quantity: order.quantity,
      timestamp: filledAt,
    });
  }

  private tick() {
    const dt = (this.tickMs / 1000) * this.timeScale;
    const now = Date.now();

    // Advance each asset's spot once per tick so every contract on that asset
    // stays mutually consistent.
    for (const asset of Object.keys(this.spot) as Asset[]) {
      this.spot[asset] = stepSpot(this.spot[asset], ASSET_PARAMS[asset].vol, dt);
    }

    for (const market of [...this.markets.values()]) {
      if (market.status !== 'OPEN') continue;

      const closesAt = Date.parse(market.closesAt);
      if (now >= closesAt) {
        this.closeMarket(market);
        continue;
      }

      this.repriceMarket(market, (closesAt - now) / 1000);

      // Background flow so the trade tape is never empty.
      if (Math.random() < 0.25) {
        this.recordTrade({
          tradeId: randomUUID(),
          marketId: market.marketId,
          side: Math.random() < 0.5 ? 'UP' : 'DOWN',
          priceCents: market.upPriceCents,
          quantity: qty(5 + Math.random() * 60),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private repriceMarket(market: SimMarket, wallClockSecondsLeft: number) {
    const params = ASSET_PARAMS[market.asset];
    const spot = this.spot[market.asset];
    // Wall-clock time is compressed; convert back to the contract's own clock
    // so the vol term matches its nominal tenor.
    const contractSecondsLeft = wallClockSecondsLeft * this.timeScale;
    const p = upProbability(spot, market.strike, contractSecondsLeft, params.vol);
    const up = probabilityToCents(p);
    if (up === market.upPriceCents) return;

    market.upPriceCents = up;
    market.downPriceCents = 100 - up;
    this.emit((h) =>
      h.onQuote?.({
        marketId: market.marketId,
        upPriceCents: market.upPriceCents,
        downPriceCents: market.downPriceCents,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private closeMarket(market: SimMarket) {
    market.status = 'CLOSED';
    const closing = this.spot[market.asset];
    market.closingReference = closing.toFixed(8);

    const t = setTimeout(() => {
      const outcome: Direction = closing > market.strike ? 'UP' : 'DOWN';
      market.status = 'SETTLED';
      market.outcome = outcome;
      market.settledAt = new Date().toISOString();
      market.upPriceCents = outcome === 'UP' ? 99 : 1;
      market.downPriceCents = 100 - market.upPriceCents;

      this.emit((h) =>
        h.onMarketSettled?.({
          marketId: market.marketId,
          outcome,
          closingReference: market.closingReference,
          settledAt: market.settledAt!,
        }),
      );

      // Roll the series forward so the feed never runs dry.
      this.openMarket(market.asset, market.duration);
    }, this.settlementDelayMs);
    t.unref?.();
  }

  private openMarket(asset: Asset, duration: Duration): SimMarket {
    const now = Date.now();
    const totalSeconds = DURATION_SECONDS[duration];
    const wallClockMs = (totalSeconds * 1000) / this.timeScale;
    const strike = this.spot[asset];

    const market: SimMarket = {
      marketId: `${asset}-${duration}-${now}`,
      asset,
      duration,
      strike,
      totalSeconds,
      openingReference: strike.toFixed(8),
      closingReference: null,
      status: 'OPEN',
      outcome: null,
      upPriceCents: 50,
      downPriceCents: 50,
      opensAt: new Date(now).toISOString(),
      closesAt: new Date(now + wallClockMs).toISOString(),
      settledAt: null,
    };
    this.markets.set(market.marketId, market);
    this.trades.set(market.marketId, []);
    this.emit((h) => h.onMarketOpened?.(toPublic(market)));
    return market;
  }

  private recordTrade(trade: PublicTrade) {
    const list = this.trades.get(trade.marketId) ?? [];
    list.unshift(trade);
    if (list.length > 100) list.length = 100;
    this.trades.set(trade.marketId, list);
    this.emit((h) => h.onTrade?.(trade));
  }

  private emit(fn: (h: DreamDexEventHandlers) => void) {
    for (const h of this.handlers) {
      try {
        fn(h);
      } catch {
        // A misbehaving subscriber must never take down the simulator loop.
      }
    }
  }
}

const qty = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

function toPublic(m: SimMarket): DreamDexMarket {
  const { strike: _strike, totalSeconds: _totalSeconds, ...rest } = m;
  return rest;
}

function stripOrder(o: SimOrder): PlaceOrderResult {
  return {
    orderId: o.orderId,
    clientOrderId: o.clientOrderId,
    status: o.status,
    filledQuantity: o.filledQuantity,
    averagePriceCents: o.averagePriceCents,
    txHash: o.txHash,
  };
}

function failure(req: PlaceOrderRequest, reason: string): PlaceOrderResult {
  return {
    orderId: '',
    clientOrderId: req.clientOrderId,
    status: 'FAILED',
    filledQuantity: '0',
    averagePriceCents: null,
    txHash: null,
    failureReason: reason,
  };
}
