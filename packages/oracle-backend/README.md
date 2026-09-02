# @signal/oracle-backend

Social prediction + trading network for **DreamDEX Event Contracts**.

> DreamDEX supplies the market. Oracle supplies the reason to come back and trade it.

A prediction here is not a post. It is a public, timestamped, **price-anchored** call on a real
Event Contract, and every "Back this prediction" tap ends in a real DreamDEX order attributed to
the predictor who caused it.

```
predict → back it with a real trade → market settles → reputation moves → leaderboard reorders
```

---

## Quick start

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL and JWT_SECRET
npm run db:migrate          # create the schema
npm run db:seed             # optional: demo predictors with real settled history
npm run dev --workspace=@signal/oracle-backend                 # http://localhost:4000
```

Two values in `.env` are required:

| Variable | Where to get it |
| --- | --- |
| `DATABASE_URL` | Neon or Supabase free tier — copy the connection string with `?sslmode=require` |
| `JWT_SECRET` | any 32+ char random string (`openssl rand -hex 32`) |

Everything else has a working default. `DREAMDEX_MODE=mock` runs the whole product against an
in-process simulator, so the backend is fully demoable before the Bot Kit is wired in.

Check it is alive:

```bash
curl localhost:4000/health
```

---

## What is built

| Area | Status |
| --- | --- |
| Wallet auth (challenge → signature → JWT) | done |
| Markets: mirror, list, detail, order book, tape, price history | done |
| Predictions: create, feed, detail, receipt | done |
| Trading: back-a-prediction and direct, with on-chain fill reconciliation | done |
| Settlement pipeline + safety-net sweep | done |
| Reputation engine: accuracy, score, edge, ROI, streaks, per-segment | done |
| Leaderboards: overall, filtered, influence | done |
| Follows, battles schema | done |
| Realtime WebSocket push | done |
| **Live DreamDEX SDK** | **stubbed — see below** |

---

## The DreamDEX boundary

Every call to the exchange goes through one interface, [`DreamDexClient`](src/dreamdex/types.ts),
and nothing else in the codebase imports the SDK. Two implementations sit behind it:

- **`mock`** ([src/dreamdex/mock/](src/dreamdex/mock/)) — a real simulator, not a stub. Rolling
  Event Contract series, binary option pricing that converges to 1¢/99¢ at expiry, an order book,
  asynchronous fills that arrive as simulated on-chain `OrderFilled` events, and settlement.
- **`live`** ([src/dreamdex/live/client.ts](src/dreamdex/live/client.ts)) — an adapter over
  [`@signal/dreamdex-integration`](../dreamdex-integration), which is the only package permitted
  to import `@somnia-chain/markets-sdk`.

`MOCK_TIME_SCALE=20` compresses the clock, so a "15M" contract settles in ~45 seconds and you can
watch the entire loop — predict, back, settle, reputation move, leaderboard reorder — inside one
sitting.

### Three shape differences the adapter absorbs

The SDK and Oracle disagree about three things, and all three are reconciled in
`live/client.ts` so nothing downstream has to know:

1. **Prices.** The SDK quotes probabilities as fractions (`0.43`); Oracle stores integer cents
   (`43`).
2. **Identity.** A market has *two* identifiers: the trading symbol
   (`BTC-95000-31DEC26/USDC`, used for orders and books) and an on-chain `bytes32` marketId
   (used for settlement reads). They are not interchangeable — passing the symbol to a
   settlement read silently fails.
3. **Orientation.** Whether the YES token means "up" depends on the market's own question.
   `"Will BTC close above $95,000?"` → YES is UP; `"…below…"` → YES is DOWN. This is resolved
   per market from the question text ([`resolveUpOutcome`](../dreamdex-integration/src/markets.ts)),
   not assumed. A market whose phrasing cannot be parsed is logged loudly rather than guessed at,
   because getting it backwards inverts every settled prediction with no error anywhere.

### Known gaps in live mode

- **`getOrderByClientOrderId` is not implementable.** The SDK accepts no client order id, so
  there is nothing exchange-side carrying ours. This is exactly why idempotency is enforced by
  the unique `trades.idempotency_key` in our own database instead of being delegated to the
  exchange. The reconciler treats the resulting error as transient and leaves such a trade
  `PENDING` — the safe direction to fail.
- **`getRecentTrades` returns empty.** The SDK exposes the signer's *own* fills, not a public
  tape. The market page degrades rather than erroring.
- **Duration buckets are approximate.** Real contracts are strike-and-expiry
  (`BTC-95000-31DEC26`); the PRD assumes rolling tenors (`BTC 15M`). Duration is derived from the
  contract's own window (`tradingStart → expiry`), which is stable for its lifetime — but if the
  live venue lists only long-dated contracts, "BTC 15M accuracy" needs a product decision rather
  than this approximation.
- **Live mode has never been run against the real testnet.** Everything here is verified against
  the simulator and the SDK's published types.

---

## The reputation engine

Three layers, all derived from `predictions`:

| Module | Answers |
| --- | --- |
| [`scoring.ts`](src/analytics/scoring.ts) | How good is this predictor? (Wilson, edge, ROI, streaks) |
| [`confidence.ts`](src/analytics/confidence.ts) | How much should you believe that, and are they good *right now*? |
| [`leaderboard.ts`](src/analytics/leaderboard.ts) | How do they compare? |

`confidence.ts` adds the two things a single career number cannot express: a
**Bayesian credible interval** on the true win rate (Jeffreys prior, so 2-for-2
and 200-for-200 stop looking identical), and a **momentum** score — an EWMA
over recent calls, deliberately fast-moving so a predictor going cold is
visible before their lifetime accuracy notices. Its incomplete-beta
implementation is tested against closed forms, not just against itself.

[`src/analytics/`](src/analytics/) — `predictions` is the source of truth; `user_stats` and
`user_segment_stats` are a rebuildable cache of it.

### Prediction Score

The headline 0–100 number is the **Wilson score interval lower bound** on accuracy.

This is the most important choice in the system. Raw accuracy makes a leaderboard useless — someone
who called one market and got it right sits at 100%, above a predictor who is 47-for-63. Wilson
asks the better question: *given this record, what is the pessimistic estimate of their true hit
rate?* Evidence climbs the board, luck does not.

| Record | Raw accuracy | Prediction Score |
| --- | --- | --- |
| 1 / 1 | 100% | 21 |
| 2 / 2 | 100% | 34 |
| 47 / 63 | 74.6% | 63 |
| 700 / 1000 | 70.0% | 67 |
| 20 / 20 | 100% | 84 |

It is a standard statistic, not a bespoke formula, which is what keeps it explainable to a user.

### Edge — difficulty adjustment

`entry_price_cents` records what the market charged for the side the user chose, at the moment they
chose it. A contract at 43¢ is the market saying "43%". So:

```
edge = mean( outcome(1 or 0) − entry_price/100 )
```

Positive edge means the predictor beats the market's own price. Calling UP at 43¢ and being right
is genuinely harder than calling UP at 85¢, and this is the number that says so. `roi` is its
economic twin — what that skill was worth per contract in cents.

Try it on the seeded data:

```bash
curl 'localhost:4000/api/v1/leaderboard'              # flatline ranks well
curl 'localhost:4000/api/v1/leaderboard?sort=edge'    # flatline drops — accurate, no edge
```

### Attribution

`trades.backed_prediction_id` / `backed_user_id` record **why** each order happened. That answers
the question the exchange actually cares about — how much DreamDEX volume Oracle originated, and
which predictors originated it — via `/stats/attribution` and `/leaderboard/influence`.

---

## API

Base path `/api/v1`. Auth is `Authorization: Bearer <token>`.
Errors are always `{ "error": { "code", "message", "details? } }`.

### Auth

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/challenge` | — | `{ walletAddress }` → `{ nonce, message }`; sign `message` with `personal_sign` |
| `POST` | `/auth/verify` | — | `{ walletAddress, nonce, signature }` → `{ token, user }` |
| `GET` | `/auth/me` | ✔ | Current user + reputation |

### Feed & predictions

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/feed` | optional | **Page 1: Home.** `?asset&duration&direction&scope=all\|following&includeSettled&limit&cursor` |
| `POST` | `/predictions` | ✔ | `{ marketId, direction, stake?, rationale? }` — one call per user per market |
| `GET` | `/predictions/:id` | — | **Page 3: Prediction detail** |
| `GET` | `/predictions/:id/receipt` | — | Flat, share-card-shaped projection |

Each feed item carries the predictor's overall accuracy **and** their accuracy on that exact
`(asset, duration)` — the number that makes the card persuasive — plus a `backersCount`.

### Markets

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/markets` | — | `?status&asset&duration&limit`, soonest expiry first |
| `GET` | `/markets/:id` | — | **Page 2: Market.** Contract, live book, tape, chart history, who is predicting what, sentiment split. Accepts internal UUID or DreamDEX id |

### Trading

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/trades` | ✔ | Back a call: `{ backedPredictionId, amountUsd }`. Direct: `{ marketId, side, amountUsd }` |
| `GET` | `/trades/me` | ✔ | Order history |
| `GET` | `/stats/attribution` | — | Platform-level DreamDEX volume Oracle originated |

Pass exactly one of `amountUsd` or `quantity`. Backing does not let the caller choose a side — it
comes from the prediction. Returns `201` with the order typically `PENDING`; the fill arrives
asynchronously and is pushed over the WebSocket.

**Send an `Idempotency-Key` header.** It is optional, and omitting it means a retried request —
a double-tap, a flaky connection, an automatic client retry — places a *second real, funded
order*. With a key, the replay returns the original trade. Keys are scoped per user, and
uniqueness is enforced by the database, so two concurrent requests carrying the same key cannot
both reach the exchange. DreamDEX itself offers no client-order-id dedup, so this is the only
protection there is.

Rate limits: `POST /trades` 30/min, `POST /predictions` 60/min, `POST /auth/challenge` 20/min;
everything else 300/min.

### Profiles & social

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/users/:handle` | optional | **Page 4 / 7.** UUID, username or wallet. Stats, rank, specialties, active calls, results |
| `GET` | `/users/:handle/influence` | — | Volume this predictor's calls drove |
| `PATCH` | `/users/me` | ✔ | `{ username?, avatarUrl?, bio? }` |
| `POST` / `DELETE` | `/users/:id/follow` | ✔ | Follow / unfollow |
| `GET` | `/users/:id/followers` · `/following` | — | Follow graph |

### Leaderboards

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/leaderboard` | — | **Page 6.** `?asset&duration&sort=score\|accuracy\|edge\|volume\|streak&minPredictions&limit&offset` |
| `GET` | `/leaderboard/me` | ✔ | Your rank on any board |
| `GET` | `/leaderboard/me/progress` | ✔ | "You are N correct calls from the top 10" — `?topN` |
| `GET` | `/leaderboard/influence` | — | Ranked by originated DreamDEX volume |

The PRD's tabs — ALL / BTC / ETH / 15M / 1H — are just `asset` + `duration` combinations.

### Battles

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/battles` | — | **Page 5.** `?status=LIVE\|SETTLED\|VOID&marketId&limit` |
| `GET` | `/battles/candidates` | — | Opposing calls that could be paired, best-matched first |
| `GET` | `/battles/:id` | — | One head-to-head, with backing volume per side |
| `POST` | `/battles` | ✔ | `{ predictionAId, predictionBId }` — order does not matter |

A battle is two opposing calls on one contract. Backing a side is an ordinary
`POST /trades { backedPredictionId }`, so battles inherit attribution, fills and settlement with
no separate execution path. Side A is normalised to the UP call at creation, which is what lets
the resolver pick a winner from the market outcome alone.

### Frontend compatibility API — `/api`

`packages/frontend` was written against the retired `oracle-analytics`
contract, so that shape is served alongside the real one rather than forcing a
mid-hackathon migration. Same tables, translated at the edge.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/leaderboard` | `?asset&duration&sortBy=prediction_score\|accuracy&limit` |
| `GET` | `/api/users/:wallet/profile` | Wallet **or** username; wallet is case-insensitive |
| `GET` | `/api/users/:wallet/score-breakdown` | Explainable factor-by-factor breakdown |
| `GET` | `/api/predictions/:id/context` | The "why this matters" line |
| `POST` | `/api/predictions` | Records a call; creates user and market on first use |

Three differences from `/api/v1`, all inherited from the old contract:

1. every payload is wrapped as `{ data: ... }`;
2. **percentages are 0–100**, where `/api/v1` uses fractions 0–1;
3. **prices are dollars** (`0.43`), where `/api/v1` uses integer cents (`43`).

Those scales are the dangerous part — the UI renders `accuracy.toFixed(0)%` and
`$${price.toFixed(2)}`, so a fraction in a percentage's place silently shows
"1%" instead of "75%". `npm run smoke` asserts every one of them over real HTTP.

⚠️ **`POST /api/predictions` is unauthenticated** and trusts the `wallet` in the
body, exactly as the retired API did. Fine for a demo, not beyond one — anyone
can post a call as any wallet. `POST /api/v1/predictions` is the authenticated
equivalent (wallet signature → JWT), and the frontend should move to it. This
whole surface is a shim with an expiry date; `/api/v1` is the real API.

### Realtime — `ws://localhost:4000/ws`

```jsonc
// client → server
{ "action": "subscribe",   "channel": "market:<uuid>" }   // or "feed"
{ "action": "unsubscribe", "channel": "market:<uuid>" }
{ "action": "ping" }
```

Server events: `quote`, `trade.tape`, `market.opened`, `market.settled`, `order.filled`,
`prediction.created`, `prediction.settled`, `leaderboard.changed`.

No auth — everything broadcast is public. User-specific data is fetched over HTTP with a token.

---

## Architecture

```
HTTP / WS  ──►  src/modules/*        routes + services, one folder per domain
                src/analytics/*      scoring, reputation, leaderboards
                src/realtime/        client WebSocket + in-process pub/sub
                       │
                src/jobs/            bridge · resolver · market sync
                       │
   ┌───────────────────┴───────────────────┐
   ▼                                       ▼
src/db (Drizzle + Postgres)      src/dreamdex (DreamDexClient)
                                    ├── mock/   simulator
                                    └── live/   Bot Kit  ← to wire in
```

**Ingestion** — everything the exchange emits enters at [src/jobs/bridge.ts](src/jobs/bridge.ts)
and nowhere else.

**Settlement** ([src/jobs/resolver.ts](src/jobs/resolver.ts)) runs in a fixed order — record
outcome → settle predictions → settle trades → settle battles → recompute reputation → broadcast.
Reputation is last because it reads what the earlier steps write.

Every step is **idempotent**. A duplicated settlement event, a reconnect that replays history, or
the safety-net sweep running over a market the live event already handled all converge to the same
state. The system is correct on the event stream alone *and* on the sweeps alone, so it survives
losing either.

### Ordering rule for trades

The trade row is written **first**, in `PENDING`, with its id as the exchange's `clientOrderId`.
Only then do we call DreamDEX. If the process dies between the two we are left with a `PENDING` row
to reconcile — recoverable. The reverse order would leave a real, funded order on DreamDEX that
Oracle has no record of, which is not.

---

## Database

11 tables. Notable design decisions:

- **Prices are integer cents** (1–99), never floats. Money and quantities are `numeric`.
- **`predictions` has a unique index on `(user_id, market_id)`** — a predictor cannot hedge both
  sides and claim a win either way. This constraint is what makes a track record trustworthy.
- **`VOID` prediction status** — a market the exchange cancels is excluded from every stat rather
  than counted as a loss.
- **`prediction_results`** is an append-only settlement ledger; `predictions.status` is the mutable
  current state. Receipts render from the ledger.
- **`trades.source` + `backed_user_id`** carry the attribution story.
- **`user_segment_stats`** keyed on `(user, asset, duration)` powers "BTC 15M: 78%" as an O(1)
  lookup, because the feed renders that badge for every card.

---

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev --workspace=@signal/oracle-backend` | Watch mode |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Demo predictors with genuinely-computed history |
| `npm test` | Unit tests (64) |
| `npm run test:integration` | Integration tests against a real Postgres — boots a throwaway one if `TEST_DATABASE_URL` is unset, so it needs no Docker |
| `npm run smoke` | Migrates, seeds, boots the server and exercises the frontend-facing `/api` over real HTTP |
| `npm run typecheck` | `tsc --noEmit`, including scripts and configs |
| `npm run build` | Compile to `dist/` |
| `npm run db:migrate:prod` | Apply migrations from the compiled output (containers have no `tsx`) |

### Docker

Build from the **repo root** — the backend depends on a sibling workspace:

```bash
docker build -f packages/oracle-backend/Dockerfile -t oracle-backend .
```

Or bring up Postgres and the API together:

```bash
docker compose up --build
docker compose run --rm backend npm run db:migrate:prod
docker compose run --rm backend npm run db:seed
```

Migrations are a deliberate separate step rather than part of boot, so two replicas starting
at once cannot race each other through the same migration.

### About the seed

The seed does **not** write accuracy figures. Each persona gets a hidden per-segment hit rate and a
contrarian appetite; their history is played out honestly and every displayed number is then
derived by the real reputation engine. `rookie` is 2-for-2 and must not top the board — that is the
Wilson bound being demonstrated, not asserted. `flatline` is accurate but only ever backs
favourites, so it ranks well on score and badly on edge.

---

## Environment

See [.env.example](.env.example). Beyond the two required values:

| Variable | Default | Notes |
| --- | --- | --- |
| `DREAMDEX_MODE` | `mock` | `mock` \| `live` |
| `MOCK_TIME_SCALE` | `20` | Simulator clock compression; `1` = real time |
| `ENABLE_JOBS` | `true` | Master switch for background **database writes**: market sync, the event bridge, the settlement sweep and order reconciliation. `false` gives a read-only API replica — exactly one instance should run with it `true` |
| `MARKET_SYNC_INTERVAL_MS` | `5000` | Reconciliation against DreamDEX |
| `RESOLVER_INTERVAL_MS` | `10000` | Settlement safety-net sweep |
| `RECONCILER_INTERVAL_MS` | `20000` | Chases orders whose fill event never arrived |

Connection settings for `DREAMDEX_MODE=live` — network, indexer URL, addresses, and `DRY_RUN` —
belong to [`@signal/dreamdex-integration`](../dreamdex-integration) and are deliberately *not*
duplicated here. `DRY_RUN` defaults to **true**: orders are logged, not sent, until you set it
to `false`.
