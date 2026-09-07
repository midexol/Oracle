# Data model

Postgres, accessed through [Drizzle](https://orm.drizzle.team/). Schema lives in
[`packages/oracle-backend/src/db/schema/`](../packages/oracle-backend/src/db/schema).

Eleven tables in three groups:

| Group | Tables | Rebuildable? |
|---|---|---|
| **Identity** | `users`, `auth_nonces`, `follows` | No — source of truth |
| **Market truth** | `markets`, `market_price_snapshots`, `predictions`, `prediction_results`, `trades`, `battles` | No — source of truth |
| **Derived cache** | `user_stats`, `user_segment_stats` | **Yes** — `recomputeUserStats` rebuilds every number from `predictions` |

That last row is the point: a derived table that cannot be rebuilt is a table
that will eventually be wrong and unfixable.

---

## Entity relationships

```mermaid
erDiagram
    users ||--o{ predictions : "makes"
    users ||--o{ trades : "places"
    users ||--o| user_stats : "cached in"
    users ||--o{ user_segment_stats : "per asset+duration"
    users ||--o{ follows : "follower"
    users ||--o{ follows : "following"

    markets ||--o{ predictions : "called on"
    markets ||--o{ trades : "executed on"
    markets ||--o{ market_price_snapshots : "price history"
    markets ||--o{ battles : "hosts"

    predictions ||--o| prediction_results : "receipt"
    predictions ||--o{ trades : "backed by"
    predictions ||--o{ battles : "side A / side B"

    users {
        uuid id PK
        text wallet_address UK "lowercased"
        text username UK
        text avatar_url
        text bio
    }

    markets {
        uuid id PK
        text dreamdex_market_id UK "the on-chain identity"
        enum asset "BTC ETH SOL SOMI"
        enum duration "1M 5M 15M 1H 4H 1D"
        enum status "OPEN CLOSED SETTLED CANCELLED"
        enum outcome "UP DOWN, null until settled"
        numeric opening_reference
        numeric closing_reference
        int up_price_cents
        int down_price_cents
        timestamptz opens_at
        timestamptz closes_at
        timestamptz settled_at
    }

    predictions {
        uuid id PK
        uuid user_id FK
        uuid market_id FK
        enum direction "UP DOWN"
        int entry_price_cents "price when the call was made"
        numeric stake
        text rationale
        enum status "PENDING WON LOST VOID"
        timestamptz settled_at
    }

    prediction_results {
        uuid prediction_id PK
        enum result
        enum market_outcome
        int entry_price_cents
        int settlement_price_cents
        timestamptz settled_at
    }

    trades {
        uuid id PK
        uuid user_id FK
        uuid market_id FK
        uuid backed_prediction_id FK "attribution"
        uuid backed_user_id FK "attribution"
        enum side "UP DOWN"
        enum status "PENDING PARTIALLY_FILLED FILLED CANCELLED FAILED"
        enum source "BACK_PREDICTION OWN_PREDICTION DIRECT BATTLE"
        int price_cents
        numeric quantity
        numeric filled_quantity
        text idempotency_key UK "namespaced per user"
        text dreamdex_order_id UK
        text tx_hash
        numeric realized_pnl
        text failure_reason
    }

    user_stats {
        uuid user_id PK
        int settled_predictions
        int correct_predictions
        numeric accuracy
        int score "0..100 Wilson lower bound"
        numeric edge
        numeric roi
        int current_streak "signed"
        int best_streak
        numeric volume_backed "originated volume"
        int backers_count
        int followers_count
        int following_count
    }

    user_segment_stats {
        uuid user_id FK
        enum asset
        enum duration
        int settled_predictions
        int correct_predictions
        numeric accuracy
        int score
        numeric edge
    }

    battles {
        uuid id PK
        uuid market_id FK
        uuid prediction_a_id FK
        uuid prediction_b_id FK
        enum status "LIVE SETTLED VOID"
        uuid winner_user_id FK
    }

    follows {
        uuid follower_id PK
        uuid following_id PK
    }
```

`auth_nonces` and `market_price_snapshots` are omitted above for readability:

| Table | Purpose |
|---|---|
| `auth_nonces` | One-shot wallet-login challenges. `nonce` PK, `expires_at`, `consumed_at` — a consumed nonce cannot be replayed. |
| `market_price_snapshots` | Time series of `up_price_cents` / `down_price_cents` per market, written at most every 5s, for charts. |

---

## Design notes worth knowing

**Prices are integer cents, not floats.** An Event Contract trades between 1c
and 99c and pays 100c. Cents are exact, and every scoring formula is defined on
them — there is no float rounding anywhere in the reputation path.

**`entry_price_cents` is captured on the prediction, not looked up later.** A
call made when UP was 43c is a harder, more valuable call than the same call at
85c. Storing the price at call time is what makes `edge` computable at all.

**Decimals are read, never hard-coded.** Testnet collateral (tUSDC) is 6dp;
mainnet (USDso) is 18dp. `numeric(20, 6)` on the Oracle side, with the on-chain
`decimals()` read at the boundary.

**Attribution is two columns.** `backed_prediction_id` and `backed_user_id` on
`trades` are what let Oracle answer "how much DreamDEX volume did this
predictor originate" — the metric that makes the product worth something to the
exchange rather than just to its users.

**Wallet addresses are stored lowercased** (`normalizeAddress`), so a checksummed
and non-checksummed login are the same account.

---

## Migrations

```bash
npm run db:generate   # diff the schema into a new migration
npm run db:migrate    # apply
npm run db:seed       # demo predictors with real settled history
```

The seed is not decorative — it produces settled predictions with real entry
prices, so leaderboards, scores, streaks and segment stats are all populated
and the whole product is demoable immediately after a clean install.
