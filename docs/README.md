# Oracle — documentation

Start here if you are evaluating the project.

| Document | What it answers |
|---|---|
| **[Architecture](architecture.md)** | How the system is put together — diagrams for the system context, components, the core loop, the trade path, the settlement pipeline, and the correctness properties the design is built around |
| **[Data model](data-model.md)** | The eleven tables, an ERD, and which of them are source-of-truth versus rebuildable cache |
| **[Reputation](reputation.md)** | The scoring math: why it is a Wilson lower bound and not raw accuracy, with worked examples |
| **[API reference](api.md)** | Every endpoint, the auth flow, the error envelope, rate limits, and the realtime channels |

## Decision records

| ADR | Decision |
|---|---|
| **[0001](adr/0001-no-custom-smart-contract.md)** | Oracle deploys no smart contract of its own — DreamDEX already owns custody, matching, resolution and settlement |
| **[0002](adr/0002-single-dreamdex-boundary.md)** | One exchange interface with two implementations, so the whole product runs offline and CI can exercise the settlement pipeline for real |

## The five-minute version

```
predict → back it with a real trade → market settles → reputation moves → leaderboard reorders
```

1. Oracle sits **on top of** DreamDEX Event Contracts and adds no on-chain
   surface of its own. Money is non-custodial and verifiable; the social layer
   is Oracle's own bookkeeping. That boundary is explicit, not accidental —
   [ADR-0001](adr/0001-no-custom-smart-contract.md).
2. Every "back this prediction" tap ends in a **real** DreamDEX order,
   attributed to the predictor who caused it. That attribution is what makes
   the product worth something to the exchange, not just to its users.
3. The reputation score is a **Wilson lower bound**, so a 1-for-1 record scores
   21 and a 47-for-63 grinder scores 63. Evidence climbs the board, not luck.
4. The settlement pipeline is **idempotent and replay-safe**, and correct on the
   event stream alone *or* on the periodic sweeps alone — it survives losing
   either.
5. `DREAMDEX_MODE=mock` runs the entire product against a real simulator, so
   everything above is demoable from a clean `npm install` with no testnet
   funds and no network.
