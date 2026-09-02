/**
 * Pricing model for the simulator.
 *
 * An Event Contract ("will BTC finish UP?") is a binary option on the spot
 * price versus the strike it opened at. Quoting it properly matters even in a
 * mock: a naive random price wanders and never converges, whereas a real
 * contract's price is pulled toward 1c or 99c as expiry approaches. Getting
 * that right is what makes the feed, the chart and the "called it at 43c"
 * receipt look like a real market instead of noise.
 */

/** Abramowitz & Stegun 7.1.26 — accurate to ~1.5e-7, which is far beyond what cents need. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export const normalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

/** Box-Muller. */
export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Probability the contract finishes UP, given how far spot has moved from the
 * strike and how much time is left.
 *
 * As timeLeft goes to zero the denominator collapses, so the probability
 * saturates to 0 or 1 — exactly the convergence a real binary shows near
 * expiry.
 */
export function upProbability(
  spot: number,
  strike: number,
  timeLeftSeconds: number,
  annualVol: number,
): number {
  if (timeLeftSeconds <= 0) return spot > strike ? 1 : 0;
  const years = timeLeftSeconds / (365 * 24 * 60 * 60);
  const sigma = annualVol * Math.sqrt(years);
  if (sigma <= 1e-12) return spot > strike ? 1 : 0;
  const drift = Math.log(spot / strike);
  return normalCdf(drift / sigma);
}

/** Convert a probability to a tradeable cent price, never 0 or 100. */
export const probabilityToCents = (p: number): number =>
  Math.min(99, Math.max(1, Math.round(p * 100)));

/** One geometric-Brownian-motion step. */
export function stepSpot(spot: number, annualVol: number, dtSeconds: number): number {
  const years = dtSeconds / (365 * 24 * 60 * 60);
  const shock = annualVol * Math.sqrt(years) * gaussian();
  return spot * Math.exp(-0.5 * annualVol * annualVol * years + shock);
}
