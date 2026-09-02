import {
  computeReputation,
  computeStreaks,
  type ReputationMetrics,
  type ScoredPrediction,
} from './scoring.js';

/**
 * Confidence and form.
 *
 * `scoring.ts` answers "how good is this predictor" with a single career
 * number. This module answers the two questions that number cannot:
 *
 *   - How much should you believe it?  (Bayesian credible interval)
 *   - Are they good *right now*?       (momentum)
 *
 * Both are pure functions over settled calls, so they are unit-testable
 * without a database and cannot disagree with the stored stats.
 */

// ---------------------------------------------------------------------------
// Beta distribution
// ---------------------------------------------------------------------------

/**
 * Continued-fraction expansion for the incomplete beta function
 * (Lentz's algorithm). Converges quickly only for x < (a+1)/(a+b+2); callers
 * use the symmetry relation outside that range.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-30;
  const EPS = 3e-12;
  const MAX_ITER = 300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;

    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < EPS) break;
  }

  return h;
}

/** Lanczos approximation of ln gamma(z). */
function logGamma(z: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = z;
  let tmp = z + 5.5;
  tmp -= (z + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (let j = 0; j < 6; j++) series += coefficients[j]! / ++y;
  return -tmp + Math.log((2.5066282746310005 * series) / z);
}

/** Regularized incomplete beta I_x(a, b) — the Beta CDF. */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );

  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Inverse Beta CDF, by bisection.
 *
 * Bisection rather than Newton-Raphson: it cannot diverge or overshoot, and
 * 200 halvings of [0,1] reach machine precision. This runs once per profile
 * view, so robustness matters and speed does not.
 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(a, b, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Bayesian credible interval on a predictor's true win rate, as fractions.
 *
 * Answers what a raw percentage cannot: how much to believe it. 2-for-2 and
 * 200-for-200 are both "100% accurate", but the first spans almost the whole
 * range and the second barely moves. Showing the point estimate alone is what
 * makes a leaderboard feel arbitrary.
 *
 * Uses the Jeffreys prior Beta(0.5, 0.5) — the standard uninformative choice
 * for a binomial proportion. Unlike a uniform prior it does not drag a perfect
 * record away from the extreme harder than the evidence justifies.
 */
export function credibleInterval(
  wins: number,
  total: number,
  mass = 0.9,
): { lower: number; upper: number } {
  if (total <= 0) return { lower: 0, upper: 1 };

  const losses = Math.max(total - wins, 0);
  const tail = (1 - mass) / 2;
  const a = Math.max(wins, 0) + 0.5;
  const b = losses + 0.5;

  return { lower: betaQuantile(tail, a, b), upper: betaQuantile(1 - tail, a, b) };
}

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

/**
 * Recent form on a 0–100 scale, where 50 is neutral.
 *
 * An exponentially weighted average over settled calls, newest first: with the
 * default half-life the 10th-most-recent call counts half as much as the
 * latest. Deliberately separate from the score — the score is a career number
 * that a long record makes slow to move, whereas this is *meant* to move, so a
 * strong predictor going cold is visible before their lifetime accuracy
 * notices.
 *
 * Returns 50 with no history: no evidence in either direction.
 */
export function momentumScore(newestFirst: boolean[], halfLife = 10): number {
  if (newestFirst.length === 0) return 50;

  let weighted = 0;
  let weight = 0;

  for (let i = 0; i < newestFirst.length; i++) {
    const w = Math.pow(0.5, i / halfLife);
    if (newestFirst[i]) weighted += w;
    weight += w;
  }

  return weight === 0 ? 50 : Math.round((100 * weighted) / weight * 100) / 100;
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

export interface ScoreFactor {
  label: string;
  value: string;
  detail: string;
}

export interface ScoreExplanation extends ReputationMetrics {
  momentum: number;
  credibleInterval90: { lower: number; upper: number };
  factors: ScoreFactor[];
}

/**
 * A readable account of how a score was arrived at.
 *
 * The PRD asks for "simple, transparent metrics rather than an unnecessarily
 * complicated AI score", and transparency is the whole point: a predictor who
 * cannot see why they are rated 62 has no reason to trust the ranking, and no
 * idea what would move it.
 */
export function buildScoreExplanation(
  calls: ScoredPrediction[],
  halfLife = 10,
): ScoreExplanation {
  const metrics = computeReputation(calls);
  const streaks = computeStreaks(calls);
  const ci = credibleInterval(metrics.correct, metrics.settled);

  // Oldest -> newest, then reversed: momentum needs newest first.
  const newestFirst = [...calls]
    .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime())
    .map((c) => c.won)
    .reverse();
  const momentum = momentumScore(newestFirst, halfLife);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return {
    ...metrics,
    momentum,
    credibleInterval90: ci,
    factors: [
      {
        label: 'Record',
        value: `${metrics.correct}/${metrics.settled}`,
        detail:
          metrics.accuracy === null
            ? 'No settled calls yet.'
            : `Raw accuracy ${(metrics.accuracy * 100).toFixed(1)}%.`,
      },
      {
        label: 'Confidence',
        value: `${(ci.lower * 100).toFixed(0)}-${(ci.upper * 100).toFixed(0)}%`,
        detail:
          metrics.settled === 0
            ? 'With no settled calls the true win rate is entirely unknown.'
            : `On ${plural(metrics.settled, 'settled call')}, the true win rate is 90% likely to ` +
              `sit in this range. The score uses a lower bound, which is why a short record ` +
              `scores below its headline accuracy.`,
      },
      {
        label: 'Score',
        value: String(metrics.score),
        detail:
          'Wilson lower bound on accuracy, scaled to 100. Rewards being right often, and being ' +
          'right often enough to prove it was not luck.',
      },
      {
        label: 'Edge',
        value:
          metrics.edge === null
            ? 'n/a'
            : `${metrics.edge >= 0 ? '+' : ''}${(metrics.edge * 100).toFixed(1)}pp`,
        detail:
          'Accuracy minus what the market implied at entry. Positive means calling contracts the ' +
          'market priced against you: being right on a 30c underdog beats being right on a 90c favourite.',
      },
      {
        label: 'Momentum',
        value: momentum.toFixed(0),
        detail: `Recent form, half-life ${plural(halfLife, 'call')}. 50 is neutral.`,
      },
      {
        label: 'Streak',
        value:
          streaks.current === 0
            ? 'none'
            : `${Math.abs(streaks.current)} ${streaks.current > 0 ? 'win' : 'loss'}${
                Math.abs(streaks.current) === 1 ? '' : streaks.current > 0 ? 's' : 'es'
              }`,
        detail: `Best run: ${plural(streaks.best, 'win')}.`,
      },
    ],
  };
}
