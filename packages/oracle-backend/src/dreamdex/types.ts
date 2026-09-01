/**
 * The DreamDEX integration boundary.
 *
 * Every part of Oracle that touches the exchange goes through this interface
 * and nothing else. That gives us two things:
 *
 *  1. The entire backend — predictions, resolver, reputation, leaderboard —
 *     is buildable and testable today against the simulator, before the Bot
 *     Kit is wired in.
 *  2. Swapping in the real SDK is a single file (`live/client.ts`) rather
 *     than a refactor, because no route or job imports the SDK directly.
 *
 * Shape notes: prices are integer cents (1..99) to match Event Contract
 * quoting; quantities are decimal strings to avoid float drift on money.
 */

export type Direction = 'UP' | 'DOWN';
export type Asset = 'BTC' | 'ETH' | 'SOL' | 'SOMI';
export type Duration = '1M' | '5M' | '15M' | '1H' | '4H' | '1D';

export interface DreamDexMarket {
  /** Exchange-side identifier. The join key for our `markets` table. */
  marketId: string;
  asset: Asset;
  duration: Duration;
  /** Strike the contract settles against. */
  openingReference: string | null;
  closingReference: string | null;
  status: 'OPEN' | 'CLOSED' | 'SETTLED' | 'CANCELLED';
  /** Only present once settled. */
  outcome: Direction | null;
  upPriceCents: number;
  downPriceCents: number;
  opensAt: string;
  closesAt: string;
  settledAt: string | null;
}

export interface OrderBookLevel {
  priceCents: number;
  quantity: string;
}

export interface OrderBook {
  marketId: string;
  /** Bids/asks for the UP contract. DOWN is the mirror: 100 - price. */
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}

export interface PublicTrade {
  tradeId: string;
  marketId: string;
  side: Direction;
  priceCents: number;
  quantity: string;
  timestamp: string;
}

export interface PlaceOrderRequest {
  marketId: string;
  side: Direction;
  /** Limit price in cents. Omit for a marketable order at the best offer. */
  priceCents?: number;
  quantity: string;
  /** The Oracle user's wallet — the account the order settles against. */
  walletAddress: string;
  /** Our own id, echoed back so we can reconcile duplicates idempotently. */
  clientOrderId: string;
}

export interface PlaceOrderResult {
  orderId: string;
  clientOrderId: string;
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'FAILED';
  filledQuantity: string;
  averagePriceCents: number | null;
  txHash: string | null;
  failureReason?: string;
}

export interface OrderStatus extends PlaceOrderResult {
  marketId: string;
  side: Direction;
  quantity: string;
}

/**
 * An on-chain fill. DreamDEX's kit is explicit that the OrderFilled event —
 * not the REST trade feed — is the authoritative source for fill, PnL and
 * inventory, so this is what the fill watcher trusts.
 */
export interface OrderFilledEvent {
  orderId: string;
  marketId: string;
  walletAddress: string;
  side: Direction;
  priceCents: number;
  quantity: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
}

export interface MarketSettledEvent {
  marketId: string;
  outcome: Direction;
  closingReference: string | null;
  settledAt: string;
}

export interface QuoteUpdateEvent {
  marketId: string;
  upPriceCents: number;
  downPriceCents: number;
  timestamp: string;
}

export interface DreamDexEventHandlers {
  onQuote?: (e: QuoteUpdateEvent) => void;
  onTrade?: (e: PublicTrade) => void;
  onOrderFilled?: (e: OrderFilledEvent) => void;
  onMarketSettled?: (e: MarketSettledEvent) => void;
  /** A contract was cancelled: nobody's record should be affected by it. */
  onMarketVoided?: (marketId: string) => void;
  onMarketOpened?: (m: DreamDexMarket) => void;
  onStatusChange?: (connected: boolean) => void;
  /** Transport-level failure. Reported, never thrown at the subscriber. */
  onError?: (err: unknown) => void;
}

export interface DreamDexClient {
  readonly mode: 'mock' | 'live';

  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;

  listMarkets(): Promise<DreamDexMarket[]>;
  getMarket(marketId: string): Promise<DreamDexMarket | null>;
  getOrderBook(marketId: string, depth?: number): Promise<OrderBook | null>;
  getRecentTrades(marketId: string, limit?: number): Promise<PublicTrade[]>;

  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOrder(orderId: string): Promise<OrderStatus | null>;

  /**
   * Look an order up by the id WE assigned it.
   *
   * This is the recovery path. If Oracle crashes between calling placeOrder
   * and persisting the exchange's order id, we are left with a trade row that
   * has no dreamdexOrderId - but a real, funded order may exist on the
   * exchange. The client order id is the only handle we still hold, so
   * without this the reconciler cannot tell "never submitted" from
   * "submitted, response lost", and would have to guess about real money.
   */
  getOrderByClientOrderId(clientOrderId: string): Promise<OrderStatus | null>;

  /** Returns an unsubscribe function. */
  subscribe(handlers: DreamDexEventHandlers): () => void;
}
