# Oracle — Architecture

> Oracle is a social prediction network layered on **DreamDEX Event Contracts**.
> A prediction is not a post: it is a price-anchored call on a real binary
> market, and backing it places a real on-chain order.

- [1. System context](#1-system-context)
- [2. Component architecture](#2-component-architecture)
- [3. The core loop](#3-the-core-loop)
- [4. Backing a prediction, end to end](#4-backing-a-prediction-end-to-end)
- [5. Ingestion and the settlement pipeline](#5-ingestion-and-the-settlement-pipeline)
- [6. State machines](#6-state-machines)
- [7. Correctness properties](#7-correctness-properties)
- [8. Deployment](#8-deployment)

---

## 1. System context

Oracle deploys **no smart contract of its own**. Custody, matching, oracle
resolution and payout all live in DreamDEX's already-audited contracts on
Somnia. Oracle reads those contracts, mirrors what it sees, and adds the
social layer on top — see [ADR-0001](adr/0001-no-custom-smart-contract.md).

```mermaid
graph TB
    U["Predictor<br/><i>own wallet, own keys</i>"]

    subgraph oracle["Oracle — this repository"]
        FE["Frontend<br/><i>React + Vite</i>"]
        BE["Backend API<br/><i>Fastify + Postgres</i>"]
        DDX["dreamdex-integration<br/><i>the only SDK importer</i>"]
    end

    subgraph somnia["Somnia — DreamDEX Event Contracts"]
        MC["MarketsCore<br/>BinaryMarketsModule"]
        OH["OracleHub<br/><i>scheduled resolution</i>"]
        BS["BinarySettlement<br/>OutcomeToken6909"]
    end

    U -->|"browses feed, follows predictors"| FE
    U -->|"signs orders in their own wallet"| MC
    FE -->|"REST + WebSocket"| BE
    BE -->|"markets, books, fills, settlements"| DDX
    DDX -->|"@somnia-chain/markets-sdk"| MC
    MC --- OH
    MC --- BS

    classDef ora fill:#1e3a8a,stroke:#3b82f6,color:#ffffff
    classDef som fill:#134e4a,stroke:#14b8a6,color:#ffffff
    classDef usr fill:#3f3f46,stroke:#a1a1aa,color:#ffffff
    class FE,BE,DDX ora
    class MC,OH,BS som
    class U usr
```

**The trust boundary is the important part.** Money and outcomes are on-chain
and independently verifiable. Reputation, leaderboards and streaks are Oracle's
own bookkeeping, derived from observed on-chain activity — trustworthy only to
the extent Oracle's database is, which is a deliberate MVP tradeoff.

| Concern | Owner | Verifiable on-chain |
|---|---|---|
| Custody of funds | User's wallet | Yes |
| Order matching | `MarketsCore` | Yes |
| Outcome resolution | `OracleHub` | Yes |
| Payout math | `BinarySettlement` | Yes |
| Reputation, score, streaks | Oracle backend | No — derived |
| Feed, follows, battles | Oracle backend | No |

---

## 2. Component architecture

An npm-workspaces monorepo with one hard rule: **nothing outside
`dreamdex-integration` imports the Somnia SDK.**

```mermaid
graph LR
    subgraph fe["packages/frontend"]
        UI["Landing · Dashboard<br/>Charts · Rankings"]
        APIC["services/api.ts"]
    end

    subgraph be["packages/oracle-backend"]
        direction TB
        HTTP["server.ts<br/><i>CORS · rate limit · error envelope</i>"]

        subgraph mods["modules/"]
            AUTH["auth<br/><i>wallet challenge to JWT</i>"]
            MKT["markets"]
            PRED["predictions"]
            TRD["trades"]
            USR["users · battles<br/>leaderboard"]
        end

        subgraph ana["analytics/"]
            REP["reputation.ts"]
            SCO["scoring.ts<br/><i>Wilson · edge · ROI</i>"]
            LB["leaderboard.ts"]
            CONF["confidence.ts"]
        end

        subgraph jobs["jobs/"]
            BR["bridge<br/><i>events to writes</i>"]
            RES["resolver<br/><i>settlement sweep</i>"]
            RECO["reconciler<br/><i>order sweep</i>"]
        end

        RT["realtime/hub.ts<br/><i>WebSocket fan-out</i>"]
        DB[("Postgres<br/><i>Drizzle</i>")]
    end

    subgraph di["dreamdex boundary"]
        IFACE["DreamDexClient<br/><i>one interface</i>"]
        MOCK["mock<br/><i>full simulator</i>"]
        LIVE["live<br/><i>markets-sdk adapter</i>"]
    end

    UI --> APIC --> HTTP --> mods
    mods --> DB
    jobs --> DB
    ana --> DB
    jobs --> RT --> APIC
    mods --> IFACE
    jobs --> IFACE
    IFACE -.-> MOCK
    IFACE -.-> LIVE
    LIVE --> CHAIN[["Somnia<br/>chain 50312"]]

    classDef box fill:#1e293b,stroke:#475569,color:#e2e8f0
    class UI,APIC,HTTP,AUTH,MKT,PRED,TRD,USR,REP,SCO,LB,CONF,BR,RES,RECO,RT box
```

| Package | Owns | Entry point |
|---|---|---|
| [`dreamdex-integration`](../packages/dreamdex-integration) | Markets, order book, order placement, fills, settlement, redemption | [`src/index.ts`](../packages/dreamdex-integration/src/index.ts) |
| [`oracle-backend`](../packages/oracle-backend) | REST + WS API, schema, settlement pipeline, reputation | [`src/server.ts`](../packages/oracle-backend/src/server.ts) |
| [`frontend`](../packages/frontend) | Feed, market, profile, rankings UI | [`src/App.jsx`](../packages/frontend/src/App.jsx) |

### The mock/live seam

`DREAMDEX_MODE` selects the implementation behind one interface
([`src/dreamdex/types.ts`](../packages/oracle-backend/src/dreamdex/types.ts)):

- **`mock`** — a real simulator, not a stub. Rolling contract series, binary
  option pricing that converges to 1c/99c at expiry, an order book, async fills
  delivered as simulated `OrderFilled` events, and settlement. The whole
  product is demoable with no testnet funds and no network.
- **`live`** — an adapter over `@somnia-chain/markets-sdk` against Somnia
  Shannon testnet (`50312`).

Both are exercised by the same test suite, which is what makes the seam worth
having — see [ADR-0002](adr/0002-single-dreamdex-boundary.md).

---

## 3. The core loop

Everything in the product exists to close this loop. Break any arrow and
Oracle is just a feed.

```mermaid
graph LR
    P["Predict<br/><i>price-anchored call</i>"] --> B["Back it<br/><i>real DreamDEX order</i>"]
    B --> S["Settle<br/><i>oracle posts outcome</i>"]
    S --> R["Reputation<br/><i>Wilson score moves</i>"]
    R --> C["Compete<br/><i>leaderboard reorders</i>"]
    C --> P

    classDef n fill:#1e3a8a,stroke:#60a5fa,color:#ffffff
    class P,B,S,R,C n
```

The attribution edge is what makes Oracle valuable to the exchange: every
backed trade carries `backed_prediction_id` and `backed_user_id`, so
originated volume is measurable per predictor (`GET /stats/attribution`).

---

## 4. Backing a prediction, end to end

Note the write order: **Oracle's own row lands before the exchange call.**
Crashing after the insert leaves a `PENDING` row the reconciler can repair;
crashing after the order would leave a funded on-chain order Oracle has no
record of, which is not recoverable.

```mermaid
sequenceDiagram
    autonumber
    participant U as Predictor
    participant FE as Frontend
    participant API as Backend API
    participant DB as Postgres
    participant DX as DreamDEX
    participant WS as WebSocket hub

    U->>FE: Back this prediction, $10
    FE->>API: POST /trades (Idempotency-Key, JWT)
    API->>DB: insert trade PENDING with clientOrderId
    Note over API,DB: our row first — a lost order<br/>is worse than a stale row
    API->>DX: place taker order, sized from stake
    DX-->>API: accepted, dreamdexOrderId
    API->>DB: attach order id
    API-->>FE: 201, trade PENDING

    DX--)API: OrderFilled (authoritative)
    API->>DB: FILLED with price, qty, txHash
    API->>DB: credit backed predictor's volume
    API--)WS: trade.filled
    WS--)FE: live update
```

If that `OrderFilled` event is ever missed — a disconnect, a restart, a dropped
message — the **reconciler** sweep catches the order against the exchange, so
no trade sits `PENDING` forever and no originated volume goes uncounted.

---

## 5. Ingestion and the settlement pipeline

Every exchange event enters the system at exactly one place
([`jobs/bridge.ts`](../packages/oracle-backend/src/jobs/bridge.ts)), which keeps
the ingestion rules readable in one file.

```mermaid
flowchart TB
    subgraph stream["Live event stream — the fast path"]
        E1["market opened"] --> BR
        E2["quote"] --> BR
        E3["trade"] --> BR
        E4["order filled"] --> BR
        E5["settled"] --> BR
        BR{{"bridge.ts"}}
    end

    subgraph sweeps["Periodic sweeps — the repair path"]
        SY["marketSync<br/><i>full reconciliation</i>"]
        RS["resolver<br/><i>unsettled markets</i>"]
        RC["reconciler<br/><i>open orders, PnL backfill</i>"]
    end

    W["writes"]
    PIPE["Settlement pipeline"]
    DB[("Postgres")]

    BR --> W
    BR --> PIPE
    SY --> W
    RC --> W
    RS --> PIPE
    W --> DB

    subgraph steps["resolveMarket — the order is not arbitrary"]
        direction TB
        S1["1 · record market outcome"] --> S2["2 · settle predictions<br/>PENDING to WON/LOST, write receipts"]
        S2 --> S3["3 · settle trades, realise PnL"]
        S3 --> S4["4 · settle battles, declare winner"]
        S4 --> S5["5 · recompute reputation"]
        S5 --> S6["6 · broadcast feed, market, leaderboard"]
    end

    PIPE --> steps
    steps --> DB
    S6 --> HUB(["WebSocket hub"])

    classDef ev fill:#1e293b,stroke:#475569,color:#cbd5e1
    classDef st fill:#14532d,stroke:#22c55e,color:#dcfce7
    class E1,E2,E3,E4,E5 ev
    class S1,S2,S3,S4,S5,S6 st
```

Reputation is recomputed **last** because it reads rows the earlier steps
write. Running it first — or concurrently — would produce stats for a
settlement that had not finished landing.

---

## 6. State machines

**Market**

```mermaid
stateDiagram-v2
    direction LR
    [*] --> OPEN: market mirrored
    OPEN --> CLOSED: closesAt passes
    CLOSED --> SETTLED: oracle posts outcome
    CLOSED --> CANCELLED: voided on-chain
    SETTLED --> [*]
    CANCELLED --> [*]
```

**Prediction** — `VOID` never touches a score. An exchange-side cancellation
must not damage anyone's record.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDING: call made at entry price
    PENDING --> WON: called side paid out
    PENDING --> LOST: called side did not
    PENDING --> VOID: market cancelled
```

**Trade**

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDING: row written, order sent
    PENDING --> PARTIALLY_FILLED: partial fill observed
    PARTIALLY_FILLED --> FILLED: remainder fills
    PENDING --> FILLED: OrderFilled observed
    PENDING --> CANCELLED: pulled before filling
    PENDING --> FAILED: rejected, failureReason set
    FILLED --> [*]: market resolves, realized_pnl written
```

---

## 7. Correctness properties

These are the invariants the design is actually built around.

| Property | How it is held |
|---|---|
| **No lost order** | The trade row is written before the exchange call; the reconciler repairs any `PENDING` |
| **No double-count** | Every pipeline step no-ops on already-settled rows, so `resolveMarket` is idempotent |
| **Replay-safe** | A duplicated settlement event, a reconnect replaying history, and the sweep all converge to the same state |
| **Correct on either path alone** | The system is correct on the event stream alone *and* on the sweeps alone, so it survives losing either |
| **Rebuildable stats** | `user_stats` is a cache; `recomputeUserStats` rebuilds every number from `predictions` |
| **Auditable score** | Scoring is pure functions of settled predictions, so any number in the UI can be re-derived |
| **Idempotent requests** | `Idempotency-Key` is namespaced per user; a replay returns the original trade, never a second funded order |
| **Non-custodial** | The backend holds no user key. Signing happens in the user's wallet |

---

## 8. Deployment

```mermaid
graph LR
    V["Vercel<br/><i>frontend</i>"] -->|REST · WSS| D["Docker<br/><i>oracle-backend</i>"]
    D --> PG[("Postgres<br/><i>Neon / Supabase</i>")]
    D -->|RPC| SOM[["Somnia 50312"]]
```

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs three jobs on
every push and pull request:

1. **Typecheck, build and unit tests** across all workspaces.
2. **Integration tests against a real Postgres 16** — the hand-written SQL
   (Wilson ranking, leaderboard aggregates, PnL backfill) cannot fail at
   compile time, so running it for real is not optional. Followed by an HTTP
   **smoke test** that boots the real server and asserts the exact field names
   and scales the frontend reads.
3. **Docker image build** for the backend.

---

### Further reading

- [Data model](data-model.md) — ERD and table reference
- [Reputation](reputation.md) — the scoring math, with worked examples
- [API reference](api.md) — every endpoint
- [ADR-0001](adr/0001-no-custom-smart-contract.md) — why Oracle ships no contract
- [ADR-0002](adr/0002-single-dreamdex-boundary.md) — one exchange boundary, two implementations
