/**
 * Branded ID types. All IDs are strings (UUIDs at the persistence layer), but the
 * brands prevent, at compile time, passing e.g. a WorkId where a RecordingId is expected.
 */
declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type WorkId = Branded<string, 'WorkId'>;
export type RecordingId = Branded<string, 'RecordingId'>;
export type AssetId = Branded<string, 'AssetId'>;
export type RightsHolderId = Branded<string, 'RightsHolderId'>;
export type LicenseId = Branded<string, 'LicenseId'>;
export type CreationId = Branded<string, 'CreationId'>;
export type UserId = Branded<string, 'UserId'>;

/**
 * Client-generated unique ID carried by every incoming event (provenance or usage).
 * This is the idempotency key: reprocessing an event with an already-seen EventId
 * must be a no-op. Enforced by a unique constraint in the database.
 */
export type EventId = Branded<string, 'EventId'>;

export type LedgerEntryId = Branded<string, 'LedgerEntryId'>;
export type SplitVersionId = Branded<string, 'SplitVersionId'>;
