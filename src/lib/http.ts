import type { FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

/**
 * Request validation.
 *
 * Zod is applied by hand at the top of each handler rather than through a
 * schema-provider plugin. That keeps validation and handler logic in one
 * readable block, avoids coupling the whole API surface to a plugin's version
 * churn, and still gives fully inferred types below the parse call.
 */

export function parseBody<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  return unwrap(schema.safeParse(req.body), 'body');
}

export function parseQuery<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  return unwrap(schema.safeParse(req.query), 'query');
}

export function parseParams<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  return unwrap(schema.safeParse(req.params), 'params');
}

function unwrap<T>(result: z.SafeParseReturnType<unknown, T>, where: string): T {
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({
    field: i.path.join('.') || where,
    message: i.message,
  }));
  throw badRequest(`Invalid request ${where}`, details);
}

/** Shared shapes reused across modules. */
export const uuidParam = z.object({ id: z.string().uuid('Must be a UUID') });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const assetSchema = z.enum(['BTC', 'ETH', 'SOL', 'SOMI']);
export const durationSchema = z.enum(['1M', '5M', '15M', '1H', '4H', '1D']);
export const directionSchema = z.enum(['UP', 'DOWN']);

/** Decimal string for money and quantities - never a float. */
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,6})?$/.test(v), 'Must be a positive decimal with at most 6 places')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');
