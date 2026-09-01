import { PrismaClient } from '@prisma/client';

// Prevent multiple PrismaClient instances during dev hot-reload.
declare global {
  // eslint-disable-next-line no-var
  var __oraclePrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__oraclePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__oraclePrisma = prisma;
}
