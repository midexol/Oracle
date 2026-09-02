# Oracle

**Social prediction + trading network for DreamDEX Event Contracts.**

Oracle turns DreamDEX Event Contracts into a social prediction game: users
discover predictions, back them with real trades, compete for reputation, and
build a verifiable track record.

A prediction here is not a post. It is attached to a real Event Contract, and
"Back this prediction" places an actual DreamDEX order — which is what closes
the loop:

```
prediction -> DreamDEX trade -> outcome -> reputation -> competition -> more trading
```

## Packages

This is an npm workspaces monorepo.

| Package | What it owns |
|---|---|
| [`packages/dreamdex-integration`](packages/dreamdex-integration) | The only place that talks to `@somnia-chain/markets-sdk`: markets, order book, order placement, fills, settlement, redemption. |
| [`packages/oracle-backend`](packages/oracle-backend) | REST + WebSocket API, Postgres schema, settlement pipeline, and the reputation / leaderboard engine. |
| [`packages/frontend`](packages/frontend) | Next.js UI — feed, market, prediction detail, profiles, battles, leaderboard. |

Nothing outside `dreamdex-integration` should import the Somnia SDK directly.
See [`CLAUDE.md`](CLAUDE.md) for why Oracle deploys no contract of its own.

## Quick start

```bash
npm install

# Backend needs a Postgres URL and a JWT secret.
cp packages/oracle-backend/.env.example packages/oracle-backend/.env

npm run db:migrate
npm run db:seed        # optional: a populated feed and leaderboard
npm run dev            # API on http://localhost:4000
```

The backend runs against a built-in DreamDEX simulator by default
(`DREAMDEX_MODE=mock`), so the whole product — predictions, orders, fills,
settlement, reputation — works end to end without network access or testnet
funds. Point it at the real exchange by setting `DREAMDEX_MODE=live`.

## Commands

Run from the repo root; each delegates to the right workspace.

| Command | Does |
|---|---|
| `npm run dev` | Backend in watch mode |
| `npm run build` | Build every package |
| `npm run typecheck` | Typecheck every package |
| `npm test` | Unit tests across all packages |
| `npm run test:integration` | Backend tests against a real Postgres (boots a throwaway one automatically) |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Seed demo predictors, markets and history |

## Network

Somnia Shannon testnet (chain `50312`). Order placement defaults to
`DRY_RUN=true` — set `DRY_RUN=false` to send real transactions.
