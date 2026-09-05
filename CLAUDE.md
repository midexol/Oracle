# Working in this repo

The architecture, the data model, the scoring math and the reasoning behind the
two decisions that shape everything else all live in [`docs/`](docs/README.md).
Read those first — this file only carries the rules that are easy to break.

| Question | Answer |
|---|---|
| How is the system put together? | [docs/architecture.md](docs/architecture.md) |
| What are the tables? | [docs/data-model.md](docs/data-model.md) |
| How is reputation scored? | [docs/reputation.md](docs/reputation.md) |
| What are the endpoints? | [docs/api.md](docs/api.md) |
| Why no smart contract? | [docs/adr/0001-no-custom-smart-contract.md](docs/adr/0001-no-custom-smart-contract.md) |
| Why mock and live behind one interface? | [docs/adr/0002-single-dreamdex-boundary.md](docs/adr/0002-single-dreamdex-boundary.md) |

## Rules

**Only `packages/dreamdex-integration` may import `@somnia-chain/markets-sdk`.**
Everything else goes through `@signal/dreamdex-integration`, or through the
`DreamDexClient` interface in the backend. This is what keeps the product
runnable offline and the SDK's churn contained to one adapter.

**Oracle deploys no smart contract.** Custody, matching, resolution and
settlement are DreamDEX's. If a task seems to need a contract of our own, that
is a new architectural decision — write an ADR and flag it, do not assume it.

**The backend never holds a user key.** Order placement and redemption are
signed in the user's browser wallet. A backend signing key would make Oracle
custodial, which ADR-0001 rules out.

**Reputation is derived, never authoritative.** `user_stats` and
`user_segment_stats` are a cache of `predictions`. Any change to scoring must
keep `recomputeUserStats` able to rebuild every number from scratch.

**Read `decimals()`; never hard-code it.** Testnet collateral is 6dp, mainnet
is 18dp.

## Known unknowns — verify against live data, do not assume

- **`VENUE_ID`** has changed several times in DreamDEX's rollout. Read it off a
  live market row.
- **YES == UP** is assumed but not confirmed against a real market's `question`
  field.

## Retired

`packages/oracle-analytics` (Prisma/SQLite) was removed once the reputation
engine consolidated into `oracle-backend`. Its API contract survives as the
`/api` compat surface; the rest is in git history if any of its scoring work is
wanted back.
