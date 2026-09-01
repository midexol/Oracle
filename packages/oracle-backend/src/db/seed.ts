import { db, closeDatabase } from './index.js';
import {
  follows,
  markets,
  predictionResults,
  predictions,
  users,
} from './schema/index.js';
import type { Asset, Direction, Duration } from '../dreamdex/types.js';
import { recomputeAllUserStats } from '../analytics/reputation.js';

/**
 * Demo seed.
 *
 * An empty leaderboard is not a leaderboard, and a profile with no history
 * proves nothing - so the seed generates a settled back-catalogue rather than
 * a handful of placeholder rows.
 *
 * Each persona has a hidden skill profile: a real per-segment hit rate and a
 * preference for how far from consensus they are willing to call. The
 * generator then plays out their history honestly - it decides the outcome
 * from their skill, never by writing the answer in - so every number the
 * analytics engine derives afterwards is a genuine computation over genuine
 * data. That matters: if the seed hand-wrote accuracy figures, the reputation
 * engine would be untested by the demo it is meant to showcase.
 */

interface Persona {
  username: string;
  bio: string;
  /** Hit rate per "ASSET:DURATION". Anything unlisted falls back to `baseSkill`. */
  skill: Record<string, number>;
  baseSkill: number;
  /**
   * How contrarian they are. 0 = only backs heavy favourites (high entry
   * prices, low edge even when right); 1 = consistently calls against the
   * market price.
   */
  contrarian: number;
  history: number;
}

const PERSONAS: Persona[] = [
  {
    username: 'alpha',
    bio: 'Short-tenor BTC only. Everything else is noise.',
    skill: { 'BTC:15M': 0.81, 'BTC:1H': 0.72, 'ETH:15M': 0.58 },
    baseSkill: 0.55,
    contrarian: 0.7,
    history: 91,
  },
  {
    username: 'mide',
    bio: 'Reading order flow, calling the close.',
    skill: { 'BTC:15M': 0.78, 'BTC:1H': 0.72, 'ETH:15M': 0.67 },
    baseSkill: 0.6,
    contrarian: 0.55,
    history: 63,
  },
  {
    username: 'quantx',
    bio: 'Volume over conviction. 100+ calls and counting.',
    skill: { 'BTC:15M': 0.69, 'ETH:15M': 0.73, 'SOL:15M': 0.7 },
    baseSkill: 0.66,
    contrarian: 0.3,
    history: 118,
  },
  {
    username: 'novachaser',
    bio: 'ETH maxi. Ask me about the 1H.',
    skill: { 'ETH:15M': 0.71, 'ETH:1H': 0.74 },
    baseSkill: 0.52,
    contrarian: 0.6,
    history: 44,
  },
  {
    username: 'flatline',
    bio: 'Backing the favourite, every single time.',
    skill: {},
    baseSkill: 0.68,
    // Almost never calls against the price: high accuracy, poor edge. Exists
    // to prove the leaderboard can tell the two apart.
    contrarian: 0.05,
    history: 76,
  },
  {
    username: 'coinflipper',
    bio: 'Vibes only.',
    skill: {},
    baseSkill: 0.5,
    contrarian: 0.5,
    history: 31,
  },
  {
    username: 'rookie',
    bio: 'Just started.',
    skill: {},
    baseSkill: 0.75,
    contrarian: 0.5,
    // Two-for-two. Must NOT top the board - this is the Wilson bound's job.
    history: 2,
  },
];

const SEGMENTS: Array<{ asset: Asset; duration: Duration }> = [
  { asset: 'BTC', duration: '15M' },
  { asset: 'BTC', duration: '1H' },
  { asset: 'ETH', duration: '15M' },
  { asset: 'ETH', duration: '1H' },
  { asset: 'SOL', duration: '15M' },
];

const DURATION_MINUTES: Record<Duration, number> = {
  '1M': 1,
  '5M': 5,
  '15M': 15,
  '1H': 60,
  '4H': 240,
  '1D': 1440,
};

/** Deterministic addresses so re-seeding updates rather than duplicates. */
const walletFor = (username: string) =>
  `0x${Buffer.from(username.padEnd(20, '0')).toString('hex').slice(0, 40)}`;

async function main() {
  console.log('Seeding Oracle demo data...\n');

  // ---- personas -----------------------------------------------------------
  const userIds = new Map<string, string>();
  for (const p of PERSONAS) {
    const [row] = await db
      .insert(users)
      .values({ walletAddress: walletFor(p.username), username: p.username, bio: p.bio })
      .onConflictDoUpdate({
        target: users.walletAddress,
        set: { username: p.username, bio: p.bio },
      })
      .returning({ id: users.id });
    userIds.set(p.username, row!.id);
  }
  console.log(`  ${PERSONAS.length} predictors`);

  // ---- historical markets -------------------------------------------------
  // Settled contracts stretching back over the last few days, so profiles and
  // the leaderboard have real depth behind them.
  const totalHistory = Math.max(...PERSONAS.map((p) => p.history));
  const marketRows: Array<{ id: string; asset: Asset; duration: Duration; outcome: Direction }> = [];

  for (let i = 0; i < totalHistory; i++) {
    const segment = SEGMENTS[i % SEGMENTS.length]!;
    const minutes = DURATION_MINUTES[segment.duration];
    const closesAt = new Date(Date.now() - (i + 1) * minutes * 60_000);
    const opensAt = new Date(closesAt.getTime() - minutes * 60_000);
    const outcome: Direction = Math.random() < 0.5 ? 'UP' : 'DOWN';

    const [row] = await db
      .insert(markets)
      .values({
        dreamdexMarketId: `seed-${segment.asset}-${segment.duration}-${i}`,
        asset: segment.asset,
        duration: segment.duration,
        status: 'SETTLED',
        outcome,
        openingReference: '0',
        closingReference: '0',
        upPriceCents: outcome === 'UP' ? 100 : 0,
        downPriceCents: outcome === 'UP' ? 0 : 100,
        opensAt,
        closesAt,
        settledAt: closesAt,
      })
      .onConflictDoUpdate({
        target: markets.dreamdexMarketId,
        set: { status: 'SETTLED', outcome },
      })
      .returning({ id: markets.id });

    marketRows.push({ id: row!.id, ...segment, outcome });
  }
  console.log(`  ${marketRows.length} settled markets`);

  // ---- prediction history -------------------------------------------------
  let predictionCount = 0;

  for (const persona of PERSONAS) {
    const userId = userIds.get(persona.username)!;

    for (let i = 0; i < persona.history; i++) {
      const market = marketRows[i]!;
      const key = `${market.asset}:${market.duration}`;
      const hitRate = persona.skill[key] ?? persona.baseSkill;

      // Play the call out honestly: skill decides whether they were right,
      // and the entry price is chosen independently from their appetite for
      // going against the market. Neither is back-solved from the other.
      const correct = Math.random() < hitRate;
      const direction: Direction = correct
        ? market.outcome
        : market.outcome === 'UP'
          ? 'DOWN'
          : 'UP';

      const entryPriceCents = pickEntryPrice(persona.contrarian);
      const settledAt = new Date(Date.now() - (i + 1) * 15 * 60_000);
      const createdAt = new Date(settledAt.getTime() - 10 * 60_000);

      const [inserted] = await db
        .insert(predictions)
        .values({
          userId,
          marketId: market.id,
          direction,
          entryPriceCents,
          status: correct ? 'WON' : 'LOST',
          createdAt,
          settledAt,
          updatedAt: settledAt,
        })
        .onConflictDoNothing({ target: [predictions.userId, predictions.marketId] })
        .returning({ id: predictions.id });

      if (!inserted) continue;

      await db
        .insert(predictionResults)
        .values({
          predictionId: inserted.id,
          result: correct ? 'WON' : 'LOST',
          marketOutcome: market.outcome,
          entryPriceCents,
          settlementPriceCents: correct ? 100 : 0,
          settledAt,
        })
        .onConflictDoNothing();

      predictionCount++;
    }
  }
  console.log(`  ${predictionCount} settled predictions`);

  // ---- a small follow graph ----------------------------------------------
  const names = [...userIds.keys()];
  for (const follower of names) {
    for (const target of names) {
      if (follower === target || Math.random() > 0.4) continue;
      await db
        .insert(follows)
        .values({ followerId: userIds.get(follower)!, followingId: userIds.get(target)! })
        .onConflictDoNothing();
    }
  }

  // ---- reputation ---------------------------------------------------------
  // Nothing above wrote a single stat. Every number on the leaderboard comes
  // out of this call, computed from the history we just generated.
  const recomputed = await recomputeAllUserStats();
  console.log(`  reputation rebuilt for ${recomputed} predictors\n`);

  console.log('Done. Try:');
  console.log('  GET /api/v1/leaderboard');
  console.log('  GET /api/v1/leaderboard?sort=edge   (watch flatline drop)');
  console.log('  GET /api/v1/users/mide\n');
}

/**
 * Where in the price range this persona likes to call.
 *
 * A contrarian buys cheap sides (20-45c); a favourite-backer buys expensive
 * ones (65-90c). This is what gives edge and ROI something real to measure.
 */
function pickEntryPrice(contrarian: number): number {
  const centre = 80 - contrarian * 40; // 80c at 0, 40c at 1
  const jitter = (Math.random() - 0.5) * 24;
  return Math.max(5, Math.min(95, Math.round(centre + jitter)));
}

main()
  .then(() => closeDatabase())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await closeDatabase();
    process.exit(1);
  });
