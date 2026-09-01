import type { SomniaMarkets, UnifiedMarket, UnifiedTicker } from "@somnia-chain/markets-sdk";

// Oracle only cares about BTC/ETH Event Contracts (binary UP/DOWN markets),
// not DreamDEX's spot or perp books.
const TRACKED_ASSETS = new Set(["BTC", "ETH"]);

export interface EventContract {
  /** Canonical market symbol, e.g. "BTC-95000-31DEC26/USDC". Use with placeOrder/watchOrderBook. */
  symbol: string;
  /** "BTC" | "ETH". */
  asset: string;
  upPrice: number | null;
  downPrice: number | null;
  status: string;
  expiry: number;
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
      return {
        symbol: m.symbol,
        asset: assetOf(m.base),
        upPrice: up?.last ?? null,
        // The book only ever quotes YES/Up; Down is the complement.
        // See docs/architecture.md in dreamdex-bot-kit: "Down price = 1 − Up price".
        downPrice: up?.last != null ? 1 - up.last : null,
        status: m.info.marketType === "BINARY" ? m.info.status : "unknown",
        expiry: m.info.marketType === "BINARY" ? Number(m.info.expiry) : 0,
        info: m,
      };
    }),
  );
}

export async function getEventContract(exchange: SomniaMarkets, symbol: string): Promise<EventContract | undefined> {
  const contracts = await listEventContracts(exchange);
  return contracts.find((c) => c.symbol === symbol);
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
