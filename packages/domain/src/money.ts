/**
 * Money is ALWAYS an integer amount of minor units (cents, öre, …) in a single
 * currency. Floating point is forbidden for money everywhere in this codebase.
 */

/** ISO 4217 alphabetic code, e.g. 'EUR'. */
export type CurrencyCode = string;

export interface Money {
  /** Amount in minor units. May be negative (reversals / adjustments). */
  readonly amount: bigint;
  readonly currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export function money(amount: bigint | number, currency: CurrencyCode): Money {
  if (typeof amount === 'number') {
    if (!Number.isSafeInteger(amount)) {
      throw new TypeError(`Money amount must be an integer number of minor units, got ${amount}`);
    }
    amount = BigInt(amount);
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError(`Invalid ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
  return { amount, currency };
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function negate(a: Money): Money {
  return { amount: -a.amount, currency: a.currency };
}

export function isZero(a: Money): boolean {
  return a.amount === 0n;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

/** Sum of monies; requires a currency for the empty case and checks all entries match it. */
export function total(monies: readonly Money[], currency: CurrencyCode): Money {
  let acc = 0n;
  for (const m of monies) {
    if (m.currency !== currency) throw new CurrencyMismatchError(currency, m.currency);
    acc += m.amount;
  }
  return { amount: acc, currency };
}
