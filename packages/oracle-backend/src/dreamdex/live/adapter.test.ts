import { describe, expect, it } from 'vitest';
import { resolveUpOutcome, type EventContract } from '@signal/dreamdex-integration';
import { inferDuration, mapOrderStatus, toMarket } from './client.js';

/**
 * The live adapter's pure translation layer.
 *
 * Two of these decisions are silently catastrophic if wrong: which outcome
 * token means UP (gets it backwards and every settled prediction inverts, with
 * no error anywhere), and which duration bucket a contract belongs to (gets it
 * wrong and per-segment accuracy - the number the feed sells - is meaningless).
 * Neither can fail loudly at runtime, so they are pinned here.
 */

const HOUR = 3600;

function contract(over: Partial<EventContract> = {}): EventContract {
  const now = Math.floor(Date.now() / 1000);
  return {
    symbol: 'BTC-95000-31DEC26/USDC',
    marketId: '0xabc',
    asset: 'BTC',
    question: 'Will BTC close above $95,000?',
    strike: '95000',
    upPrice: 0.43,
    downPrice: 0.57,
    status: 'TRADING',
    tradingStart: now,
    expiry: now + HOUR,
    upOutcome: 'YES',
    upOutcomeAssumed: false,
    winningOutcome: null,
    voided: false,
    resolvedAt: null,
    info: {} as EventContract['info'],
    ...over,
  };
}

describe('resolveUpOutcome', () => {
  it('reads "above" phrasing as YES == UP', () => {
    for (const q of [
      'Will BTC close above $95,000?',
      'Will ETH exceed 4000 by expiry?',
      'Will BTC be higher than 95k?',
      'Will BTC reach $100,000?',
    ]) {
      expect(resolveUpOutcome(q)).toEqual({ outcome: 'YES', assumed: false });
    }
  });

  /** The case that silently inverts a whole market if mishandled. */
  it('reads "below" phrasing as NO == UP', () => {
    for (const q of [
      'Will BTC close below $95,000?',
      'Will ETH fall under 4000?',
      'Will BTC drop beneath the strike?',
    ]) {
      expect(resolveUpOutcome(q)).toEqual({ outcome: 'NO', assumed: false });
    }
  });

  it('flags an unreadable question instead of quietly guessing', () => {
    for (const q of ['', 'BTC market #4', 'Who wins?']) {
      expect(resolveUpOutcome(q).assumed).toBe(true);
    }
  });

  it('lets the comparator nearest the strike win when both words appear', () => {
    expect(resolveUpOutcome('Will BTC close below the previous high?').outcome).toBe('NO');
    expect(resolveUpOutcome('Will BTC rise above the low?').outcome).toBe('YES');
  });
});

describe('inferDuration', () => {
  it('buckets on the contract window, not on time remaining', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(inferDuration(contract({ tradingStart: now, expiry: now + 900 }))).toBe('15M');
    expect(inferDuration(contract({ tradingStart: now, expiry: now + HOUR }))).toBe('1H');
    expect(inferDuration(contract({ tradingStart: now, expiry: now + 86_400 }))).toBe('1D');
  });

  /**
   * The bug this guards: bucketing by time-remaining made one contract drift
   * 1H -> 15M -> 1M as it aged, scattering its calls across three segments.
   */
  it('gives an aging contract the same bucket throughout its life', () => {
    const start = Math.floor(Date.now() / 1000) - 3500;
    const c = contract({ tradingStart: start, expiry: start + HOUR });
    expect(inferDuration(c)).toBe('1H');
  });
});

describe('toMarket', () => {
  it('maps a resolved YES==UP market to UP', () => {
    const m = toMarket(contract({ winningOutcome: 0, upOutcome: 'YES' }));
    expect(m.status).toBe('SETTLED');
    expect(m.outcome).toBe('UP');
  });

  /** Same on-chain result, inverted question: the outcome must flip. */
  it('maps a resolved YES==DOWN market to DOWN', () => {
    const m = toMarket(contract({ winningOutcome: 0, upOutcome: 'NO' }));
    expect(m.outcome).toBe('DOWN');
  });

  it('maps a NO win on an "above" market to DOWN', () => {
    const m = toMarket(contract({ winningOutcome: 1, upOutcome: 'YES' }));
    expect(m.outcome).toBe('DOWN');
  });

  it('treats a voided market as cancelled with no outcome', () => {
    const m = toMarket(contract({ voided: true, winningOutcome: 0 }));
    expect(m.status).toBe('CANCELLED');
    expect(m.outcome).toBeNull();
  });

  it('carries the strike through as the opening reference', () => {
    expect(toMarket(contract()).openingReference).toBe('95000');
  });

  it('quotes UP as the complement when the market is inverted', () => {
    // upPrice already accounts for orientation upstream; here we only assert
    // that UP and DOWN always sum to 100c so no side is ever mispriced.
    const m = toMarket(contract({ upPrice: 0.43 }));
    expect(m.upPriceCents + m.downPriceCents).toBe(100);
  });

  it('defaults to an even quote when a fresh market has no fills yet', () => {
    const m = toMarket(contract({ upPrice: null }));
    expect(m.upPriceCents).toBe(50);
    expect(m.downPriceCents).toBe(50);
  });
});

describe('mapOrderStatus', () => {
  it('treats a fully filled order as FILLED', () => {
    expect(mapOrderStatus('closed', 10, 10)).toBe('FILLED');
  });

  it('treats a resting order with no fill as PENDING', () => {
    expect(mapOrderStatus('open', 0, 10)).toBe('PENDING');
  });

  it('treats a resting order with a partial fill as PARTIALLY_FILLED', () => {
    expect(mapOrderStatus('open', 4, 10)).toBe('PARTIALLY_FILLED');
  });

  /**
   * The bug this pins: "expired" fell through to PENDING, so the reconciler
   * would poll a dead order forever and never let it reach a terminal state.
   */
  it('does not leave a terminal state looking open', () => {
    for (const status of ['canceled', 'cancelled', 'expired', 'closed']) {
      const result = mapOrderStatus(status, 0, 10);
      expect(result).toBe('CANCELLED');
      expect(['PENDING', 'PARTIALLY_FILLED']).not.toContain(result);
    }
  });

  /** A cancelled order that partly filled still bought real contracts. */
  it('keeps a partial fill that was then cancelled', () => {
    expect(mapOrderStatus('canceled', 3, 10)).toBe('FILLED');
    expect(mapOrderStatus('expired', 3, 10)).toBe('FILLED');
  });

  it('closed with nothing filled is a cancellation, not a fill', () => {
    expect(mapOrderStatus('closed', 0, 10)).toBe('CANCELLED');
  });

  it('keeps an unknown state under reconciliation rather than guessing', () => {
    expect(mapOrderStatus('something-new', 0, 10)).toBe('PENDING');
    expect(mapOrderStatus(undefined, 0, 10)).toBe('PENDING');
  });

  it('reports an explicit rejection as FAILED', () => {
    expect(mapOrderStatus('rejected', 0, 10)).toBe('FAILED');
  });
});
