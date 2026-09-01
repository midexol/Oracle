import { randomBytes } from 'node:crypto';

export const nowIso = () => new Date().toISOString();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const randomHex = (bytes = 16) => randomBytes(bytes).toString('hex');

/** Wallet addresses are compared lowercased everywhere in Oracle. */
export const normalizeAddress = (address: string) => address.trim().toLowerCase();

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Numeric columns come back from postgres.js as strings; this is the safe reader. */
export const toNumber = (v: string | number | null | undefined, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Cursor pagination over ISO timestamps, encoded so clients treat it as opaque. */
export const encodeCursor = (value: string) => Buffer.from(value).toString('base64url');
export const decodeCursor = (cursor: string): string | null => {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return Number.isNaN(Date.parse(decoded)) ? null : decoded;
  } catch {
    return null;
  }
};
