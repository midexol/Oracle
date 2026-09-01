# @signal/dreamdex-integration

The DreamDEX-facing layer for Oracle. Everything else (backend, frontend)
calls into this package instead of touching `@somnia-chain/markets-sdk`
directly. Built against the real SDK (`@somnia-chain/markets-sdk@0.28.1`) and
the [dreamdex-bot-kit](https://github.com/somnia-chain/dreamdex-bot-kit) /
[docs.dreamdex.io](https://docs.dreamdex.io/developers/event-contracts) — see
`src/*.ts` doc comments for the specific source of each design choice.

Somnia Shannon testnet only for now (chain `50312`).

## Setup

```bash
npm install
cp .env.example .env   # keep NETWORK=testnet and DRY_RUN=true
```

## Modules

| File | Job |
|---|---|
| `client.ts` | Builds a `SomniaMarkets` exchange instance. Market-data reads need no signer; order placement/redemption need one. |
| `markets.ts` | Discovers live BTC/ETH event contracts (`listEventContracts`) and their current UP/DOWN price. |
| `orderbook.ts` | Live order-book stream for a market, for the feed/market pages. |
| `placeOrder.ts` | `backPrediction()` — "Back This Prediction": a taker market order, sized from a `$` stake. |
| `fills.ts` | Confirms a trade actually happened, from the signer's own on-chain fills (not the laggier REST feed). |
| `settlement.ts` | Reads whether a market has resolved/voided and to which outcome. Resolution itself is oracle-driven and automatic on DreamDEX's side — this only observes the flip. |
| `redeem.ts` | Claims payout for a settled position. Winnings are never pushed automatically. |

## Signer model — read this before wiring up the backend

`createOrder`/`redeem` need a signer on the exchange config: `walletClient`
(a connected wallet, signed in the browser) or `privateKey` (a raw key, for
scripts/tests only). Oracle's PRD is explicit that **users connect their own
wallet** — so the intended flow is:

1. Backend/server code uses a signer-less exchange (`createExchange()`) for
   all market data (`markets.ts`, `orderbook.ts`, `settlement.ts`).
2. The actual `backPrediction()` / `redeemPosition()` calls happen **in the
   browser**, using the exchange built from the user's own `walletClient` —
   never a backend-held key. A backend private key would make Oracle
   custodial, which the PRD's architecture doesn't call for.

If the team decides Oracle should stage/broadcast orders server-side instead
(e.g. relayed transactions), that's a real design conversation to have
explicitly — flag it before building against it.

## Known unknowns (verify against a live market before trusting)

- **`VENUE_ID`**: per the bot kit's docs, this changed three times in the
  first week of August 2026. Don't hardcode it — read it off a live market row.
- **UP/DOWN → YES/NO mapping**: this package assumes YES == UP (since the
  question is framed as "will $ASSET finish UP?"). Confirm against one real
  market's `question`/`oracleQuestion` field before relying on it — the docs
  note the question wording itself has changed multiple times.
- **Testnet collateral decimals**: tUSDC is 6dp on testnet vs 18dp
  (USDso) on mainnet. Always read `decimals` off the market/collateral token,
  never hard-code — `redeem.ts` takes `decimals` as an explicit argument for
  this reason.
