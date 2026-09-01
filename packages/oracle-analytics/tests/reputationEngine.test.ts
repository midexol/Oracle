import { describe, it, expect } from 'vitest';
import {
  calculateAccuracy,
  calculatePerBetScore,
  calculateForesightMultiplier,
  calculatePerBetScoreWithForesight,
  calculatePredictionScore,
  bayesianDampen,
  incrementalPredictionScore,
  calculateCredibleInterval,
  calculateMomentumScore,
  buildScoreExplanation,
  BAYESIAN_PRIOR_SCORE,
  type ResolvedBetInput,
} from '../src/services/reputationEngine.js';

describe('calculateAccuracy', () => {
  it('returns 0 for zero total predictions (no NaN / divide-by-zero)', () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
  });

  it('computes a standard percentage', () => {
    expect(calculateAccuracy(3, 4)).toBe(75);
    expect(calculateAccuracy(1, 3)).toBeCloseTo(33.33, 2);
  });

  it('handles a perfect record', () => {
    expect(calculateAccuracy(10, 10)).toBe(100);
  });

  it('throws if wins exceeds total', () => {
    expect(() => calculateAccuracy(5, 4)).toThrow();
  });

  it('throws on negative inputs', () => {
    expect(() => calculateAccuracy(-1, 4)).toThrow();
  });
});

describe('calculatePerBetScore (odds alpha)', () => {
  it('rewards winning as an underdog more than winning as a favorite', () => {
    const underdogWin = calculatePerBetScore(0.43, 'WON');
    const favoriteWin = calculatePerBetScore(0.85, 'WON');
    expect(underdogWin).toBeGreaterThan(favoriteWin);
    expect(underdogWin).toBeGreaterThan(50);
    expect(favoriteWin).toBeGreaterThan(50);
  });

  it('penalizes losing as a heavy favorite more than losing as an underdog', () => {
    const favoriteLoss = calculatePerBetScore(0.85, 'LOST');
    const underdogLoss = calculatePerBetScore(0.2, 'LOST');
    expect(favoriteLoss).toBeLessThan(underdogLoss);
    expect(favoriteLoss).toBeLessThan(50);
    expect(underdogLoss).toBeLessThan(50);
  });

  it('rejects out-of-range entry prices', () => {
    expect(() => calculatePerBetScore(0, 'WON')).toThrow();
    expect(() => calculatePerBetScore(1, 'WON')).toThrow();
    expect(() => calculatePerBetScore(1.5, 'WON')).toThrow();
    expect(() => calculatePerBetScore(-0.1, 'LOST')).toThrow();
  });
});

describe('calculateForesightMultiplier', () => {
  it('rewards early entry higher than late entry', () => {
    const resolvedAt = new Date('2026-09-01T12:00:00Z');
    // Entered 54 mins before resolution in a 1H (60m) window = 90% time remaining
    const earlyCreatedAt = new Date('2026-09-01T11:06:00Z');
    // Entered 3 mins before resolution in a 1H (60m) window = 5% time remaining
    const lateCreatedAt = new Date('2026-09-01T11:57:00Z');

    const earlyMultiplier = calculateForesightMultiplier(earlyCreatedAt, resolvedAt, '1H');
    const lateMultiplier = calculateForesightMultiplier(lateCreatedAt, resolvedAt, '1H');

    expect(earlyMultiplier).toBeGreaterThan(lateMultiplier);
    expect(earlyMultiplier).toBeGreaterThan(1.0);
    expect(lateMultiplier).toBeLessThan(1.0);
  });

  it('bounds the multiplier within [0.85, 1.15]', () => {
    const resolvedAt = new Date('2026-09-01T12:00:00Z');
    const earliestCreatedAt = new Date('2026-09-01T11:00:00Z');
    const latestCreatedAt = new Date('2026-09-01T12:00:00Z');

    const maxMultiplier = calculateForesightMultiplier(earliestCreatedAt, resolvedAt, '1H');
    const minMultiplier = calculateForesightMultiplier(latestCreatedAt, resolvedAt, '1H');

    expect(maxMultiplier).toBeLessThanOrEqual(1.15);
    expect(minMultiplier).toBeGreaterThanOrEqual(0.85);
  });

  it('falls back to 1.0 for unknown duration label without throwing', () => {
    const resolvedAt = new Date('2026-09-01T12:00:00Z');
    const createdAt = new Date('2026-09-01T11:00:00Z');
    expect(calculateForesightMultiplier(createdAt, resolvedAt, 'UNKNOWN_DURATION')).toBe(1.0);
  });

  it('falls back to 1.0 when resolvedAt <= createdAt without throwing', () => {
    const resolvedAt = new Date('2026-09-01T12:00:00Z');
    const invalidCreatedAt = new Date('2026-09-01T12:30:00Z');
    expect(calculateForesightMultiplier(invalidCreatedAt, resolvedAt, '1H')).toBe(1.0);
  });
});

describe('calculatePerBetScoreWithForesight', () => {
  it('scores an early entry higher than a late entry for an identical winning bet', () => {
    const resolvedAt = new Date('2026-09-01T12:00:00Z');
    const earlyCreatedAt = new Date('2026-09-01T11:06:00Z');
    const lateCreatedAt = new Date('2026-09-01T11:57:00Z');

    const earlyScore = calculatePerBetScoreWithForesight(0.5, 'WON', earlyCreatedAt, resolvedAt, '1H');
    const lateScore = calculatePerBetScoreWithForesight(0.5, 'WON', lateCreatedAt, resolvedAt, '1H');

    expect(earlyScore).toBeGreaterThan(lateScore);
  });

  it('falls back to base calculatePerBetScore when dates or duration are omitted', () => {
    const baseScore = calculatePerBetScore(0.43, 'WON');
    const fallbackScore = calculatePerBetScoreWithForesight(0.43, 'WON');
    expect(fallbackScore).toBe(baseScore);
  });
});

describe('bayesianDampen', () => {
  it('returns the prior exactly when n = 0', () => {
    expect(bayesianDampen(100, 0)).toBe(BAYESIAN_PRIOR_SCORE);
  });

  it('pulls a small sample strongly toward the prior', () => {
    // 1 perfect bet (raw 100) should land much closer to 50 than to 100.
    const score = bayesianDampen(100, 1);
    expect(score).toBeCloseTo((1 / 11) * 100 + (10 / 11) * 50, 2);
    expect(score).toBeLessThan(60);
  });

  it('trusts a large sample close to its raw score', () => {
    const score = bayesianDampen(80, 500);
    expect(score).toBeGreaterThan(79);
  });
});

describe('calculatePredictionScore', () => {
  it('returns the neutral prior for a brand new account (0 predictions)', () => {
    expect(calculatePredictionScore([])).toBe(BAYESIAN_PRIOR_SCORE);
  });

  it('does NOT let a single lucky underdog win outrank a consistent veteran', () => {
    // 1 win, entry_price = 0.43 (underdog) — the example from the spec.
    const luckyNewbie: ResolvedBetInput[] = [{ entryPrice: 0.43, result: 'WON' }];

    // 50 trades, 75% win rate, moderate entry prices around 0.5-0.6.
    const veteranHistory: ResolvedBetInput[] = [
      ...Array.from({ length: 38 }, () => ({ entryPrice: 0.55, result: 'WON' as const })),
      ...Array.from({ length: 12 }, () => ({ entryPrice: 0.55, result: 'LOST' as const })),
    ];

    const newbieScore = calculatePredictionScore(luckyNewbie);
    const veteranScore = calculatePredictionScore(veteranHistory);

    expect(veteranHistory).toHaveLength(50);
    expect(calculateAccuracy(38, 50)).toBe(76);
    expect(veteranScore).toBeGreaterThan(newbieScore);
    // The newbie's single win should be heavily dampened toward 50.
    expect(newbieScore).toBeLessThan(60);
  });

  it('produces a higher score for higher accuracy at equal sample size', () => {
    const strong: ResolvedBetInput[] = [
      ...Array.from({ length: 18 }, () => ({ entryPrice: 0.5, result: 'WON' as const })),
      ...Array.from({ length: 2 }, () => ({ entryPrice: 0.5, result: 'LOST' as const })),
    ];
    const weak: ResolvedBetInput[] = [
      ...Array.from({ length: 8 }, () => ({ entryPrice: 0.5, result: 'WON' as const })),
      ...Array.from({ length: 12 }, () => ({ entryPrice: 0.5, result: 'LOST' as const })),
    ];
    expect(calculatePredictionScore(strong)).toBeGreaterThan(calculatePredictionScore(weak));
  });
});

describe('calculateCredibleInterval', () => {
  it('returns [0, 100] for 0 total predictions', () => {
    expect(calculateCredibleInterval(0, 0)).toEqual({ lower: 0, upper: 100 });
  });

  it('produces a narrow interval for large sample sizes', () => {
    const ci = calculateCredibleInterval(70, 100);
    const width = ci.upper - ci.lower;
    expect(width).toBeLessThan(20);
    expect(ci.lower).toBeGreaterThan(50);
  });

  it('produces a wide interval for small sample sizes', () => {
    const ci = calculateCredibleInterval(1, 1);
    const width = ci.upper - ci.lower;
    expect(width).toBeGreaterThan(40);
  });
});

describe('calculateMomentumScore', () => {
  it('returns neutral prior for empty history', () => {
    expect(calculateMomentumScore([])).toBe(BAYESIAN_PRIOR_SCORE);
  });

  it('weights recent wins higher than older losses', () => {
    const history: ResolvedBetInput[] = [
      ...Array.from({ length: 10 }, () => ({ entryPrice: 0.5, result: 'WON' as const })),
      ...Array.from({ length: 5 }, () => ({ entryPrice: 0.5, result: 'LOST' as const })),
    ];
    const momentum = calculateMomentumScore(history);
    expect(momentum).toBeGreaterThan(60);
  });
});

describe('buildScoreExplanation', () => {
  it('returns full breakdown for a user history', () => {
    const history: ResolvedBetInput[] = [
      { entryPrice: 0.45, result: 'WON' },
      { entryPrice: 0.55, result: 'LOST' },
    ];
    const explanation = buildScoreExplanation(history, 1);
    expect(explanation.sampleSize).toBe(2);
    expect(explanation.bayesianDampenedScore).toBeDefined();
    expect(explanation.explanationText).toContain('Based on 2 resolved prediction(s)');
  });
});

describe('incrementalPredictionScore', () => {
  it('matches the batch calculation when applied bet-by-bet', () => {
    const bets: ResolvedBetInput[] = [
      { entryPrice: 0.4, result: 'WON' },
      { entryPrice: 0.6, result: 'LOST' },
      { entryPrice: 0.5, result: 'WON' },
    ];

    let scoreSum = 0;
    let n = 0;
    let lastScore = BAYESIAN_PRIOR_SCORE;
    for (const bet of bets) {
      const result = incrementalPredictionScore(scoreSum, n, bet);
      scoreSum = result.scoreSum;
      n = result.n;
      lastScore = result.score;
    }

    expect(n).toBe(3);
    expect(lastScore).toBe(calculatePredictionScore(bets));
  });
});
