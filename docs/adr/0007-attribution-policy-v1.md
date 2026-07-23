# ADR 0007 — Attribution policy v1: creator share + equal-weight ingredient pool

**Date:** 2026-07-23 · **Status:** accepted

## Context

Phase 3 must turn a creation's recipe into ownership splits for the creation
itself, per copyright side (composition and master). Any policy here is a
product decision as much as a technical one; what matters structurally is that
the policy is **pure, versioned, and replaceable** (`attribution/v1`), so a
better-informed policy can ship as v2 without touching history.

## Decision — `attribution/v1`

1. Per side (composition / master), only ingredients that actually carry rights
   on that side participate. No rights-bearing ingredients → the creator owns
   100% of that side.
2. Otherwise the creator retains a policy share (default **50%** per side);
   the remainder forms the ingredient pool.
3. The pool divides **equally among distinct ingredient assets** — usage kind
   (sampled/looped/stem) does not weight differently in v1; that refinement is
   an obvious v2 candidate once real usage data exists.
4. Each asset's portion flows to its registered rights-holders proportionally
   to their effective splits; a holder reached via several routes (multiple
   assets, or being the creator) is merged by summation.
5. All arithmetic is exact-integer ppm using largest-remainder distribution
   (ties by id), so both sides always sum to exactly 1,000,000 ppm —
   property-tested, and re-validated at the end of every computation.

## Consequences

- Attribution output is itself a valid split set, so Phase 4 can feed it
  straight into money allocation.
- The default 50% creator share is a placeholder business parameter, not a
  claim about fairness — it lives in a policy object supplied by the caller
  and recorded with the rule version, so runs are reproducible even as the
  parameter is tuned.
