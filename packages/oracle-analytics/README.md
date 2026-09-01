# Oracle Analytics & Prediction Engine

`@signal/oracle-analytics` is the reputation, analytics, and market settlement engine for **Oracle** — a social prediction trading layer built on top of **DreamDEX Event Contracts** on Somnia Shannon Testnet (Chain ID 50312).

---

## Beyond the Spec: Advanced Reputation & Scoring Model

### 1. Odds-Alpha Per-Bet Scoring
Per-bet contributions are weighted symmetrically based on the entry price (market-implied probability):
- **WON**: `50 + ((1 - entryPrice) * 100) / 2` $\rightarrow$ Range `(50, 100]`
- **LOST**: `50 - (entryPrice * 100) / 2` $\rightarrow$ Range `[0, 50)`

Losing a heavy favorite prediction incurs a larger penalty than losing an underdog prediction. Winning an underdog prediction awards higher odds-alpha points.

### 2. Foresight / Timing-Alpha Multiplier
Prediction markets reward early conviction over late copy-trading. The `calculateForesightMultiplier` function adjusts each bet's contribution based on how early it was placed relative to the total duration window:
$$\text{remainingFraction} = \frac{T_{\text{resolved}} - T_{\text{created}}}{T_{\text{window}}}$$
$$\text{multiplier} = 0.85 + 0.30 \times \text{remainingFraction}$$

- **Early Entry** (~90–100% time remaining): `1.12 - 1.15` multiplier (+15% timing boost).
- **Mid Entry** (~50% time remaining): `1.00` multiplier (neutral).
- **Late Entry** (~0–10% time remaining): `0.85 - 0.88` multiplier (-15% timing penalty).
- **Edge Cases**: `resolvedAt <= createdAt` or unknown duration labels default to `1.0` without crashing.

### 3. Bayesian Shrinkage & Credible Intervals
Raw average scores are dampened toward a neutral prior of 50 based on sample size $N$:
$$\text{Score} = \frac{N}{N + 10} \times \text{RawScore} + \frac{10}{N + 10} \times 50$$

A 90% credible interval on true win rate is computed for profile display so judges can immediately observe statistical confidence.

---

## Demo-Ready Storytelling Seed Data

The database seed (`npm run prisma:seed`) is fully **idempotent** and creates 6 distinct personas:

1. **Veteran (`chidi_trades`)**:
   - `0x2222222222222222222222222222222222bbbb`
   - ~85 resolved predictions, ~70% win rate across BTC 1H and ETH 1H.
   - High sample size produces a high score with a narrow 90% credible interval.

2. **Lucky Newbie (`lucky_newbie`)**:
   - `0x3333333333333333333333333333333333cccc`
   - 1 prediction, 100% win rate at underdog price.
   - Bayesian shrinkage pulls score down to ~53–56 with a wide 90% credible interval.

3. **Hot Streak (`ada_predicts`)**:
   - `0x4444444444444444444444444444444444dddd`
   - Mediocre lifetime win rate (~55% over 40 bets), but strong recent form (last 15 bets 80% wins).
   - Demonstrates high recent momentum vs neutral lifetime reputation score.

4. **Cold Streak (`mide`)**:
   - `0x1111111111111111111111111111111111aaaa`
   - Strong lifetime record (~70% over 40 bets), but poor recent form (last 15 bets 27% wins).
   - Demonstrates low recent momentum vs high lifetime reputation score.

5. **Specialist (`zainab_specialist`)**:
   - `0x6666666666666666666666666666666666ffffff`
   - 50 bets in `BTC 15M` (76% win rate) vs 4 bets in `ETH 1H` (25% win rate).
   - Shows category breakdown specialization.

6. **Brand New (`new_trader`)**:
   - `0x5555555555555555555555555555555555eeee`
   - 0 predictions; tests empty state behavior.

---

## Running Commands

```bash
# Push database schema to local SQLite (dev.db)
npm --prefix packages/oracle-analytics run prisma db push

# Seed storytelling personas (idempotent)
npm run prisma:seed

# Run unit test suite
npm run test

# Start dev analytics server
npm run dev:analytics
```
