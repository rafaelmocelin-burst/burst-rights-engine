# ADR 0009 — Revenue share defaults: 60% platform fee, 50/50 creator-vs-samples

**Date:** 2026-07-23 · **Status:** accepted

## Context

The engine has two independent dials, and it is easy to confuse them:

1. **Platform fee** (`royalty/v1`) — Burst's cut of gross, taken first.
2. **Creator-vs-samples split** (`attribution/v1`) — how the remaining rights
   pool divides between the creator and the rights-holders of whatever they
   sampled. It applies **only** when a creation uses rights-registered content;
   a fully original creation gives the creator 100% of the pool.

The initial placeholders (30% fee, 50/50) put the creator far above platform
norms. For reference, Roblox retains roughly 70–75% of what players spend —
creators see about 25–28 cents per dollar. The goal here is to be meaningfully
better than that without giving away the platform's economics.

## Decision

- **Platform fee: 60%** of gross (`platformFeePpm = 600_000`).
- **Creator-vs-samples: 50/50** of the remaining pool
  (`creatorCompositionPpm = creatorMasterPpm = 500_000`, unchanged).
- **Composition/master pool split: 50/50** (unchanged).

Resulting creator economics per €1 of creation revenue:

| Creation type | Creator receives | vs Roblox (~26¢) |
| --- | --- | --- |
| Fully original (no registered samples) | 40¢ | ~1.5× |
| Uses registered samples | 20¢ | comparable, plus the sampled holders get paid |

## Rationale

- 40¢ on original work is clearly better than the Roblox benchmark, which is
  the fairness story the product and the EIC narrative both rest on.
- The sampled case is lower for the creator *because someone else is also being
  paid* — which is the entire point of the engine. That money is not retained
  by the platform; it flows to rights-holders who today would be uncleared and
  unpaid.
- **Burst's in-house sample library is itself a rights-holder.** When a creation
  samples Burst-owned content, the samples share returns to the company on top
  of the platform fee. This is the intended way to monetize "we built the
  environment and the sounds" without cutting the creator's headline rate.

## Consequences

- These are **business parameters, not invariants**: they live in policy objects
  supplied by the caller, and every ledger entry records the rule version used,
  so tuning them later never breaks historical reproducibility.
- Changing the numbers changes no code — only these defaults and the example
  assertions in tests.
- Revisit once real revenue data exists, especially the sampled-creation rate;
  a usage-weighted attribution policy (`attribution/v2`) may make the 50/50
  ingredient pool obsolete anyway.
