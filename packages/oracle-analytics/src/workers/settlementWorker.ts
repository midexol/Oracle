import type { Prisma, PrismaClient } from '@prisma/client';
import { updateUserStats } from '../services/reputationEngine.js';

export type PredictionDirection = 'UP' | 'DOWN';
export type PredictionStatus = 'PENDING' | 'RESOLVED';
export type PredictionResult = 'WON' | 'LOST' | 'CANCELLED';

export interface SettlementSummary {
  marketId: string;
  winningOutcome: PredictionDirection;
  resolvedCount: number;
  winners: number;
  losers: number;
}

/**
 * Mockable interface — inject a fake implementation in tests, or the real
 * PrismaClient-backed one in production / the blockchain event listener.
 */
export interface ISettlementWorker {
  resolveMarket(marketId: string, winningOutcome: PredictionDirection): Promise<SettlementSummary>;
}

export class SettlementWorker implements ISettlementWorker {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolves every PENDING prediction for `marketId` against the on-chain
   * winning outcome, updates each prediction's result, and recomputes the
   * affected users' analytics — all inside a single DB transaction so a
   * partial failure never leaves predictions RESOLVED without matching stats.
   */
  async resolveMarket(
    marketId: string,
    winningOutcome: PredictionDirection,
  ): Promise<SettlementSummary> {
    if (!marketId) throw new Error('resolveMarket: marketId is required');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const pending = await tx.prediction.findMany({
        where: { marketId, status: 'PENDING' as PredictionStatus },
      });

      let winners = 0;
      let losers = 0;

      for (const p of pending) {
        const won = p.prediction === winningOutcome;
        const result = won ? 'WON' : 'LOST';
        won ? winners++ : losers++;

        const resolvedAt = new Date();
        await tx.prediction.update({
          where: { id: p.id },
          data: {
            status: 'RESOLVED',
            result,
            resolvedAt,
          },
        });

        await updateUserStats(tx, {
          userId: p.userId,
          asset: p.asset,
          duration: p.duration,
          entryPrice: p.entryPrice,
          result,
          createdAt: p.createdAt,
          resolvedAt,
        });
      }

      return {
        marketId,
        winningOutcome,
        resolvedCount: pending.length,
        winners,
        losers,
      };
    });
  }
}
