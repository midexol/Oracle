import { PrismaClient } from '@prisma/client';
import { updateUserStats } from '../src/services/reputationEngine.js';
import type { PredictionDirection } from '../src/workers/settlementWorker.js';

const prisma = new PrismaClient();

interface SeedBet {
  asset: string;
  duration: string;
  prediction: PredictionDirection;
  entryPrice: number;
  won: boolean;
  createdAt?: Date;
  resolvedAt?: Date;
}

interface SeedUser {
  wallet: string;
  username: string;
  avatar: string;
  bets: SeedBet[];
}

const NOW = new Date();
const TEN_MIN_MS = 10 * 60 * 1000;
const FORTY_FIVE_MIN_MS = 45 * 60 * 1000;

const seedUsers: SeedUser[] = [
  // 1. Veteran (~85 bets, 70% win rate, tight credible interval)
  {
    wallet: '0x2222222222222222222222222222222222bbbb',
    username: 'chidi_trades',
    avatar: 'https://avatars.dreamdex.io/chidi.png',
    bets: buildBets([
      {
        asset: 'BTC',
        duration: '1H',
        entryPrice: 0.55,
        won: true,
        count: 50,
        createdAtOffsetMs: FORTY_FIVE_MIN_MS,
      },
      {
        asset: 'BTC',
        duration: '1H',
        entryPrice: 0.6,
        won: false,
        count: 20,
        createdAtOffsetMs: FORTY_FIVE_MIN_MS,
      },
      {
        asset: 'ETH',
        duration: '1H',
        entryPrice: 0.52,
        won: true,
        count: 10,
        createdAtOffsetMs: FORTY_FIVE_MIN_MS,
      },
      {
        asset: 'ETH',
        duration: '1H',
        entryPrice: 0.58,
        won: false,
        count: 5,
        createdAtOffsetMs: FORTY_FIVE_MIN_MS,
      },
    ]),
  },
  // 2. Lucky Newbie (1 bet, 100% win rate -> heavily dampened score, wide credible interval)
  {
    wallet: '0x3333333333333333333333333333333333cccc',
    username: 'lucky_newbie',
    avatar: 'https://avatars.dreamdex.io/newbie.png',
    bets: buildBets([
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.35,
        won: true,
        count: 1,
        createdAtOffsetMs: TEN_MIN_MS,
      },
    ]),
  },
  // 3. Hot Streak (Mediocre lifetime ~55%, strong recent run last 15 bets -> high momentum score)
  {
    wallet: '0x4444444444444444444444444444444444dddd',
    username: 'ada_predicts',
    avatar: 'https://avatars.dreamdex.io/ada.png',
    bets: buildBets([
      // First 25 bets: 10 wins, 15 losses (cold start)
      {
        asset: 'ETH',
        duration: '15M',
        entryPrice: 0.5,
        won: false,
        count: 15,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      {
        asset: 'ETH',
        duration: '15M',
        entryPrice: 0.5,
        won: true,
        count: 10,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      // Last 15 bets: 12 wins, 3 losses (HOT STREAK!)
      {
        asset: 'ETH',
        duration: '15M',
        entryPrice: 0.45,
        won: true,
        count: 12,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      {
        asset: 'ETH',
        duration: '15M',
        entryPrice: 0.55,
        won: false,
        count: 3,
        createdAtOffsetMs: TEN_MIN_MS,
      },
    ]),
  },
  // 4. Cold Streak (Strong lifetime ~70%, poor recent run last 15 bets -> low momentum score)
  {
    wallet: '0x1111111111111111111111111111111111aaaa',
    username: 'mide',
    avatar: 'https://avatars.dreamdex.io/mide.png',
    bets: buildBets([
      // First 25 bets: 22 wins, 3 losses (strong start)
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.45,
        won: true,
        count: 22,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.55,
        won: false,
        count: 3,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      // Last 15 bets: 4 wins, 11 losses (COLD STREAK!)
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.6,
        won: false,
        count: 11,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.48,
        won: true,
        count: 4,
        createdAtOffsetMs: TEN_MIN_MS,
      },
    ]),
  },
  // 5. Specialist (High volume & 76% win rate in BTC 15M, low in ETH 1H)
  {
    wallet: '0x6666666666666666666666666666666666ffffff',
    username: 'zainab_specialist',
    avatar: 'https://avatars.dreamdex.io/zainab.png',
    bets: buildBets([
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.43,
        won: true,
        count: 38,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      {
        asset: 'BTC',
        duration: '15M',
        entryPrice: 0.58,
        won: false,
        count: 12,
        createdAtOffsetMs: TEN_MIN_MS,
      },
      {
        asset: 'ETH',
        duration: '1H',
        entryPrice: 0.5,
        won: true,
        count: 1,
        createdAtOffsetMs: FORTY_FIVE_MIN_MS,
      },
      {
        asset: 'ETH',
        duration: '1H',
        entryPrice: 0.65,
        won: false,
        count: 3,
        createdAtOffsetMs: FORTY_FIVE_MIN_MS,
      },
    ]),
  },
  // 6. Brand New Account (0 predictions -> empty state)
  {
    wallet: '0x5555555555555555555555555555555555eeee',
    username: 'new_trader',
    avatar: 'https://avatars.dreamdex.io/newtrader.png',
    bets: buildBets([]),
  },
];

function buildBets(
  groups: {
    asset: string;
    duration: string;
    entryPrice: number;
    won: boolean;
    count: number;
    createdAtOffsetMs?: number;
  }[],
): SeedBet[] {
  const bets: SeedBet[] = [];
  for (const g of groups) {
    const offsetMs = g.createdAtOffsetMs ?? TEN_MIN_MS;
    for (let i = 0; i < g.count; i++) {
      const resolvedAt = new Date(NOW.getTime() - i * 60 * 1000);
      const createdAt = new Date(resolvedAt.getTime() - offsetMs);
      bets.push({
        asset: g.asset,
        duration: g.duration,
        prediction: 'UP',
        entryPrice: g.entryPrice,
        won: g.won,
        createdAt,
        resolvedAt,
      });
    }
  }
  return bets;
}

async function main() {
  console.log('Seeding oracle-analytics database...');

  // Idempotent cleanup: remove previous seeded data before seeding
  const seededWallets = seedUsers.map((u) => u.wallet);
  await prisma.prediction.deleteMany({ where: { user: { walletAddress: { in: seededWallets } } } });
  await prisma.userCategoryStats.deleteMany({ where: { user: { walletAddress: { in: seededWallets } } } });
  await prisma.userAnalytics.deleteMany({ where: { user: { walletAddress: { in: seededWallets } } } });
  await prisma.user.deleteMany({ where: { walletAddress: { in: seededWallets } } });

  for (const seedUser of seedUsers) {
    const user = await prisma.user.upsert({
      where: { walletAddress: seedUser.wallet },
      create: {
        walletAddress: seedUser.wallet,
        username: seedUser.username,
        avatar: seedUser.avatar,
      },
      update: { username: seedUser.username, avatar: seedUser.avatar },
    });

    for (const [idx, bet] of seedUser.bets.entries()) {
      const prediction = await prisma.prediction.create({
        data: {
          userId: user.id,
          marketId: `seed-market-${seedUser.wallet.slice(2, 8)}-${idx}`,
          asset: bet.asset,
          duration: bet.duration,
          prediction: bet.prediction,
          entryPrice: bet.entryPrice,
          status: 'RESOLVED',
          result: bet.won ? 'WON' : 'LOST',
          createdAt: bet.createdAt ?? NOW,
          resolvedAt: bet.resolvedAt ?? NOW,
        },
      });

      await updateUserStats(prisma, {
        userId: user.id,
        asset: prediction.asset,
        duration: prediction.duration,
        entryPrice: prediction.entryPrice,
        result: bet.won ? 'WON' : 'LOST',
        createdAt: prediction.createdAt,
        resolvedAt: prediction.resolvedAt ?? undefined,
      });
    }

    console.log(`  seeded ${seedUser.username} (${seedUser.bets.length} bets)`);
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
