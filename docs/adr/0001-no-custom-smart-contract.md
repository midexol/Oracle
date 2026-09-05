# ADR-0001 — Oracle deploys no smart contract of its own

**Status:** accepted
**Scope:** on-chain architecture

## Context

Oracle is a social prediction and trading network built on **DreamDEX Event
Contracts** — binary UP/DOWN markets on BTC and ETH, already deployed and
audited on Somnia. The product needs custody, order matching, outcome
resolution, settlement and payout.

The obvious-looking move for a prediction product is to deploy a contract. The
question this ADR settles is whether Oracle needs one.

## Decision

**No custom contract.** All on-chain behaviour is handled by DreamDEX's
existing contracts. Oracle's code only *calls* them, through
[`@signal/dreamdex-integration`](../../packages/dreamdex-integration). Oracle
does not own or hold user funds anywhere.

## Rationale

DreamDEX's Event Contracts already do everything the product needs on-chain:

| Need | Already provided by | Notes |
|---|---|---|
| Custody | The user's own wallet | Non-custodial by design — users sign their own orders and redemptions |
| Matching | `MarketsCore` / `BinaryMarketsModule` | |
| Resolution | `OracleHub` | A pre-scheduled oracle posts the outcome; Somnia's on-chain reactivity pushes it in automatically. No keeper needed — `pokeOracle()` and `voidExpired()` already exist as backstops |
| Settlement | `BinarySettlement` + `redeem()` | Payout math, including the voided-market 0.5/0.5 case |

Building a parallel contract for any of this means re-deriving logic DreamDEX
already ships, and taking on the liability that comes with it:

- **A custodial vault** — the natural way to translate a "$10 stake" UI into
  DreamDEX orders server-side — would require Oracle's backend to hold or relay
  user keys. That turns a non-custodial product into a custodial one, which
  contradicts the "users connect their own wallet" design.
- **Any contract Oracle deploys** needs its own audit, upgrade path and admin
  key management. Real cost and real risk, for zero functional gain over
  calling DreamDEX directly.

## Consequences

**Good.** No audit surface, no admin keys, no upgrade story, no custody risk.
Everything that touches money is independently verifiable on-chain by anyone.

**The tradeoff.** Reputation, leaderboards, streaks and copy-trading are **not**
on-chain. They live in the backend database, computed from observed DreamDEX
activity (fills, settlements) rather than from an on-chain registry. Those
features are therefore only as trustworthy as Oracle's own bookkeeping — not
independently verifiable.

That is acceptable for an MVP and worth revisiting if the product later needs
provable or portable reputation. If the team ever wants an on-chain reputation
registry or an on-chain copy-trading router, that is a **deliberate new
contract** and a new decision — not something to assume is required.

## Reference — contracts in use

Somnia. Testnet `50312` and mainnet `5031` share addresses via CREATE3.

| Contract | Address |
|---|---|
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| MarketsCore | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| BinarySettlement | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| OutcomeToken6909 | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| CollateralRouter | `0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C` |

Collateral decimals differ by network — testnet tUSDC is 6dp, mainnet USDso is
18dp. Always read `decimals()` from the token; never hard-code it.

Sources: [dreamdex-bot-kit](https://github.com/somnia-chain/dreamdex-bot-kit),
[docs.dreamdex.io](https://docs.dreamdex.io/developers/event-contracts).
