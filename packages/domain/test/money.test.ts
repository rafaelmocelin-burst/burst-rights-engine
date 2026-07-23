import { describe, expect, it } from 'vitest';
import {
  add,
  CurrencyMismatchError,
  equals,
  isZero,
  money,
  negate,
  subtract,
  total,
} from '../src/money.js';

describe('money', () => {
  it('constructs from bigint and integer number', () => {
    expect(money(100n, 'EUR').amount).toBe(100n);
    expect(money(100, 'EUR').amount).toBe(100n);
  });

  it('rejects non-integer numbers — floating point money is forbidden', () => {
    expect(() => money(1.5, 'EUR')).toThrow(TypeError);
    expect(() => money(0.1, 'EUR')).toThrow(TypeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'EUR')).toThrow(TypeError);
  });

  it('rejects malformed currency codes', () => {
    expect(() => money(1n, 'eur')).toThrow(TypeError);
    expect(() => money(1n, 'EURO')).toThrow(TypeError);
    expect(() => money(1n, '')).toThrow(TypeError);
  });

  it('adds and subtracts in the same currency', () => {
    expect(add(money(70n, 'EUR'), money(30n, 'EUR'))).toEqual(money(100n, 'EUR'));
    expect(subtract(money(70n, 'EUR'), money(30n, 'EUR'))).toEqual(money(40n, 'EUR'));
  });

  it('refuses cross-currency arithmetic', () => {
    expect(() => add(money(1n, 'EUR'), money(1n, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(1n, 'EUR'), money(1n, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => total([money(1n, 'USD')], 'EUR')).toThrow(CurrencyMismatchError);
  });

  it('negate, isZero, equals, total', () => {
    expect(negate(money(5n, 'EUR'))).toEqual(money(-5n, 'EUR'));
    expect(isZero(money(0n, 'EUR'))).toBe(true);
    expect(isZero(money(1n, 'EUR'))).toBe(false);
    expect(equals(money(5n, 'EUR'), money(5n, 'EUR'))).toBe(true);
    expect(equals(money(5n, 'EUR'), money(5n, 'USD'))).toBe(false);
    expect(total([money(1n, 'EUR'), money(2n, 'EUR')], 'EUR')).toEqual(money(3n, 'EUR'));
    expect(total([], 'EUR')).toEqual(money(0n, 'EUR'));
  });
});
