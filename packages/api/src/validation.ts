import { z } from 'zod';
import { badRequest } from './errors.js';

/**
 * Request validation. Everything crossing the wire is untrusted: the UE5 client
 * is a program we ship, but a modified client is a program someone else ships.
 */

const isoInstant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'must be an ISO 8601 instant' });

/** Client-generated idempotency key. Bounded so it cannot be used to bloat the index. */
const eventId = z.string().min(8).max(200);

const minorUnits = z.union([
  z.string().regex(/^-?\d+$/, 'must be an integer string of minor units'),
  z.number().int(),
]);

const currency = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 alphabetic code');

const territory = z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code');

export const provenanceEventSchema = z.object({
  eventId,
  externalCreationId: z.string().min(1).max(200).optional(),
  occurredAt: isoInstant,
  /** The FTimelineSnapshot (or any recipe JSON) — stored verbatim for audit. */
  recipe: z.unknown(),
  /** Canonical ingredient list; preferred over extracting from `recipe`. */
  entries: z
    .array(
      z.object({
        assetExternalId: z.string().min(1).max(200),
        usage: z.string().min(1).max(64),
      }),
    )
    .max(1000)
    .optional(),
});

export const usageEventSchema = z
  .object({
    eventId,
    kind: z.enum(['play', 'stream', 'purchase', 'gift']),
    creationId: z.string().uuid(),
    occurredAt: isoInstant,
    grossAmountMinor: minorUnits.optional(),
    currency: currency.optional(),
    territory: territory.optional(),
  })
  .refine((v) => (v.grossAmountMinor === undefined) === (v.currency === undefined), {
    message: 'grossAmountMinor and currency must be provided together',
  });

export const statementQuerySchema = z.object({
  from: isoInstant,
  until: isoInstant,
  currency,
});

export type ProvenanceEventBody = z.infer<typeof provenanceEventSchema>;
export type UsageEventBody = z.infer<typeof usageEventSchema>;
export type StatementQuery = z.infer<typeof statementQuerySchema>;

/** Validates or throws a 400 carrying the field-level issues. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      'validation_failed',
      `Invalid ${what}`,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
