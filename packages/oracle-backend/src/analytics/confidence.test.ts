import { describe, expect, it } from 'vitest';
import {
  betaQuantile,
  buildScoreExplanation,
  credibleInterval,
  momentumScore,
  regularizedIncompleteBeta,
} from './confidence.js';
import type { ScoredPrediction } from './scoring.js';

const call = (won: boolean, entryPriceCents = 50, daysAgo = 0): ScoredPrediction => ({
  won,
  entryPriceCents,
  settledAt: new Date(Date.now() - daysAgo * 86_400_000),
});

describe('regularizedIncompleteBeta', () => {
  it('is a CDF: 0 at 0, 1 at 1, monotonic between', () => {
    expect(regularizedIncompleteBeta(2, 3, 0)).toBe(0);
    expect(regularizedIncompleteBeta(2, 3, 1)).toBe(1);

    let previous = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = regularizedIncompleteBeta(2, 3, Math.min(x, 1));
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  /** Beta(1,1) is uniform, so its CDF is the identity — an exact check. */
  it('matches the uniform CDF for Beta(1,1)', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(regularizedIncompleteBeta(1, 1, x)).toBeCloseTo(x, 9);
    }
  });

  /** Beta(2,1) has CDF x^2; Beta(1,2) has 1-(1-x)^2. Closed forms to check against. */
  it('matches known closed forms', () => {
    for (const x of [0.2, 0.5, 0.8]) {
      expect(regularizedIncompleteBeta(2, 1, x)).toBeCloseTo(x * x, 9);
      expect(regularizedIncompleteBeta(1, 2, x)).toBeCloseTo(1 - (1 - x) ** 2, 9);
    }
  });

  it('is symmetric about 0.5 for equal parameters', () => {
    expect(regularizedIncompleteBeta(3, 3, 0.5)).toBeCloseTo(0.5, 9);
    expect(regularizedIncompleteBeta(5, 5, 0.3) + regularizedIncompleteBeta(5, 5, 0.7)).toBeCloseTo(
      1,
      9,
    );
  });
});

describe('betaQuantile', () => {
  it('inverts the CDF', () => {
    for (const [a, b] of [
      [2, 3],
      [10, 4],
      [0.5, 0.5],
      [47.5, 16.5],
    ]) {
      for (const p of [0.05, 0.5, 0.95]) {
        const x = betaQuantile(p, a!, b!);
        expect(regularizedIncompleteBeta(a!, b!, x)).toBeCloseTo(p, 6);
      }
    }
  });

  it('returns the identity for the uniform distribution', () => {
    expect(betaQuantile(0.3, 1, 1)).toBeCloseTo(0.3, 6);
  });
});

describe('credibleInterval', () => {
  it('spans everything with no evidence', () => {
    expect(credibleInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
  });

  /**
   * The whole reason this exists: identical headline accuracy, wildly
   * different confidence.
   */
  it('narrows as evidence accumulates', () => {
    const small = credibleInterval(2, 2);
    const large = credibleInterval(200, 200);

    const width = (ci: { lower: number; upper: number }) => ci.upper - ci.lower;

    expect(width(small)).toBeGreaterThan(0.4);
    expect(width(large)).toBeLessThan(0.05);
    expect(width(large)).toBeLessThan(width(small));
  });

  it('brackets the observed rate', () => {
    const ci = credibleInterval(47, 63);
    const observed = 47 / 63;
    expect(ci.lower).toBeLessThan(observed);
    expect(ci.upper).toBeGreaterThan(observed);
  });

  it('stays inside [0,1] at the extremes', () => {
    for (const [w, n] of [
      [0, 5],
      [5, 5],
      [0, 1],
      [1, 1],
    ]) {
      const ci = credibleInterval(w!, n!);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(1);
      expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    }
  });

  it('widens as the requested mass grows', () => {
    const ninety = credibleInterval(30, 50, 0.9);
    const ninetyNine = credibleInterval(30, 50, 0.99);
    expect(ninetyNine.upper - ninetyNine.lower).toBeGreaterThan(ninety.upper - ninety.lower);
  });
});

describe('momentumScore', () => {
  it('is neutral with no history', () => {
    expect(momentumScore([])).toBe(50);
  });

  it('is 100 for all wins and 0 for all losses', () => {
    expect(momentumScore([true, true, true, true])).toBe(100);
    expect(momentumScore([false, false, false, false])).toBe(0);
  });

  /** The property that makes it "momentum" rather than a second accuracy. */
  it('weights recent calls more heavily than old ones', () => {
    const recentWins = momentumScore([true, true, true, false, false, false]);
    const recentLosses = momentumScore([false, false, false, true, true, true]);

    expect(recentWins).toBeGreaterThan(50);
    expect(recentLosses).toBeLessThan(50);
    expect(recentWins).toBeGreaterThan(recentLosses);
  });

  it('moves faster than lifetime accuracy when form turns', () => {
    // 20 wins then 5 straight losses: accuracy is still 80%, form is not.
    const history = [
      ...Array<boolean>(5).fill(false),
      ...Array<boolean>(20).fill(true),
    ];
    const accuracy = (20 / 25) * 100;
    expect(momentumScore(history)).toBeLessThan(accuracy);
  });

  it('respects the half-life parameter', () => {
    const history = [true, true, false, false, false, false, false, false];
    // A shorter half-life forgets the old losses faster, so it reads higher.
    expect(momentumScore(history, 2)).toBeGreaterThan(momentumScore(history, 50));
  });
});

describe('buildScoreExplanation', () => {
  it('explains an empty record without inventing numbers', () => {
    const e = buildScoreExplanation([]);
    expect(e.settled).toBe(0);
    expect(e.accuracy).toBeNull();
    expect(e.momentum).toBe(50);
    expect(e.credibleInterval90).toEqual({ lower: 0, upper: 1 });
    expect(e.factors.length).toBeGreaterThan(0);
    for (const f of e.factors) expect(f.detail).not.toContain('NaN');
  });

  it('carries the same metrics the reputation engine computes', () => {
    const calls = [call(true, 40, 3), call(false, 60, 2), call(true, 30, 1)];
    const e = buildScoreExplanation(calls);

    expect(e.settled).toBe(3);
    expect(e.correct).toBe(2);
    expect(e.accuracy).toBeCloseTo(2 / 3, 9);
    expect(e.factors.find((f) => f.label === 'Score')?.value).toBe(String(e.score));
    expect(e.factors.find((f) => f.label === 'Record')?.value).toBe('2/3');
  });

  it('produces no NaN or undefined in any rendered string', () => {
    for (const calls of [[], [call(true)], [call(false)], [call(true), call(false)]]) {
      for (const f of buildScoreExplanation(calls).factors) {
        expect(f.value).not.toMatch(/NaN|undefined/);
        expect(f.detail).not.toMatch(/NaN|undefined/);
      }
    }
  });
});
