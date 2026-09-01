import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  buildScoreExplanation,
  calculateCredibleInterval,
  calculateMomentumScore,
  type ResolvedBetInput,
} from '../services/reputationEngine.js';

export const analyticsRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// POST /api/predictions
// ---------------------------------------------------------------------------

const createPredictionSchema = z.object({
  wallet: z.string().min(3),
  marketId: z.string().min(1),
  asset: z.string().min(1),
  duration: z.string().min(1),
  prediction: z.enum(['UP', 'DOWN']),
  entryPrice: z.number().gt(0).lt(1),
  username: z.string().optional(),
  avatar: z.string().optional(),
});

analyticsRouter.post(
  '/predictions',
  asyncHandler(async (req, res) => {
    const parsed = createPredictionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.errors.map((e) => e.message).join(', '));
    }
    const { wallet, marketId, asset, duration, prediction, entryPrice, username, avatar } =
      parsed.data;

    const user = await prisma.user.upsert({
      where: { walletAddress: wallet },
      create: { walletAddress: wallet, username, avatar },
      update: {},
    });

    const created = await prisma.prediction.create({
      data: {
        userId: user.id,
        marketId,
        asset: asset.toUpperCase(),
        duration: duration.toUpperCase(),
        prediction,
        entryPrice,
        status: 'PENDING',
      },
    });

    res.status(201).json({ data: created });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/users/:wallet/profile
// ---------------------------------------------------------------------------

analyticsRouter.get(
  '/users/:wallet/profile',
  asyncHandler(async (req, res) => {
    const wallet = req.params.wallet;
    if (!wallet) throw new ApiError(400, 'wallet is required');

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ walletAddress: { equals: wallet } }, { username: { equals: wallet } }],
      },
      include: {
        analytics: true,
        categoryStats: { orderBy: [{ asset: 'asc' }, { duration: 'asc' }] },
        predictions: {
          where: { status: 'RESOLVED', result: { in: ['WON', 'LOST'] } },
          orderBy: { resolvedAt: 'desc' },
        },
      },
    });

    if (!user) throw new ApiError(404, 'User not found');

    const userHistory: ResolvedBetInput[] = user.predictions.map((p) => ({
      entryPrice: p.entryPrice,
      result: p.result as 'WON' | 'LOST',
      createdAt: p.createdAt,
      resolvedAt: p.resolvedAt ?? undefined,
      duration: p.duration,
    }));

    const wins = user.analytics?.totalWins ?? 0;
    const total = user.analytics?.totalPredictions ?? 0;

    res.json({
      data: {
        wallet: user.walletAddress,
        username: user.username,
        avatar: user.avatar,
        totalPredictions: total,
        totalWins: wins,
        totalLosses: user.analytics?.totalLosses ?? 0,
        winRate: user.analytics?.accuracy ?? 0,
        predictionScore: user.analytics?.predictionScore ?? 50,
        momentumScore: calculateMomentumScore(userHistory),
        credibleInterval90: calculateCredibleInterval(wins, total),
        categoryBreakdown: user.categoryStats.map((c: (typeof user.categoryStats)[number]) => ({
          label: `${c.asset} ${c.duration}`,
          asset: c.asset,
          duration: c.duration,
          totalPredictions: c.totalPredictions,
          totalWins: c.totalWins,
          accuracy: c.accuracy,
          categoryScore: c.categoryScore,
        })),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/users/:wallet/score-breakdown
// ---------------------------------------------------------------------------

analyticsRouter.get(
  '/users/:wallet/score-breakdown',
  asyncHandler(async (req, res) => {
    const walletParam = req.params.wallet;
    if (!walletParam) throw new ApiError(400, 'wallet is required');

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ walletAddress: { equals: walletParam } }, { username: { equals: walletParam } }],
      },
      include: {
        analytics: true,
        predictions: {
          where: { status: 'RESOLVED', result: { in: ['WON', 'LOST'] } },
          orderBy: { resolvedAt: 'desc' },
        },
      },
    });

    if (!user) throw new ApiError(404, 'User not found');

    const userHistory: ResolvedBetInput[] = user.predictions.map((p) => ({
      entryPrice: p.entryPrice,
      result: p.result as 'WON' | 'LOST',
      createdAt: p.createdAt,
      resolvedAt: p.resolvedAt ?? undefined,
      duration: p.duration,
    }));

    const wins = user.analytics?.totalWins ?? user.predictions.filter((p) => p.result === 'WON').length;
    const explanation = buildScoreExplanation(userHistory, wins);

    res.json({ data: explanation });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/predictions/:id/context
// ---------------------------------------------------------------------------

analyticsRouter.get(
  '/predictions/:id/context',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new ApiError(400, 'id is required');

    const prediction = await prisma.prediction.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!prediction) throw new ApiError(404, 'Prediction not found');

    const categoryStats = await prisma.userCategoryStats.findUnique({
      where: {
        userId_asset_duration: {
          userId: prediction.userId,
          asset: prediction.asset,
          duration: prediction.duration,
        },
      },
    });

    const displayName = prediction.user.username ?? shortenWallet(prediction.user.walletAddress);
    const label = `${prediction.asset} ${prediction.duration}`;

    let contextText: string;
    if (!categoryStats || categoryStats.totalPredictions === 0) {
      contextText = `${displayName} has no track record on ${label} markets yet.`;
    } else {
      contextText = `${displayName} has correctly predicted ${label} markets ${categoryStats.accuracy}% of the time (${categoryStats.totalWins}/${categoryStats.totalPredictions}).`;
    }

    res.json({
      data: {
        predictionId: prediction.id,
        contextText,
        stats: categoryStats
          ? {
              accuracy: categoryStats.accuracy,
              totalWins: categoryStats.totalWins,
              totalPredictions: categoryStats.totalPredictions,
              categoryScore: categoryStats.categoryScore,
            }
          : null,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/leaderboard
// ---------------------------------------------------------------------------

const leaderboardQuerySchema = z.object({
  asset: z.string().optional().default('all'),
  duration: z.string().optional().default('all'),
  sortBy: z.enum(['prediction_score', 'accuracy']).optional().default('prediction_score'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

analyticsRouter.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const parsed = leaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.errors.map((e) => e.message).join(', '));
    }
    const { asset, duration, sortBy, limit } = parsed.data;
    const isFiltered = asset.toLowerCase() !== 'all' || duration.toLowerCase() !== 'all';

    if (isFiltered) {
      const where: { asset?: string; duration?: string } = {};
      if (asset.toLowerCase() !== 'all') where.asset = asset.toUpperCase();
      if (duration.toLowerCase() !== 'all') where.duration = duration.toUpperCase();

      const rows = await prisma.userCategoryStats.findMany({
        where,
        include: { user: { select: { walletAddress: true, username: true, avatar: true } } },
        orderBy: { [sortBy === 'prediction_score' ? 'categoryScore' : 'accuracy']: 'desc' },
        take: limit,
      });

      res.json({
        data: rows.map((r: (typeof rows)[number], i: number) => ({
          rank: i + 1,
          wallet: r.user.walletAddress,
          username: r.user.username,
          avatar: r.user.avatar,
          asset: r.asset,
          duration: r.duration,
          totalPredictions: r.totalPredictions,
          totalWins: r.totalWins,
          accuracy: r.accuracy,
          predictionScore: r.categoryScore,
        })),
      });
      return;
    }

    const rows = await prisma.userAnalytics.findMany({
      include: { user: { select: { walletAddress: true, username: true, avatar: true } } },
      orderBy: { [sortBy === 'prediction_score' ? 'predictionScore' : 'accuracy']: 'desc' },
      take: limit,
    });

    res.json({
      data: rows.map((r: (typeof rows)[number], i: number) => ({
        rank: i + 1,
        wallet: r.user.walletAddress,
        username: r.user.username,
        avatar: r.user.avatar,
        totalPredictions: r.totalPredictions,
        totalWins: r.totalWins,
        totalLosses: r.totalLosses,
        accuracy: r.accuracy,
        predictionScore: r.predictionScore,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Router-level error handler
// ---------------------------------------------------------------------------

analyticsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

function shortenWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}
