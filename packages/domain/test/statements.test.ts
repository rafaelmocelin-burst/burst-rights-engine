import { describe, expect, it } from 'vitest';
import type { LedgerEntry, RightType } from '../src/entities.js';
import type { EventId, LedgerEntryId, RightsHolderId } from '../src/ids.js';
import { money } from '../src/money.js';
import {
  buildHolderStatement,
  buildPayoutRows,
  payoutRowsToCsv,
  StatementError,
} from '../src/statements.js';

const h = (s: string) => s as RightsHolderId;

let seq = 0;
function entry(
  holderId: string,
  amountMinor: bigint,
  createdAt: string,
  opts: { rightType?: RightType; currency?: string; ruleVersion?: string } = {},
): LedgerEntry {
  seq += 1;
  return {
    id: `ledger-${seq}` as LedgerEntryId,
    eventId: `evt-${seq}` as EventId,
    holderId: h(holderId),
    rightType: opts.rightType ?? 'composition',
    amount: money(amountMinor, opts.currency ?? 'EUR'),
    ruleVersion: opts.ruleVersion ?? 'royalty/v1',
    createdAt,
  };
}

const july = { from: '2026-07-01T00:00:00Z', until: '2026-08-01T00:00:00Z' };

describe('buildHolderStatement', () => {
  it('groups a holder’s entries by right type and totals them', () => {
    const entries = [
      entry('user-1', 100n, '2026-07-05T00:00:00Z'),
      entry('user-1', 50n, '2026-07-20T00:00:00Z'),
      entry('user-1', 200n, '2026-07-10T00:00:00Z', { rightType: 'master' }),
      entry('user-2', 999n, '2026-07-10T00:00:00Z'),
    ];
    const st = buildHolderStatement(h('user-1'), entries, july, 'EUR');
    expect(st.lines).toEqual([
      { holderId: h('user-1'), rightType: 'composition', amount: money(150n, 'EUR'), entryCount: 2 },
      { holderId: h('user-1'), rightType: 'master', amount: money(200n, 'EUR'), entryCount: 1 },
    ]);
    expect(st.total).toEqual(money(350n, 'EUR'));
    expect(st.ruleVersions).toEqual(['royalty/v1']);
  });

  it('uses a half-open period so consecutive periods never double-count', () => {
    const entries = [
      entry('user-1', 10n, '2026-06-30T23:59:59Z'), // before
      entry('user-1', 20n, '2026-07-01T00:00:00Z'), // inclusive start
      entry('user-1', 40n, '2026-08-01T00:00:00Z'), // exclusive end → next period
    ];
    expect(buildHolderStatement(h('user-1'), entries, july, 'EUR').total).toEqual(money(20n, 'EUR'));
    const august = { from: '2026-08-01T00:00:00Z', until: '2026-09-01T00:00:00Z' };
    expect(buildHolderStatement(h('user-1'), entries, august, 'EUR').total).toEqual(
      money(40n, 'EUR'),
    );
  });

  it('nets reversals against accruals', () => {
    const entries = [
      entry('user-1', 500n, '2026-07-05T00:00:00Z'),
      entry('user-1', -500n, '2026-07-06T00:00:00Z'),
    ];
    const st = buildHolderStatement(h('user-1'), entries, july, 'EUR');
    expect(st.total).toEqual(money(0n, 'EUR'));
    expect(st.lines[0]?.entryCount).toBe(2);
  });

  it('separates currencies and records every rule version used', () => {
    const entries = [
      entry('user-1', 100n, '2026-07-05T00:00:00Z'),
      entry('user-1', 700n, '2026-07-05T00:00:00Z', { currency: 'USD' }),
      entry('user-1', 60n, '2026-07-07T00:00:00Z', { ruleVersion: 'royalty/v2' }),
    ];
    expect(buildHolderStatement(h('user-1'), entries, july, 'EUR').total).toEqual(
      money(160n, 'EUR'),
    );
    expect(buildHolderStatement(h('user-1'), entries, july, 'USD').total).toEqual(
      money(700n, 'USD'),
    );
    expect(buildHolderStatement(h('user-1'), entries, july, 'EUR').ruleVersions).toEqual([
      'royalty/v1',
      'royalty/v2',
    ]);
  });

  it('returns an empty statement for a holder with no entries', () => {
    const st = buildHolderStatement(h('nobody'), [], july, 'EUR');
    expect(st.lines).toEqual([]);
    expect(st.total).toEqual(money(0n, 'EUR'));
  });

  it('rejects an inverted period', () => {
    expect(() =>
      buildHolderStatement(h('user-1'), [], { from: july.until, until: july.from }, 'EUR'),
    ).toThrow(StatementError);
  });
});

describe('buildPayoutRows', () => {
  it('includes only positive balances, sorted by holder', () => {
    const entries = [
      entry('user-b', 300n, '2026-07-05T00:00:00Z'),
      entry('user-a', 100n, '2026-07-05T00:00:00Z'),
      entry('user-a', 50n, '2026-07-06T00:00:00Z', { rightType: 'master' }),
      entry('user-c', 100n, '2026-07-05T00:00:00Z'),
      entry('user-c', -100n, '2026-07-06T00:00:00Z'), // nets to zero → excluded
      entry('user-d', -20n, '2026-07-06T00:00:00Z'), // negative → excluded, carries forward
    ];
    expect(buildPayoutRows(entries, july, 'EUR')).toEqual([
      { holderId: h('user-a'), amount: money(150n, 'EUR') },
      { holderId: h('user-b'), amount: money(300n, 'EUR') },
    ]);
  });

  it('renders CSV with integer minor units and RFC 4180 escaping', () => {
    const csv = payoutRowsToCsv([
      { holderId: h('user-a'), amount: money(150n, 'EUR') },
      { holderId: h('needs,escaping'), amount: money(1n, 'EUR') },
    ]);
    expect(csv).toBe(
      'holder_id,amount_minor,currency\nuser-a,150,EUR\n"needs,escaping",1,EUR\n',
    );
  });

  it('renders a header-only file when nothing is payable', () => {
    expect(payoutRowsToCsv([])).toBe('holder_id,amount_minor,currency\n');
  });
});
