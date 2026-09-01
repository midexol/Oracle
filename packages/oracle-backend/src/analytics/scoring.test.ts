import { describe, expect, it } from 'vitest';
import {
  callsToReachScore,
  computeReputation,
  computeStreaks,
  contractPnlCents,
  impliedProbability,
  predictionScore,
  wilsonLowerBound,
  type ScoredPrediction,
} from './scoring.js';

const at = (n: number) => new Date(2026, 0, 1, 0, 0, n);

const call = (won: boolean, entryPriceCents: number, second = 0): ScoredPrediction => ({
  won,
  entryPriceCents,
  settledAt: at(second),
});

describe('wilsonLowerBound', () => {
  it('is zero with no history', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('does not let a one-off lucky call outrank a proven record', () => {
    const newcomer = wilsonLowerBound(1, 1); // 100% raw accuracy
    const veteran = wilsonLowerBound(47, 63); // 74.6% raw accuracy
    expect(newcomer).toBeLessThan(veteran);
  });

  it('converges upward toward raw accuracy as evidence accumulates', () => {
    const small = wilsonLowerBound(7, 10);
    const large = wilsonLowerBound(700, 1000);
    expect(small).toBeLessThan(large);
    expect(large).toBeCloseTo(0.7, 1);
  });

  it('stays inside [0, 1]', () => {
    for (const [c, n] of [
      [0, 5],
      [5, 5],
      [1, 100],
      [99, 100],
    ] as const) {
      const v = wilsonLowerBound(c, n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('scores a perfect record below 100 - certainty is never claimed', () => {
    expect(predictionScore(20, 20)).toBeLessThan(100);
    expect(predictionScore(20, 20)).toBeGreaterThan(80);
  });
});

describe('impliedProbability and PnL', () => {
  it('reads a 43c contract as a 43% market view', () => {
    expect(impliedProbability(43)).toBeCloseTo(0.43);
  });

  it('pays the rest of the dollar on a win and the stake on a loss', () => {
    expect(contractPnlCents(true, 43)).toBe(57);
    expect(contractPnlCents(false, 43)).toBe(-43);
  });
});

describe('computeReputation', () => {
  it('returns an empty, non-null shape for a user with no settled calls', () => {
    const r = computeReputation([]);
    expect(r).toMatchObject({ settled: 0, correct: 0, accuracy: null, score: 0, edge: null });
  });

  it('computes accuracy and score from settled calls', () => {
    const r = computeReputation([
      call(true, 50, 1),
      call(true, 50, 2),
      call(false, 50, 3),
      call(true, 50, 4),
    ]);
    expect(r.settled).toBe(4);
    expect(r.correct).toBe(3);
    expect(r.accuracy).toBeCloseTo(0.75);
    expect(r.score).toBe(predictionScore(3, 4));
  });

  it('rewards being right when the market disagreed', () => {
    // Same 100% accuracy, very different difficulty.
    const contrarian = computeReputation([call(true, 20, 1), call(true, 25, 2)]);
    const favourite = computeReputation([call(true, 90, 1), call(true, 85, 2)]);

    expect(contrarian.accuracy).toBe(favourite.accuracy);
    expect(contrarian.edge!).toBeGreaterThan(favourite.edge!);
    expect(contrarian.roi!).toBeGreaterThan(favourite.roi!);
  });

  it('reports a negative edge for someone who only rides heavy favourites and misses', () => {
    const r = computeReputation([call(false, 90, 1), call(true, 90, 2)]);
    expect(r.edge!).toBeLessThan(0);
  });

  it('computes ROI in percent of cost', () => {
    // One win at 40c: cost 40, profit 60 => +150%.
    expect(computeReputation([call(true, 40)]).roi).toBeCloseTo(150);
    // One loss at 40c: cost 40, profit -40 => -100%.
    expect(computeReputation([call(false, 40)]).roi).toBeCloseTo(-100);
  });
});

describe('computeStreaks', () => {
  it('counts a live winning streak as positive', () => {
    const { current, best } = computeStreaks([
      call(false, 50, 1),
      call(true, 50, 2),
      call(true, 50, 3),
      call(true, 50, 4),
    ]);
    expect(current).toBe(3);
    expect(best).toBe(3);
  });

  it('counts a live losing streak as negative and keeps the best win run', () => {
    const { current, best } = computeStreaks([
      call(true, 50, 1),
      call(true, 50, 2),
      call(false, 50, 3),
      call(false, 50, 4),
    ]);
    expect(current).toBe(-2);
    expect(best).toBe(2);
  });

  it('orders by settlement time, not array order', () => {
    const { current } = computeStreaks([call(true, 50, 9), call(false, 50, 1)]);
    expect(current).toBe(1);
  });
});

describe('callsToReachScore', () => {
  it('tells a user how many more correct calls a target needs', () => {
    const needed = callsToReachScore(3, 5, 60);
    expect(needed).not.toBeNull();
    expect(predictionScore(3 + needed!, 5 + needed!)).toBeGreaterThanOrEqual(60);
  });

  it('returns null when the target is out of reach in the horizon', () => {
    expect(callsToReachScore(0, 10, 99, 20)).toBeNull();
  });
});
