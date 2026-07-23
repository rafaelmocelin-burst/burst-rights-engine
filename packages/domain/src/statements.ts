import type { LedgerEntry, RightType } from './entities.js';
import type { RightsHolderId } from './ids.js';
import { type CurrencyCode, type Money } from './money.js';

/**
 * Statements and payout exports (Phase 5).
 *
 * A statement is a pure fold over ledger entries in a period — no state of its
 * own — so running it twice over the same ledger yields the same numbers, and
 * a historical statement can always be regenerated. Reversals (negative
 * entries) net out naturally because they are ordinary entries.
 */

export interface StatementPeriod {
  /** Inclusive ISO 8601 instant. */
  readonly from: string;
  /** Exclusive ISO 8601 instant — half-open so consecutive periods never double-count. */
  readonly until: string;
}

export interface StatementLine {
  readonly holderId: RightsHolderId;
  readonly rightType: RightType;
  readonly amount: Money;
  readonly entryCount: number;
}

export interface HolderStatement {
  readonly holderId: RightsHolderId;
  readonly period: StatementPeriod;
  readonly currency: CurrencyCode;
  readonly lines: readonly StatementLine[];
  readonly total: Money;
  /** Rule versions that produced the entries — an auditor can replay each one. */
  readonly ruleVersions: readonly string[];
}

export class StatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementError';
  }
}

function instant(iso: string, what: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new StatementError(`${what} is not a valid ISO 8601 instant: ${iso}`);
  return t;
}

export function entriesInPeriod(
  entries: readonly LedgerEntry[],
  period: StatementPeriod,
): LedgerEntry[] {
  const from = instant(period.from, 'period.from');
  const until = instant(period.until, 'period.until');
  if (until <= from) throw new StatementError('period.until must be after period.from');
  return entries.filter((e) => {
    const t = instant(e.createdAt, 'entry.createdAt');
    return t >= from && t < until;
  });
}

/**
 * Build one holder's statement for a period. Single-currency by design: a
 * holder earning in several currencies gets one statement per currency, since
 * summing across currencies is meaningless without an FX policy (out of scope).
 */
export function buildHolderStatement(
  holderId: RightsHolderId,
  entries: readonly LedgerEntry[],
  period: StatementPeriod,
  currency: CurrencyCode,
): HolderStatement {
  const mine = entriesInPeriod(entries, period).filter(
    (e) => e.holderId === holderId && e.amount.currency === currency,
  );

  const byRight = new Map<RightType, { amount: bigint; count: number }>();
  const ruleVersions = new Set<string>();
  for (const e of mine) {
    const acc = byRight.get(e.rightType) ?? { amount: 0n, count: 0 };
    byRight.set(e.rightType, { amount: acc.amount + e.amount.amount, count: acc.count + 1 });
    ruleVersions.add(e.ruleVersion);
  }

  const lines: StatementLine[] = [...byRight.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([rightType, acc]) => ({
      holderId,
      rightType,
      amount: { amount: acc.amount, currency },
      entryCount: acc.count,
    }));

  return {
    holderId,
    period,
    currency,
    lines,
    total: { amount: lines.reduce((acc, l) => acc + l.amount.amount, 0n), currency },
    ruleVersions: [...ruleVersions].sort(),
  };
}

export interface PayoutRow {
  readonly holderId: RightsHolderId;
  readonly amount: Money;
}

/**
 * Payout file rows for a period: one row per holder with a strictly positive
 * balance. Zero and negative balances are excluded — you cannot pay someone a
 * negative amount — but the underlying entries stay in the ledger, so a
 * negative balance carries forward and offsets the next period automatically.
 */
export function buildPayoutRows(
  entries: readonly LedgerEntry[],
  period: StatementPeriod,
  currency: CurrencyCode,
): PayoutRow[] {
  const totals = new Map<string, bigint>();
  for (const e of entriesInPeriod(entries, period)) {
    if (e.amount.currency !== currency) continue;
    totals.set(e.holderId, (totals.get(e.holderId) ?? 0n) + e.amount.amount);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([holderId, amount]) => ({
      holderId: holderId as RightsHolderId,
      amount: { amount, currency },
    }));
}

/** Escapes a CSV field per RFC 4180 (quote it if it contains a quote, comma, or newline). */
function csvField(value: string): string {
  return /["\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Render payout rows as CSV. Amounts are written in **minor units** — the
 * integer the ledger actually holds — so no decimal formatting can corrupt a
 * figure on its way to a payment provider.
 */
export function payoutRowsToCsv(rows: readonly PayoutRow[]): string {
  const header = 'holder_id,amount_minor,currency';
  const lines = rows.map((r) =>
    [csvField(r.holderId), r.amount.amount.toString(), csvField(r.amount.currency)].join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}
