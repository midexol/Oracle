import type { SomniaMarkets, UnifiedMarket, UnifiedTicker } from "@somnia-chain/markets-sdk";
import type { Hex } from "viem";

// Oracle only cares about BTC/ETH Event Contracts (binary UP/DOWN markets),
// not DreamDEX's spot or perp books.
const TRACKED_ASSETS = new Set(["BTC", "ETH"]);

/**
 * Which outcome token corresponds to the price going UP.
 *
 * NOT a constant. A binary market is only "YES == UP" if its question is
 * phrased that way — "Will BTC close ABOVE $95,000?" is, "Will BTC close
 * BELOW $95,000?" is the exact inverse. Getting this backwards silently
 * inverts every settled prediction and every reputation score derived from
 * them, so it is resolved per market from the question text rather than
 * assumed globally.
 */
export type UpOutcome = "YES" | "NO";

export interface EventContract {
  /** Canonical market symbol, e.g. "BTC-95000-31DEC26/USDC". Use with placeOrder/watchOrderBook. */
  symbol: string;
  /**
   * The on-chain bytes32 market id. This — NOT the symbol — is what
   * settlement reads take. They are different identifiers and are not
   * interchangeable.
   */
  marketId: Hex | null;
  /** "BTC" | "ETH". */
  asset: string;
  /** Display question, e.g. "Will BTC close above $95,000 on 31 Dec 2026?". */
  question: string;
  /** Strike the question resolves against, in the oracle's raw price scale. */
  strike: string | null;
  upPrice: number | null;
  downPrice: number | null;
  status: string;
  /** Unix seconds trading opens. */
  tradingStart: number;
  /** Unix seconds trading ends. */
  expiry: number;
  /**
   * Which outcome token means "price went UP" for THIS market, derived from
   * its question. See {@link resolveUpOutcome} for what happens when the
   * phrasing cannot be read.
   */
  upOutcome: UpOutcome;
  /** True when the question's phrasing could not be parsed and a default was assumed. */
  upOutcomeAssumed: boolean;
  /** 0 = YES, 1 = NO. Null until resolved. */
  winningOutcome: number | null;
  voided: boolean;
  /** Unix seconds the market resolved at; null until resolved. */
  resolvedAt: number | null;
  info: UnifiedMarket;
}

export async function listEventContracts(exchange: SomniaMarkets): Promise<EventContract[]> {
  await exchange.loadMarkets();
  const binaryMarkets = Object.values(exchange.markets).filter(
    (m) => m.type === "binary" && TRACKED_ASSETS.has(assetOf(m.base)),
  );

  return Promise.all(
    binaryMarkets.map(async (m) => {
      const up = await safeTicker(exchange, `${m.symbol}#YES`);
      const binary = m.info.marketType === "BINARY" ? m.info : null;
      const question = binary?.question ?? binary?.oracleQuestion ?? "";
      const { outcome: upOutcome, assumed: upOutcomeAssumed } = resolveUpOutcome(question);

      // The book only ever quotes YES; the other side is its complement. Which
      // of those is "UP" depends on the question, hence upOutcome.
      const yesPrice = up?.last ?? null;
      const upPrice =
        yesPrice == null ? null : upOutcome === "YES" ? yesPrice : 1 - yesPrice;

      return {
        symbol: m.symbol,
        marketId: binary?.marketId ?? null,
        asset: assetOf(m.base),
        question,
        strike: binary?.strike ?? null,
        upPrice,
        downPrice: upPrice == null ? null : 1 - upPrice,
        status: binary?.status ?? "unknown",
        tradingStart: binary ? Number(binary.tradingStart) : 0,
        expiry: binary ? Number(binary.expiry) : 0,
        upOutcome,
        upOutcomeAssumed,
        winningOutcome: binary?.winningOutcome ?? null,
        voided: binary?.voided ?? false,
        resolvedAt: binary?.resolvedAtTimestamp ? Number(binary.resolvedAtTimestamp) : null,
        info: m,
      };
    }),
  );
}

export async function getEventContract(
  exchange: SomniaMarkets,
  symbol: string,
): Promise<EventContract | undefined> {
  const contracts = await listEventContracts(exchange);
  return contracts.find((c) => c.symbol === symbol);
}

/**
 * Work out which outcome token means "up" from the market's question.
 *
 * Deliberately conservative: only phrasings that are unambiguous produce a
 * confident answer. Anything else returns `assumed: true` so the caller can
 * warn rather than quietly bake a coin-flip into everyone's track record.
 *
 * The "below" check runs first because a question can legitimately contain
 * both words ("will it close below the high?"), and the comparator nearest
 * the strike is the one that decides the outcome.
 */
export function resolveUpOutcome(question: string): { outcome: UpOutcome; assumed: boolean } {
  const q = question.toLowerCase();
  if (!q.trim()) return { outcome: "YES", assumed: true };

  const down = /\b(below|under|beneath|less than|lower than|drops?|falls?|decreases?|down)\b/;
  const up = /\b(above|over|exceeds?|greater than|higher than|at least|rises?|reach(?:es)?|climbs?|increases?|up)\b/;

  const downAt = q.search(down);
  const upAt = q.search(up);

  if (downAt === -1 && upAt === -1) return { outcome: "YES", assumed: true };
  if (downAt === -1) return { outcome: "YES", assumed: false };
  if (upAt === -1) return { outcome: "NO", assumed: false };

  // Both present: the earlier comparator is the one governing the strike.
  return downAt < upAt ? { outcome: "NO", assumed: false } : { outcome: "YES", assumed: false };
}

/** "BTC-95000-31DEC26" -> "BTC". Falls back to the whole base if unhyphenated. */
function assetOf(base: string): string {
  return base.split("-")[0] ?? base;
}

async function safeTicker(exchange: SomniaMarkets, ref: string): Promise<UnifiedTicker | null> {
  try {
    return await exchange.fetchTicker(ref);
  } catch {
    // No fills yet on a fresh market — not an error, just no "last" price.
    return null;
  }
}
