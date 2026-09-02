# Oracle (repo: Signal) — architecture notes

Oracle is a social prediction trading platform built on top of **DreamDEX
Event Contracts** (binary UP/DOWN markets on BTC/ETH, running on Somnia).

## Decision: no custom smart contract

Oracle does **not** deploy its own smart contract. All on-chain behavior —
custody, order matching, oracle resolution, settlement, and payout — is
handled by DreamDEX's already-deployed, already-audited contracts on Somnia.
Oracle's own code only *calls* those contracts (via
`@somnia-chain/markets-sdk`); it does not own or hold user funds anywhere.

### Why

DreamDEX's Event Contracts already do everything a prediction-market product
needs on-chain:

- **Custody** — non-custodial by design. Users connect their own wallet and
  sign their own orders/redemptions; Oracle's backend never holds a private
  key for user funds.
- **Resolution** — a pre-scheduled oracle posts the outcome and Somnia's
  on-chain reactivity pushes it into `OracleHub` automatically. No keeper or
  custom resolution logic needed (backstops: `pokeOracle()` / `voidExpired()`
  already exist on-chain).
- **Settlement** — `BinarySettlement` + `redeem()` handle payout math
  (including the voided-market 0.5/0.5 case). Nothing to reimplement.

Building a parallel contract for any of this would mean re-deriving logic
DreamDEX already ships, plus taking on the liability that comes with it:

- A **custodial vault** (to translate the PRD's "$10 stake" UI into DreamDEX
  orders server-side) would require Oracle's backend to hold or relay user
  keys — turning a non-custodial product into a custodial one, which
  contradicts the PRD's "users connect their own wallet" design.
- Any contract Oracle deploys needs its own audit, upgrade path, and admin
  key management — real cost and real risk for zero functional gain over
  just calling DreamDEX directly.

### What this means for the "social" features

Reputation, leaderboards, streaks, and copy-trading are **not** on-chain.
They live in the backend/database (M.D IFT's + Adeaanu's lane), computed
from observed DreamDEX activity (fills, settlements) rather than from a
custom on-chain registry. This is a conscious tradeoff: those features are
only as trustworthy as Oracle's own backend bookkeeping, not independently
verifiable on-chain — acceptable for an MVP, worth revisiting if the product
later needs provable/portable reputation.

If the team ever wants an on-chain reputation registry or on-chain
copy-trading router as a stretch goal, that is a deliberate new contract,
not a requirement — flag it explicitly rather than assuming it's needed.

## Where the DreamDEX-facing code lives

### Monorepo layout

| Package | Owns |
|---|---|
| `packages/dreamdex-integration` | The only importer of `@somnia-chain/markets-sdk`. |
| `packages/oracle-backend` | API, Postgres schema, settlement pipeline, reputation + leaderboards. |
| `packages/frontend` | Next.js UI. |

`packages/oracle-analytics` (Prisma/SQLite) was retired once the reputation
engine consolidated into `oracle-backend`; it is still in git history if any
of its scoring work is wanted back.

All contract/SDK interaction goes through `packages/dreamdex-integration`
(`@signal/dreamdex-integration`). Nothing else in the monorepo should import
`@somnia-chain/markets-sdk` directly — see that package's `README.md` for
the module breakdown and the non-custodial signer model.

## Reference: DreamDEX contracts in use (Somnia, testnet 50312 == mainnet 5031 via CREATE3)

| Contract | Address |
|---|---|
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| MarketsCore | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| BinarySettlement | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| OutcomeToken6909 | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| CollateralRouter | `0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C` |

Testnet collateral (tUSDC) is 6 decimals; mainnet (USDso) is 18 — always
read `decimals()` from the token, never hard-code.

## Known unknowns (verify against live data, don't assume)

- `VENUE_ID` has changed multiple times in DreamDEX's early rollout — read
  it from a live market row, don't hardcode it.
- YES == UP is assumed but not yet confirmed against a real market's
  `question` field.

Source: `dreamdex-bot-kit` (github.com/somnia-chain/dreamdex-bot-kit) and
`docs.dreamdex.io/developers/event-contracts`.
