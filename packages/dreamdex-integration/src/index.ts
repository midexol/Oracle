export { loadConfig, type DreamDexConfig } from "./config.js";
export { createExchange, closeExchange, type ExchangeSigner } from "./client.js";
export {
  listEventContracts,
  getEventContract,
  resolveUpOutcome,
  type EventContract,
  type UpOutcome,
} from "./markets.js";
export { subscribeOrderBook, type OrderBookSubscription } from "./orderbook.js";
export { backPrediction, type BackPredictionArgs, type PredictionSide } from "./placeOrder.js";
export { subscribeFills, type FillSubscription } from "./fills.js";
export { getSettlement, watchSettlement, type SettlementResult, type SettlementSubscription } from "./settlement.js";
export { getOrder, cancelOrderById } from "./orders.js";
export { redeemPosition, type RedeemArgs } from "./redeem.js";
