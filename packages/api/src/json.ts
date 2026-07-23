import type { Money } from '@burst/domain';

/**
 * Money crosses the wire as a **decimal string of minor units** plus a currency
 * code — never a JSON number. JSON numbers are IEEE-754 doubles; a large enough
 * accrual would lose precision silently, which is exactly the failure mode the
 * whole bigint discipline exists to prevent.
 */
export interface MoneyJson {
  readonly amountMinor: string;
  readonly currency: string;
}

export function moneyToJson(m: Money): MoneyJson {
  return { amountMinor: m.amount.toString(), currency: m.currency };
}

/** Parses an integer-valued minor-unit amount from a string or a safe integer number. */
export function parseMinorUnits(value: string | number, field: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${field} must be an integer number of minor units, got ${value}`);
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new TypeError(`${field} must be an integer string of minor units, got ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}
