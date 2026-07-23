# ADR 0003 — Money as bigint minor units; splits as integer ppm; largest-remainder allocation

**Date:** 2026-07-23 · **Status:** accepted

## Context

Charter §6: no floating point for money, ever; splits always sum to exactly
100%; every historical calculation must reproduce exactly. Music splits are
fractional and awkward (thirds are common), and micro-royalties mean amounts
of a few minor units are the norm, so rounding policy is not a detail — it is
the product.

## Decision

1. **Money = `bigint` minor units + ISO 4217 currency code** (TS) / `bigint` +
   `char(3)` (Postgres). No decimals, no floats, no implicit conversion.
2. **Splits = integer parts-per-million (ppm)**; a valid split set sums to
   exactly 1,000,000. ppm resolution (0.0001%) covers real-world splits;
   non-representable fractions (1/3) are entered as ppm values that still sum
   to 1,000,000 (333,334 / 333,333 / 333,333).
3. **Allocation uses the largest-remainder method** with ties broken by
   lexicographic rights-holder ID. Properties (all property-tested):
   - conservation: allocations sum to exactly the input amount;
   - determinism + order-independence: same split set → same result, forever;
   - per-holder error < 1 minor unit from the exact proportional amount;
   - reversal symmetry: `allocate(−x) = −allocate(x)`.
4. **Enforcement is triple-layered:** domain validation (`validateSplits`),
   a deferred Postgres constraint trigger (`split_share_sum_is_100_percent`),
   and property tests in CI.

## Alternatives considered

- *Decimal libraries* (decimal.js): adds a dependency and still needs a rounding
  policy; `bigint` minor units are exact, native, and faster.
- *Basis points (1/10,000)*: too coarse for fragmented publishing splits.
- *Stochastic/round-half-even rounding*: not deterministic across runs or
  reorderings; violates the reproducibility mandate.
