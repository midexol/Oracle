/**
 * The scoring model behind Oracle's reputation layer.
 *
 * Everything in this file is a pure function of settled predictions, so the
 * whole model is unit-testable and any number shown in the product can be
 * re-derived from the raw prediction history. That matters: a track record is
 * only worth trading on if it is auditable.
 *
 * The PRD asks for simple, transparent metrics now and difficulty adjustment
 * later. This implements exactly that split:
 *
 *   score  - the headline 0..100 number. Confidence-adjusted accuracy only.
 *            Explainable in one sentence to a user.
 *   edge   - difficulty adjustment, computed and stored from day one but
 *            presented as a secondary stat.
 *   roi    - what the edge was worth in cents on DreamDEX.
 */

/** One settled prediction, reduced to what scoring actually needs. */
export interface ScoredPrediction {
  /** Did the called side pay out. */
  won: boolean;
  /** Price in cents of the side the user called, at the moment they called it. */
  entryPriceCents: number;
  /** Used only for streak ordering; newest first is not assumed. */
  settledAt: Date;
}

export interface ReputationMetrics {
  settled: number;
  correct: number;
  /** correct / settled, or null with no settled predictions. */
  accuracy: number | null;
  /** 0..100 headline Prediction Score. */
  score: number;
  /** Mean (outcome - market implied probability). Positive beats the market. */
  edge: number | null;
  /** Return on cost, percent. +133 means 43c contracts that paid 100c. */
  roi: number | null;
  avgEntryPriceCents: number | null;
  /** Signed: +3 is three straight wins, -2 is two straight losses. */
  currentStreak: number;
  bestStreak: number;
}

/**
 * Wilson score interval, lower bound.
 *
 * This is the single most important choice in the whole reputation system.
 *
 * Raw accuracy makes a leaderboard useless: someone who called one market and
 * got it right sits at 100% above a predictor who is 47-for-63. The Wilson
 * lower bound asks a better question - "given this record, what is the
 * pessimistic estimate of their true hit rate?" - so evidence, not luck, is
 * what climbs the board. A 1-for-1 record scores 21; 47-for-63 scores 62.
 *
 * z = 1.96 is the 95% bound. It is a standard statistic, not a bespoke
 * formula, which is what keeps the score explainable.
 */
export function wilsonLowerBound(correct: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const phat = correct / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  const lower = (centre - margin) / denominator;
  return Math.max(0, Math.min(1, lower));
}

/**
 * The market's implied probability that the called side wins.
 *
 * An Event Contract priced at 43c pays 100c, so the market is saying "43%".
 * Calling UP at 43c and being right is genuinely harder than calling UP at
 * 85c, and this is the number that lets us say so.
 */
export const impliedProbability = (entryPriceCents: number): number =>
  clamp01(entryPriceCents / 100);

/**
 * Profit in cents from one contract, given a 100c payout on the winning side.
 * Right at 43c earns +57c; wrong at 43c loses the 43c paid.
 */
export const contractPnlCents = (won: boolean, entryPriceCents: number): number =>
  won ? 100 - entryPriceCents : -entryPriceCents;

/** The 0..100 Prediction Score shown on profiles and the leaderboard. */
export const predictionScore = (correct: number, settled: number): number =>
  Math.round(100 * wilsonLowerBound(correct, settled));

/**
 * Full metric set for one user, or one (asset, duration) segment of a user.
 *
 * Only settled predictions are passed in - PENDING calls must never move a
 * score, and VOID ones (cancelled markets) are excluded entirely so an
 * exchange-side cancellation cannot damage anyone's record.
 */
export function computeReputation(predictions: ScoredPrediction[]): ReputationMetrics {
  const settled = predictions.length;

  if (settled === 0) {
    return {
      settled: 0,
      correct: 0,
      accuracy: null,
      score: 0,
      edge: null,
      roi: null,
      avgEntryPriceCents: null,
      currentStreak: 0,
      bestStreak: 0,
    };
  }

  let correct = 0;
  let edgeSum = 0;
  let pnlSum = 0;
  let costSum = 0;
  let entrySum = 0;

  for (const p of predictions) {
    const outcome = p.won ? 1 : 0;
    if (p.won) correct++;
    edgeSum += outcome - impliedProbability(p.entryPriceCents);
    pnlSum += contractPnlCents(p.won, p.entryPriceCents);
    costSum += p.entryPriceCents;
    entrySum += p.entryPriceCents;
  }

  const { current, best } = computeStreaks(predictions);

  return {
    settled,
    correct,
    accuracy: correct / settled,
    score: predictionScore(correct, settled),
    edge: edgeSum / settled,
    // costSum is a sum of positive cent prices, so it is only zero when there
    // are no predictions - already handled above.
    roi: costSum > 0 ? (pnlSum / costSum) * 100 : null,
    avgEntryPriceCents: Math.round(entrySum / settled),
    currentStreak: current,
    bestStreak: best,
  };
}

/**
 * Streaks over settlement order.
 *
 * currentStreak is signed so the UI can show "3 in a row" or "cold, 2 straight
 * misses" from one field. bestStreak only ever tracks wins.
 */
export function computeStreaks(predictions: ScoredPrediction[]): {
  current: number;
  best: number;
} {
  if (predictions.length === 0) return { current: 0, best: 0 };

  const ordered = [...predictions].sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());

  let best = 0;
  let run = 0;
  for (const p of ordered) {
    run = p.won ? Math.max(run, 0) + 1 : 0;
    if (run > best) best = run;
  }

  // Walk backwards from the newest settlement to get the live streak.
  const newestWon = ordered[ordered.length - 1]!.won;
  let current = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i]!.won !== newestWon) break;
    current++;
  }

  return { current: newestWon ? current : -current, best };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How many more correct calls a user needs to reach a target score.
 *
 * Powers the "you are 4 correct calls from the top 10" nudge, which is the
 * cheapest way to turn a leaderboard into a reason to keep predicting.
 * Returns null if the target is unreachable within `horizon` more calls.
 */
export function callsToReachScore(
  correct: number,
  settled: number,
  targetScore: number,
  horizon = 200,
): number | null {
  for (let i = 1; i <= horizon; i++) {
    if (predictionScore(correct + i, settled + i) >= targetScore) return i;
  }
  return null;
}
