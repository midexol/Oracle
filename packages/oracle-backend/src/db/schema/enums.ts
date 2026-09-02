import { pgEnum } from 'drizzle-orm/pg-core';

/** Which way a market can resolve, and which way a user called it. */
export const directionEnum = pgEnum('direction', ['UP', 'DOWN']);

/** Underlying asset of an Event Contract. Extend as DreamDEX lists more. */
export const assetEnum = pgEnum('asset', ['BTC', 'ETH', 'SOL', 'SOMI']);

/** Contract duration. Mirrors DreamDEX Event Contract tenors. */
export const durationEnum = pgEnum('duration', ['1M', '5M', '15M', '1H', '4H', '1D']);

/**
 * Market lifecycle.
 *  OPEN      - accepting orders and predictions
 *  CLOSED    - past cutoff, awaiting on-chain settlement
 *  SETTLED   - outcome known and recorded
 *  CANCELLED - voided by the exchange; predictions become VOID, not LOST
 */
export const marketStatusEnum = pgEnum('market_status', ['OPEN', 'CLOSED', 'SETTLED', 'CANCELLED']);

/**
 * Prediction lifecycle. VOID exists so a cancelled market never damages
 * a predictor's accuracy — it is excluded from every stat.
 */
export const predictionStatusEnum = pgEnum('prediction_status', ['PENDING', 'WON', 'LOST', 'VOID']);

/** Order lifecycle on DreamDEX, as observed by Oracle. */
export const tradeStatusEnum = pgEnum('trade_status', [
  'PENDING',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'FAILED',
]);

/**
 * Why a trade exists. This is the attribution that proves Oracle drives
 * DreamDEX volume rather than merely displaying it.
 *  BACK_PREDICTION - user backed another user's prediction from the feed
 *  OWN_PREDICTION  - user staked their own call
 *  DIRECT          - user traded from the market page without a prediction
 *  BATTLE          - user backed a side of a prediction battle
 */
export const tradeSourceEnum = pgEnum('trade_source', [
  'BACK_PREDICTION',
  'OWN_PREDICTION',
  'DIRECT',
  'BATTLE',
]);

export const battleStatusEnum = pgEnum('battle_status', ['LIVE', 'SETTLED', 'VOID']);
