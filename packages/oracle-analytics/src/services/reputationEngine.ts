import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Reputation / Prediction-Score engine.
 *
 * Design notes:
 * - `entryPrice` is the market-implied probability (0,1) of the direction the
 *   user picked, at the moment they entered. Low entryPrice = underdog bet.
 * - Odds-alpha per-bet score:
 *     WON:  50 + oddsAlpha / 2   -> range (50, 100], reward grows as entryPrice -> 0
 *     LOST: 50 - (entryPrice*100) / 2 -> range [0, 50), penalty grows as entryPrice -> 1
 * - Foresight / timing-alpha multiplier:
 *     `calculateForesightMultiplier(createdAt, resolvedAt, durationLabel)`
 *     Computes how early the entry was placed as a fraction of total market window.
 *     Returns a multiplier bounded in [0.85, 1.15]:
 *     - Early entry (high foresight, ~90-100% window remaining): ~1.12-1.15 multiplier
 *     - Mid entry (~50% window remaining): ~1.00 multiplier (neutral)
 *     - Late entry (low foresight, ~0-10% window remaining): ~0.85-0.88 multiplier
 *     Edge cases: `resolvedAt <= createdAt` or unknown durationLabel fallback to 1.0.
 * - `calculatePredictionScore` averages per-bet scores and applies Bayesian
 *   shrinkage toward neutral prior 50: (N/(N+10))*raw + (10/(N+10))*50.
 * - `calculateCredibleInterval`: Beta-Binomial 90% credible interval on win rate.
 * - `calculateMomentumScore`: EWMA moving average (10-bet half-life decay).
 * - `buildScoreExplanation`: Detailed breakdown of score math for explainability.
 */

export const BAYESIAN_PRIOR_SCORE = 50;
export const BAYESIAN_PRIOR_WEIGHT = 10;

export type BetResult = 'WON' | 'LOST';

export interface ResolvedBetInput {
  entryPrice: number; // (0, 1) exclusive
  result: BetResult;
  createdAt?: Date;
  resolvedAt?: Date;
  duration?: string;
}

const DURATION_MS: Record<string, number> = {
  '15M': 15 * 60 * 1000,
  '1H': 60 * 60 * 1000,
  '4H': 4 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
};

/**
 * Calculates a timing-alpha multiplier bounded in range [0.85, 1.15] based on
 * how early a prediction was placed relative to the total market duration window.
 */
export function calculateForesightMultiplier(
  createdAt: Date,
  resolvedAt: Date,
  durationLabel: string,
): number {
  if (!createdAt || !resolvedAt) return 1.0;
  const createdTime = createdAt.getTime();
  const resolvedTime = resolvedAt.getTime();
  if (!Number.isFinite(createdTime) || !Number.isFinite(resolvedTime) || resolvedTime <= createdTime) {
    return 1.0;
  }

  const normalizedDuration = durationLabel.trim().toUpperCase();
  const windowMs = DURATION_MS[normalizedDuration];
  if (!windowMs) {
    // eslint-disable-next-line no-console
    console.warn(
      `[reputationEngine] Unknown duration label: "${durationLabel}". Defaulting foresight multiplier to 1.0.`,
    );
    return 1.0;
  }

  const remainingMs = resolvedTime - createdTime;
  const remainingFraction = Math.max(0, Math.min(1, remainingMs / windowMs));

  // Linear scaling from 0.85 (late entry penalty) to 1.15 (early entry bonus)
  const rawMultiplier = 0.85 + 0.3 * remainingFraction;
  return Math.round(rawMultiplier * 100) / 100;
}

/** Standard win-rate percentage. Returns 0 for a zero-total account (no NaN). */
export function calculateAccuracy(wins: number, total: number): number {
  if (total < 0 || wins < 0) {
    throw new Error('calculateAccuracy: wins/total must be non-negative');
  }
  if (total === 0) return 0;
  if (wins > total) {
    throw new Error('calculateAccuracy: wins cannot exceed total');
  }
  return round2((wins / total) * 100);
}

/** Odds-weighted score for a single resolved bet. Throws on invalid entryPrice. */
export function calculatePerBetScore(entryPrice: number, result: BetResult): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    throw new Error(`calculatePerBetScore: entryPrice must be within (0, 1), got ${entryPrice}`);
  }
  const oddsAlpha = (1 - entryPrice) * 100; // underdog bonus, spec-defined
  if (result === 'WON') {
    return 50 + oddsAlpha / 2;
  }
  return 50 - (entryPrice * 100) / 2;
}

/**
 * Enhanced per-bet score incorporating both odds-alpha and foresight timing-alpha.
 * Bounded between [0, 100].
 */
export function calculatePerBetScoreWithForesight(
  entryPrice: number,
  result: BetResult,
  createdAt?: Date,
  resolvedAt?: Date,
  duration?: string,
): number {
  const baseScore = calculatePerBetScore(entryPrice, result);
  if (!createdAt || !resolvedAt || !duration) {
    return baseScore;
  }
  const multiplier = calculateForesightMultiplier(createdAt, resolvedAt, duration);
  const nudged = baseScore * multiplier;
  return Math.max(0, Math.min(100, Math.round(nudged * 100) / 100));
}

/** Applies Bayesian shrinkage toward the neutral prior (50) based on sample size N. */
export function bayesianDampen(rawScore: number, n: number): number {
  if (n < 0) throw new Error('bayesianDampen: n must be non-negative');
  if (n === 0) return BAYESIAN_PRIOR_SCORE;
  const sampleWeight = n / (n + BAYESIAN_PRIOR_WEIGHT);
  const priorWeight = BAYESIAN_PRIOR_WEIGHT / (n + BAYESIAN_PRIOR_WEIGHT);
  return round2(sampleWeight * rawScore + priorWeight * BAYESIAN_PRIOR_SCORE);
}

/**
 * Full Bayesian-dampened Prediction Score from a user's complete resolved
 * bet history (CANCELLED bets should be filtered out before calling this).
 */
export function calculatePredictionScore(userHistory: ResolvedBetInput[]): number {
  const n = userHistory.length;
  if (n === 0) return BAYESIAN_PRIOR_SCORE;

  const rawTotal = userHistory.reduce(
    (sum, bet) =>
      sum +
      calculatePerBetScoreWithForesight(
        bet.entryPrice,
        bet.result,
        bet.createdAt,
        bet.resolvedAt,
        bet.duration,
      ),
    0,
  );
  const rawScore = rawTotal / n;
  return bayesianDampen(rawScore, n);
}

/**
 * 90% Credible Interval on true win rate (Beta-Binomial Laplace smoothing).
 */
export function calculateCredibleInterval(
  wins: number,
  total: number,
  confidenceLevel = 0.9,
): { lower: number; upper: number } {
  if (total === 0) {
    return { lower: 0, upper: 100 };
  }
  const p = (wins + 1) / (total + 2);
  const se = Math.sqrt((p * (1 - p)) / (total + 3));
  const z = confidenceLevel === 0.95 ? 1.96 : 1.645;
  const lower = Math.max(0, round2((p - z * se) * 100));
  const upper = Math.min(100, round2((p + z * se) * 100));
  return { lower, upper };
}

/**
 * Recency-weighted momentum score (10-bet half-life decay).
 */
export function calculateMomentumScore(recentBetsDesc: ResolvedBetInput[]): number {
  if (recentBetsDesc.length === 0) return BAYESIAN_PRIOR_SCORE;

  const halfLife = 10;
  const decayFactor = Math.pow(0.5, 1 / halfLife);

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < recentBetsDesc.length; i++) {
    const bet = recentBetsDesc[i];
    const score = calculatePerBetScoreWithForesight(
      bet.entryPrice,
      bet.result,
      bet.createdAt,
      bet.resolvedAt,
      bet.duration,
    );
    const weight = Math.pow(decayFactor, i);
    weightedSum += score * weight;
    totalWeight += weight;
  }

  return round2(weightedSum / totalWeight);
}

export interface ScoreExplanation {
  rawAverage: number;
  sampleSize: number;
  priorWeight: number;
  sampleWeight: number;
  bayesianDampenedScore: number;
  momentumScore: number;
  credibleInterval90: { lower: number; upper: number };
  explanationText: string;
}

/**
 * Returns a human and machine-readable explanation of how a user's Prediction Score was computed.
 */
export function buildScoreExplanation(
  userHistory: ResolvedBetInput[],
  wins: number,
): ScoreExplanation {
  const n = userHistory.length;
  if (n === 0) {
    return {
      rawAverage: BAYESIAN_PRIOR_SCORE,
      sampleSize: 0,
      priorWeight: 1,
      sampleWeight: 0,
      bayesianDampenedScore: BAYESIAN_PRIOR_SCORE,
      momentumScore: BAYESIAN_PRIOR_SCORE,
      credibleInterval90: { lower: 0, upper: 100 },
      explanationText:
        'New account with 0 resolved predictions. Score is initialized to the neutral prior of 50.',
    };
  }

  const rawTotal = userHistory.reduce(
    (sum, bet) =>
      sum +
      calculatePerBetScoreWithForesight(
        bet.entryPrice,
        bet.result,
        bet.createdAt,
        bet.resolvedAt,
        bet.duration,
      ),
    0,
  );
  const rawAverage = round2(rawTotal / n);
  const bayesianDampenedScore = bayesianDampen(rawAverage, n);
  const sampleWeight = round2(n / (n + BAYESIAN_PRIOR_WEIGHT));
  const priorWeight = round2(BAYESIAN_PRIOR_WEIGHT / (n + BAYESIAN_PRIOR_WEIGHT));
  const momentumScore = calculateMomentumScore(userHistory);
  const credibleInterval90 = calculateCredibleInterval(wins, n);

  const explanationText =
    `Based on ${n} resolved prediction(s) (${wins} win(s)). ` +
    `Raw odds/timing score average is ${rawAverage}. ` +
    `Bayesian shrinkage (${sampleWeight * 100}% sample, ${priorWeight * 100}% prior 50) ` +
    `results in a final score of ${bayesianDampenedScore}. ` +
    `90% win rate credible interval is [${credibleInterval90.lower}%, ${credibleInterval90.upper}%]. ` +
    `Current form / momentum score is ${momentumScore}.`;

  return {
    rawAverage,
    sampleSize: n,
    priorWeight,
    sampleWeight,
    bayesianDampenedScore,
    momentumScore,
    credibleInterval90,
    explanationText,
  };
}

/**
 * Incremental variant: given a running (scoreSum, n) pair and one new bet,
 * returns the updated running totals plus the freshly dampened score.
 */
export function incrementalPredictionScore(
  prevScoreSum: number,
  prevN: number,
  newBet: ResolvedBetInput,
): { scoreSum: number; n: number; score: number } {
  const betScore = calculatePerBetScoreWithForesight(
    newBet.entryPrice,
    newBet.result,
    newBet.createdAt,
    newBet.resolvedAt,
    newBet.duration,
  );
  const scoreSum = prevScoreSum + betScore;
  const n = prevN + 1;
  const rawScore = scoreSum / n;
  return { scoreSum, n, score: bayesianDampen(rawScore, n) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Stats persistence
// ---------------------------------------------------------------------------

export type TxClient = Prisma.TransactionClient | PrismaClient;

export interface ResolvedPredictionForStats {
  userId: string;
  asset: string;
  duration: string;
  entryPrice: number;
  result: 'WON' | 'LOST'; // CANCELLED predictions never reach here
  createdAt?: Date;
  resolvedAt?: Date;
}

/**
 * Incrementally updates `UserAnalytics` and `UserCategoryStats` for a single
 * newly-resolved prediction. Intended to be called inside the same DB
 * transaction as the prediction status update (see settlementWorker.ts).
 */
export async function updateUserStats(
  tx: TxClient,
  resolved: ResolvedPredictionForStats,
): Promise<void> {
  const { userId, asset, duration, entryPrice, result, createdAt, resolvedAt } = resolved;
  const isWin = result === 'WON';

  // --- Overall UserAnalytics -------------------------------------------------
  const prevAnalytics = await tx.userAnalytics.findUnique({ where: { userId } });
  const prevScoreSum = prevAnalytics?.scoreSum ?? 0;
  const prevN = prevAnalytics?.totalPredictions ?? 0;

  const { scoreSum, n, score } = incrementalPredictionScore(prevScoreSum, prevN, {
    entryPrice,
    result,
    createdAt,
    resolvedAt,
    duration,
  });
  const totalWins = (prevAnalytics?.totalWins ?? 0) + (isWin ? 1 : 0);
  const totalLosses = (prevAnalytics?.totalLosses ?? 0) + (isWin ? 0 : 1);
  const accuracy = calculateAccuracy(totalWins, n);

  await tx.userAnalytics.upsert({
    where: { userId },
    create: {
      userId,
      totalPredictions: n,
      totalWins,
      totalLosses,
      accuracy,
      predictionScore: score,
      scoreSum,
    },
    update: {
      totalPredictions: n,
      totalWins,
      totalLosses,
      accuracy,
      predictionScore: score,
      scoreSum,
    },
  });

  // --- Per-category UserCategoryStats ----------------------------------------
  const prevCategory = await tx.userCategoryStats.findUnique({
    where: { userId_asset_duration: { userId, asset, duration } },
  });
  const prevCatScoreSum = prevCategory?.scoreSum ?? 0;
  const prevCatN = prevCategory?.totalPredictions ?? 0;

  const catResult = incrementalPredictionScore(prevCatScoreSum, prevCatN, {
    entryPrice,
    result,
    createdAt,
    resolvedAt,
    duration,
  });
  const catWins = (prevCategory?.totalWins ?? 0) + (isWin ? 1 : 0);
  const catAccuracy = calculateAccuracy(catWins, catResult.n);

  await tx.userCategoryStats.upsert({
    where: { userId_asset_duration: { userId, asset, duration } },
    create: {
      userId,
      asset,
      duration,
      totalPredictions: catResult.n,
      totalWins: catWins,
      accuracy: catAccuracy,
      scoreSum: catResult.scoreSum,
      categoryScore: catResult.score,
    },
    update: {
      totalPredictions: catResult.n,
      totalWins: catWins,
      accuracy: catAccuracy,
      scoreSum: catResult.scoreSum,
      categoryScore: catResult.score,
    },
  });
}
