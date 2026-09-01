import type { SomniaMarkets, UnifiedOrder } from "@somnia-chain/markets-sdk";

/**
 * Look up one order by its on-chain id, across every lifecycle state.
 *
 * This exists for reconciliation. `fetchOpenOrders` alone is not enough: an
 * order that is absent from it might be filled, cancelled, or never have
 * existed, and those demand opposite responses when real money is involved.
 * `fetchOrders` is the indexer's full history, so an absence here is a
 * positive "no such order" rather than an ambiguous one.
 *
 * `symbol` narrows the query when known — worth passing, since the unscoped
 * call pages over the wallet's entire order history.
 */
export async function getOrder(
  exchange: SomniaMarkets,
  orderId: string,
  symbol?: string,
  lookback = 200,
): Promise<UnifiedOrder | null> {
  const orders = await exchange.fetchOrders(symbol, undefined, lookback);
  return orders.find((o) => o.id === orderId) ?? null;
}

/**
 * Cancel by id. The SDK needs the tradable symbol too, so callers that only
 * hold an id can let this find it among the wallet's open orders first.
 */
export async function cancelOrderById(
  exchange: SomniaMarkets,
  orderId: string,
): Promise<boolean> {
  const open = await exchange.fetchOpenOrders();
  const match = open.find((o) => o.id === orderId);
  if (!match) return false;

  await exchange.cancelOrder(orderId, match.symbol);
  return true;
}
