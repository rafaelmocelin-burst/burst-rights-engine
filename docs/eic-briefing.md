# Burst — Music Rights & Royalty Engine
## Technical & Innovation Briefing for the EIC Accelerator Application

**Prepared for:** the EIC project expert drafting Burst's application
**Prepared by:** Burst engineering
**Date:** 24 July 2026 · **Version:** 1.0
**Status of the technology described:** working, tested code in a private-to-public
GitHub repository — not a concept paper. Verifiable figures in §10.

---

## 0. How to read this document

Sections 1–9 are the substance: the problem, the innovation, the architecture,
the competitive position. Section 10 gives hard, checkable evidence of maturity.
Section 11 is the roadmap. **Section 12 is written specifically for you**: it
states plainly which claims are safe to put in front of an EIC jury, and which
must be softened or omitted, and why. Please read §12 before drafting — one of
the risks it describes (the EPO advising the jury) can turn an overclaim into a
scored weakness.

---

## 1. Executive summary

Every piece of recorded music carries **two separate copyrights** — the
*composition* (the song as written) and the *master* (the specific recording) —
and ownership of each is **fractional, versioned, and scattered** across
writers, publishers, labels and collecting societies, with no authoritative
global database. This is why licensing a single track can take weeks of manual
clearance, and why micro-payments to small contributors are economically
impossible today: the administrative cost of determining *who is owed what*
exceeds the amount owed.

Generative AI has just made this problem categorically worse. When a user makes
a track inside a game, from platform samples, with an AI musician improvising
alongside them, the resulting work has **no clear author** under any existing
rights infrastructure. The industry's answer has been to guess after the fact —
audio fingerprinting, AI-detection classifiers, stylistic-similarity models —
a probabilistic, adversarial, legally fragile approach that is already
generating litigation rather than settling it.

**Burst inverts the problem.** Because Burst *is* the instrument — the game is
the studio where the music is made, and the AI musician plays inside it — Burst
does not need to detect what went into a track. It **knows**, at the moment of
creation, note by note: which samples were placed, which notes the human played,
which the AI generated, which the human kept or edited, and which artists
licensed the training data behind that AI. Burst captures ground truth where
everyone else infers.

We have built the engine that turns that ground truth into money: a
**deterministic, auditable, financial-grade rights and royalty system** that
takes a creation's verified provenance, resolves fractional ownership across
both copyrights, computes exact micro-royalties that provably conserve every
cent, records them in an immutable ledger, and produces reproducible statements
and payout files — **with no manual clearance at any point**.

The result is the first system capable of paying *every* contributor to an
AI-co-created piece of music — the creator, the sample owners, **and the artists
whose licensed playing trained the AI** — automatically, at scale, and with an
audit trail that can answer, years later, exactly why any individual received
any individual cent.

---

## 2. The problem, stated precisely

### 2.1 Two copyrights, fractional and fragmented

A single commercially released track involves, at minimum:

| Right | Covers | Typically held by |
|---|---|---|
| **Composition** (publishing) | the underlying musical work — melody, harmony, lyrics | writers, co-writers, publishers, sub-publishers |
| **Master** (recording) | the specific fixed recording of that work | performing artist, producer, label |

Both must be cleared and both must be paid, independently, for essentially any
commercial use. Ownership of each is expressed as **fractional splits** — a
composition with four co-writers might be 30/30/25/15, each writer's share
further divided with their publisher, each publisher potentially represented by
different societies in different territories.

There is **no single authoritative database** resolving this. The industry runs
on partial, inconsistent registries (PRO databases such as ASCAP, BMI, PRS,
Teosto; ISWC/ISRC identifiers with incomplete coverage; label and publisher
internal systems), and reconciliation between them is a permanent manual cost
centre. Unmatched royalties — the notorious "black box" — accumulate to hundreds
of millions of euros annually precisely because attribution failed.

### 2.2 Why this blocks an entire category of product

The economics are brutal and structural: if determining who is owed what costs
more than the amount owed, **the payment does not happen**. This is why:

- user-generated music platforms either avoid monetisation entirely, or
  monetise while paying nobody upstream;
- sample-based creation tools license content on flat buy-out terms, which
  excludes the long tail of smaller rights-holders who cannot negotiate them;
- "fair compensation for creators" remains a policy aspiration rather than an
  operational reality.

The bottleneck is not goodwill. It is that **automatic, exact, auditable
attribution at micro-scale has not existed**.

### 2.3 What AI adds

When a generative model participates in creation, the question "who owns this?"
loses its existing answer. Purely AI-generated output is, in several major
jurisdictions, not copyrightable at all; AI-*assisted* output may be, but the
boundary is contested and evolving. Meanwhile the artists whose recorded
performances trained the model have a moral and increasingly a legal claim to
participate in its output — a claim that today has **no mechanism** to satisfy
it, only litigation and licensing deals negotiated in the aggregate.

This is the frontier Burst operates on, and it is not a hypothetical one: it is
the day-to-day reality of a platform where thousands of users create music with
samples and an AI musician, simultaneously, every day.

---

## 3. The core innovation: attribution at the point of creation

### 3.1 The inversion

> **The entire industry attributes *backwards*. Burst attributes *forwards*.**

Every existing approach observes a **finished** piece of music and attempts to
reconstruct its lineage:

| Approach | Mechanism | Fundamental limitation |
|---|---|---|
| Audio fingerprinting (Content ID, Audible Magic) | matches acoustic signature against a reference set | only finds what is already in the reference set; defeated by transformation; says nothing about AI involvement |
| AI-generation detectors | statistical classifiers over audio | probabilistic, adversarial, degrade as models improve; cannot identify *which* model or whose training data |
| Stylistic similarity | embedding distance to an artist's catalogue | legally treacherous — style is not copyrightable; produces claims, not evidence |
| Content provenance standards (e.g. C2PA) | cryptographically signed capture metadata | signals *that* something was AI-touched; carries no ownership graph and no payment path |

All of them **infer**. Inference is probabilistic, contestable in court, and
degrades exactly where the stakes are highest.

Burst does not infer, because Burst holds the instrument. In our stack:

- the **game** is where the music is made (Unreal Engine 5.3 client, already
  emitting a full timeline snapshot of every sample, loop and stem placed);
- the **AI musician** (Kieku — a transformer-based, attention-driven real-time
  next-note prediction model) plays *inside* that environment, so every note it
  emits is a logged event, distinguishable from every note the human played;
- the **rights engine** (this project) holds the ownership graph and the ledger.

Therefore, at the instant a track is finished, the platform already knows —
without a single act of inference:

1. **which registered assets** are in it (sample, loop, stem, AI output), and
   the exact ownership splits attached to each, on both copyright sides;
2. **which notes are human and which are AI**, and critically, which AI-emitted
   phrases the human *kept*, *discarded*, or *edited* — the last being a joint
   human-AI contribution;
3. **how much of the final arrangement** each contribution actually occupies;
4. **the style lineage of each AI musician** — which artists licensed the
   training data behind it, and on what terms.

This is not metadata reconstructed after the fact. It is the creative act
itself, recorded as it happens.

### 3.2 Why this is defensible, not merely clever

The inversion is only available to an actor who simultaneously controls **the
instrument, the AI, and the ledger**. A rights administrator without the
instrument can only fingerprint. A DAW vendor without the AI cannot see model
provenance. An AI company without the ledger cannot pay anyone. Burst is, as far
as we are aware, uniquely positioned at that intersection — and the resulting
data asset (verified creation-time provenance across millions of creations)
compounds: it is not replicable by a competitor entering later, because the
provenance of music already made elsewhere cannot be recovered retroactively.

This is the moat: **not the code, but the position** — plus a growing corpus of
ground-truth provenance that no post-hoc system can reconstruct.

---

## 4. What has been built — system architecture

The engine is a layered system with a strict dependency rule: **dependencies
point inward, and the innermost layer is pure**.

```
┌──────────────────────────────────────────────────────────────┐
│  Unreal Engine 5.3 game client  (thin — no rights logic)     │
│  emits: provenance events (creation recipes), usage events   │
└────────────────────────┬─────────────────────────────────────┘
                         │  versioned HTTPS API (/v1), JWT-authenticated
┌────────────────────────▼─────────────────────────────────────┐
│  API layer — framework-agnostic router                       │
│  validation · authentication · authorisation · idempotency   │
└────────────────────────┬─────────────────────────────────────┘
                         │  storage ports (interfaces, not implementations)
┌────────────────────────▼─────────────────────────────────────┐
│  DOMAIN CORE — pure, deterministic, zero I/O                 │
│  money · splits · registry · provenance · attribution ·      │
│  royalty computation · licensing · statements                │
│         ← this is the crown jewels; fully unit-testable      │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│  PostgreSQL 17 (Supabase, eu-north-1 / Stockholm — EU soil)  │
│  ownership graph · append-only ledger · ACID money txns      │
│  invariants enforced IN THE DATABASE, not merely in code     │
└──────────────────────────────────────────────────────────────┘
```

**Design decision of consequence:** rights and royalty logic is a *backend data
problem*, deliberately kept entirely out of the game's render path. It consumes
no GPU, adds no frame-time cost, and imposes no latency on gameplay. The Unreal
client is a thin emitter with a local persistent queue — network problems can
never affect the musical experience. This keeps the entire system
**computationally cheap and horizontally scalable**, in deliberate contrast to
inference-heavy detection approaches that must run a model over every finished
track.

### 4.1 The domain model

Nine core entities model the real legal structure of music rights, rather than
a simplification of it:

| Entity | Represents |
|---|---|
| `Work` | the composition (song as written); carries ISWC where known |
| `Recording` | the master (a specific recording of a Work); carries ISRC |
| `Asset` | a usable piece of content — sample, loop, stem, tool output, AI output — linked to a Work and/or Recording |
| `RightsHolder` | writer, publisher, artist, label, user, platform, or collecting society |
| `SplitVersion` | a **versioned, effective-dated** set of fractional shares for one right of one subject |
| `License` | terms — territories, permitted uses, revenue share, validity window |
| `Creation` | a user-made track plus its full provenance recipe |
| `UsageEvent` | a monetisable or countable use — play, stream, purchase, gift |
| `LedgerEntry` | one immutable accrual: holder, right, amount, and the rule version that computed it |
| `AiMusician` | *(new)* a specific model version and the training-data licensors its earnings flow to |

### 4.2 Correctness guarantees — why this is financial-grade

This system handles money and legal rights, so the following are enforced
structurally rather than by convention. Each is verified by automated tests that
gate every code merge:

- **No floating-point money, ever.** All monetary amounts are arbitrary-precision
  integers in minor units (cents), in both the application and the database.
  Floating-point arithmetic is rejected at construction time. This eliminates an
  entire category of rounding error that plagues royalty accounting.
- **Splits always sum to exactly 100%.** Ownership shares are integer
  parts-per-million (resolution 0.0001%). The invariant is enforced in three
  independent places: application validation, a deferred PostgreSQL constraint
  trigger, and property-based tests. A split set that does not sum to exactly
  1,000,000 ppm **cannot be committed to the database**.
- **Money is conserved exactly.** Allocation across rights-holders uses the
  largest-remainder method with deterministic tie-breaking. It is
  *mathematically proven by property-based testing* — across hundreds of
  randomly generated ownership structures and amounts — that the sum of all
  allocations equals the input amount exactly, for positive amounts and for
  negative amounts (refunds/reversals). Not "to within a cent": exactly.
- **Reversal symmetry.** A refund is the exact arithmetic negation of the
  original transaction, entry for entry — proven by property test. A refunded
  purchase leaves the ledger in a provably clean state.
- **The ledger is append-only.** `UPDATE` and `DELETE` on ledger, usage-event
  and creation tables are blocked by database triggers. History cannot be
  rewritten, only corrected by new compensating entries. This is the audit
  property regulators and rights-holders actually care about.
- **Idempotency everywhere.** Every event carries a client-generated unique ID
  with a database unique constraint; the money path additionally performs event
  insertion and ledger accrual in a **single transaction** with conflict
  handling, so two concurrent duplicate requests can never double-pay. Network
  retries are free.
- **Deterministic, versioned rules.** Every computation rule carries an
  immutable version identifier (`attribution/v1`, `royalty/v1`, …), stamped onto
  every ledger entry it produces. Rules are pure functions — no clock, no
  randomness, no I/O. **Any historical calculation can be re-executed years
  later and will produce a bit-identical result.** Rules are never edited; a
  change ships as a new version and old versions remain runnable forever.
- **Effective-dated ownership.** Ownership changes (catalogue sales, corrected
  paperwork) create new split *versions* rather than mutating existing ones.
  The engine can answer "who owned this on 14 March 2027?" for any date, and
  a royalty run from that date reproduces exactly.
- **Explainability by construction.** Every cent in the ledger is traceable to
  the event that caused it, the ownership version that governed it, and the
  rule version that computed it. The system can always answer *"why did X
  receive Y?"* — which is precisely what statements, audits and disputes
  require.

### 4.3 Security and data protection posture

Rights-holder identity and payout data is sensitive personal and commercial
information. The engine runs in a **dedicated, isolated PostgreSQL instance in
the EU (Stockholm)**, deliberately separated from the game's own database so
that rights and financial data sit in a distinct blast radius. Row-Level
Security is enabled on every table with a **deny-by-default** posture; all
database functions are hardened against search-path injection; the API
authenticates via verified JWTs (never shared master credentials) and enforces
per-principal authorisation — a rights-holder can read only their own statement.
Secrets live in a manager, never in source control.

---

## 5. The attribution engine — the technical heart

Attribution is the step that converts *provenance* into *ownership*. This is
where the intellectual substance of the system lives.

### 5.1 The general form

For a creation, and separately for each of the two copyright sides:

```
creation provenance  ──►  [ versioned attribution rule ]  ──►  split set (= exactly 100%)
                                                                      │
                              usage event (e.g. a €9.99 purchase)  ───┤
                                                                      ▼
                                                        exact per-holder accruals
                                                          (append-only ledger)
```

The output of attribution is itself a valid ownership split set, which means it
feeds the royalty engine, the ledger, statements and payouts **unchanged**. All
arithmetic is exact integer arithmetic in parts-per-million.

### 5.2 `attribution/v2` — creation-time AI-contribution attribution *(the innovation, implemented)*

This is the rule that operationalises §3. It consumes ground-truth telemetry
captured while the music was being made, and produces defensible splits.

**Inputs** — all integer counts observed by the instrument, never inferred:

- **session telemetry:** notes played by the human; AI-emitted notes kept
  verbatim; AI-emitted notes the human subsequently edited;
- **per-contributor telemetry:** the integer duration each contribution occupies
  in the *final* arrangement, and its origin (`human_placed`, `ai_generated`,
  `ai_generated_edited`);
- **ownership inputs:** for samples, the registry's effective splits as of the
  creation instant; for AI musicians, the training-licensor shares.

**The rule, in three movements:**

1. **The creator's share is earned, not fixed.** Human credit is computed as
   human notes plus a policy-weighted fraction of *edited* AI notes — an edited
   AI phrase is treated as a genuinely joint contribution, which we believe is
   both musically and legally the correct reading. The creator's share then
   interpolates between a policy **floor** (there is always arrangement and
   curation credit — the human chose, sequenced and shaped) and a **ceiling**
   (a creator never fully dilutes the contributors whose material they used).
   *Formally proven by property test: the creator's share is **monotone** in
   human contribution — playing more can never reduce your share — and always
   remains within [floor, ceiling].*
2. **The remaining pool is distributed by real presence in the work.** Each
   contributor's weight is its duration in the final mix, multiplied by an
   origin weight. Material auditioned but not kept carries zero weight and earns
   nothing. Distribution uses the same exact largest-remainder method as the
   money path, so the pool is divided without loss.
3. **AI contributions flow through style lineage to real artists.** An AI
   musician is modelled, structurally, as a contributor whose rights-holders are
   its **training-data licensors**. Its portion therefore flows automatically to
   the artists who licensed their playing to create it — using precisely the same
   flow-through machinery that samples use. Holders reached by several routes
   (say, an artist who both licensed a sample and trained an AI musician) merge
   by summation.

**Worked example** (a real, passing test in the codebase). A user jams with
"Ada's Kieku" — an AI musician trained on artist Ada's licensed playing, whose
licensor split is Ada 80% / platform 20% — over a licensed drum stem, in a
session where the AI generated the material and the human curated it:

| Rights-holder | Composition share | Why |
|---|---|---|
| Creator (the user) | 20.0% | curation/arrangement floor — AI-dominant session |
| Sample writer | 40.0% | half the ingredient pool (equal presence in the mix) |
| **Artist Ada** | **32.0%** | 80% of the AI musician's 40% pool share |
| Platform | 8.0% | 20% of the AI musician's pool share |
| | **= 100.0000%** | exact, by construction |

A €9.99 purchase of that track then accrues to each of those parties, in cents,
conserving the total exactly — and Ada receives a royalty from a track she never
knew was being made, because her *playing style*, licensed and versioned,
participated in its creation.

**That final sentence describes something no shipping system does today.**

### 5.3 Anti-gaming — a real research dimension

Any attribution mechanism that pays money will be attacked by the people it
pays. Our initial defences are structural: telemetry is observed by the platform
rather than self-reported; the creator's share is **capped** regardless of
note-spamming; weights scale with presence in the *final* work, so padding a
project with unused material earns nothing; and every computation is
deterministic and replayable for audit. A fuller adversarial analysis — treating
this explicitly as a mechanism-design problem — is a live research work-package
(§11), and is one of the more intellectually substantial parts of the roadmap.

---

## 6. Why nobody has done this

It is worth being precise about the competitive landscape, because "nobody has
done it" is a claim that invites scrutiny.

**What exists today:**

- **Post-hoc identification** (Content ID, Audible Magic, Pex): matches finished
  audio against reference catalogues. Mature, widely deployed — and structurally
  incapable of seeing AI involvement, training lineage, or the internal
  composition of a work made from licensed components.
- **Rights administration platforms** (societies, distributors, royalty
  accounting vendors): excellent at *processing* declared splits. They consume
  attribution; they do not produce it. Somebody must still decide who owns what.
- **Content provenance standards** (C2PA and similar): cryptographic capture-time
  metadata attesting that content was AI-touched. Genuinely related in spirit —
  but they carry no ownership graph, no fractional splits, no ledger, and no
  payment path. Provenance without economics.
- **Academic proposals** — most directly *"Computational Copyright: Towards a
  Royalty Model for Music Generative AI"* (arXiv 2312.06646) — which argue for
  royalty models for generative music, at the level of economic design. To our
  knowledge these remain **proposals**; they are not operational systems with
  ledgers, invariants and payouts.
- **Emerging AI-attribution pilots** (e.g. collecting-society experiments with
  AI royalty distribution) which, so far as public information shows, operate on
  aggregate licensing rather than per-creation, note-level attribution.

**The gap:** between "we can detect that AI was probably involved" and "we can
pay the specific artists whose licensed playing contributed to this specific
track, in exact amounts, with an audit trail" there is currently **no bridge**.
Burst is building the bridge — and can build it only because it holds the
instrument.

**Why it hasn't been built:** it requires the simultaneous possession of an
AI music model, a creation environment that logs at note level, a legally
faithful rights model, and financial-grade accounting discipline. Those four
competencies rarely coexist. Rights companies don't build game engines; game
companies don't build royalty ledgers; AI labs don't do double-entry accounting.

---

## 7. The European dimension

This is not a retrofitted argument; it is structural to the design.

- **Regulatory alignment.** The EU AI Act's transparency obligations push
  toward disclosure of AI involvement in generated content. Burst does not merely
  disclose that AI was involved — it records *exactly how much*, *which model*,
  and *whose licensed data*, in an immutable, auditable form. The engine is a
  compliance instrument as much as a payment one.
- **The CDSM Directive's fair-remuneration principle** (Articles 18–20 —
  appropriate and proportionate remuneration, transparency obligations toward
  authors and performers) demands exactly what this system produces:
  explainable, transparent, per-use accounting rather than opaque aggregate
  distributions.
- **Digital sovereignty.** The attribution layer for AI-created music is
  currently dominated by US-controlled, black-box detection systems. An
  auditable, deterministic, EU-operated alternative — with data resident in the
  EU (Stockholm) — is a strategic asset for European creative industries, and a
  precondition for European artists to participate in the AI economy on terms
  they can inspect.
- **Fair compensation for the long tail.** Because the marginal cost of
  attributing and accruing is near zero, the system makes micro-royalties
  economically viable for the first time — which is to say, it makes payment
  possible for exactly the small European creators for whom the current system's
  administrative overhead is prohibitive.

---

## 8. Business relevance

- **It unlocks monetisation that is otherwise legally blocked.** A UGC music
  platform cannot safely monetise creations built from third-party content
  without per-creation attribution. This engine is the precondition for Burst's
  entire creator economy.
- **It is a licensing magnet.** Rights-holders license content to platforms that
  can *prove* payment. "We can show you, line by line, why you received this
  amount" is a materially different negotiating position from "trust our
  aggregate report" — it lowers the cost of acquiring catalogue.
- **It converts Kieku's promise into a product.** Kieku's marketplace premise —
  artists license their playing to train AI musicians and earn from what those
  musicians help create — is currently a promise without a mechanism anywhere in
  the industry. This engine is that mechanism, and it makes the AI musician
  marketplace a legally coherent business rather than an aspiration.
- **Standalone potential.** The engine is deliberately built as an independent,
  API-first system with a stable versioned contract. Nothing in it is specific
  to Burst's game beyond an identifier mapping. It is licensable to other
  UGC/AI-music platforms facing the identical problem — a second revenue line
  and an ecosystem play.

---

## 9. The demonstration

The following end-to-end scenario is what we intend to demonstrate live, and it
is the evidence artefact for the application:

1. A musician's Kieku AI is registered with its training-licence lineage.
2. A user jams with it inside Burst, over licensed samples, and saves the track.
3. **As the track is saved, its split sheet materialises** — creator X%, sample
   owners Y%, the AI's licensor artist Z% — computed from ground truth, not
   estimated.
4. Another user purchases the track for €9.99.
5. Every party's ledger accrues in cents, conserving the total exactly.
6. The artist opens a statement showing the royalty, itemised, with the rule
   version and ownership version that produced it — and it can be reproduced,
   identically, at any point in the future.

Steps 1, 3, 4, 5 and 6 **already execute today** as automated tests against the
engine. Step 2 requires the game-side capture integration (§11). No part of the
chain is hypothetical in its logic; the missing piece is instrumentation, not
invention.

---

## 10. Current maturity — verifiable evidence

*All figures are checkable in the repository as of 24 July 2026.*

| Metric | Value |
|---|---|
| Working code | ~5,400 lines of strict TypeScript (application + tests) |
| Automated tests | **104 passing**, gating every merge via continuous integration |
| — of which property-based | mathematical invariant tests (conservation, determinism, monotonicity, order-independence) executing hundreds of randomised cases each |
| Architecture Decision Records | 13, documenting every significant technical choice and its rationale |
| Database migrations | 4, versioned and forward-only |
| Database | PostgreSQL 17, dedicated instance, EU region (Stockholm) |
| Public API | versioned `/v1`, 5 endpoints, JWT-authenticated, fully specified |
| Development period | initial system built 23–24 July 2026 |

**What is implemented and tested:** the complete rights registry with versioned
effective-dated ownership; provenance ingestion; `attribution/v1` and
`attribution/v2`; royalty computation with proven exact conservation; the
append-only ledger; licence enforcement checks; statement generation and payout
export; the full versioned HTTP API with both in-memory and PostgreSQL storage
implementations; AI musicians as registry entities with training-licensor
lineage.

**What is not yet done:** the Unreal/Kieku note-level capture integration that
feeds `attribution/v2` real telemetry (the rule is implemented and tested
against synthetic telemetry, but no live session has produced data yet); the
asynchronous batch workers for large-scale statement runs; production
deployment; and a professional prior-art search (§12).

**Suggested TRL positioning:** the rights engine is at **TRL 4** — component
validated in a laboratory environment, with the core algorithms proven and the
integration path defined but not yet exercised end-to-end on live data. We would
recommend against claiming higher for this component until the capture
integration runs. (The AI model's TRL should be assessed separately and is
likely higher, given prior deployment and testing with musicians.)

---

## 11. Roadmap — the work an EIC grant would fund

| # | Work package | Substance |
|---|---|---|
| **WP1** | Note-level capture integration | Instrument the Unreal client and the Kieku model to emit the AI-session provenance block in real time, off the game thread, with guaranteed delivery. Turns synthetic telemetry into ground truth. |
| **WP2** | Attribution science | Calibrate and validate the weighting function against real creative sessions; formal adversarial/mechanism-design analysis against attribution farming; musicological and legal defensibility review. **This is the genuine research work-package.** |
| **WP3** | Scale and industrialisation | Asynchronous batch royalty runs, statement generation at millions-of-creations scale, performance validation, production hardening. |
| **WP4** | Rights-holder interface | Dashboards and statement/payout exports in the formats societies and publishers actually consume; onboarding flow for artists licensing AI musicians. |
| **WP5** | Legal & standards engagement | Validation of the attribution model with collecting societies (Teosto and peers) and publishers; alignment with C2PA-style provenance standards; AI Act transparency conformance. |
| **WP6** | IP strategy execution | Professional prior-art search; decision on filing for the *measurement method* (not the ledger); trade-secret documentation regime. |

---

## 12. Guidance on claims — please read before drafting

This section exists to protect the application. Burst's engineering assessment
is that the following distinctions matter more than the enthusiasm above.

### 12.1 Claims that are safe and well-evidenced

- That the system performs **automatic rights attribution and royalty
  computation without manual clearance**, with exact conservation of money and a
  fully auditable, reproducible trail. *(Implemented, property-tested.)*
- That it attributes **at the moment of creation from verified provenance,
  rather than by post-hoc detection**, and that this is structurally more
  reliable than inference. *(Implemented; the architectural argument is sound.)*
- That it can **flow royalties through an AI model's training-licence lineage to
  the artists behind it**. *(Implemented and tested.)*
- That it is **EU-resident, auditable, and aligned with AI Act transparency and
  CDSM fair-remuneration principles.** *(True and structural.)*
- That it makes **micro-royalties economically viable** by driving the marginal
  cost of attribution to near zero. *(Sound.)*

### 12.2 Claims to phrase carefully

- **"World first" / "nobody has ever done this."** Our landscape review (§6)
  supports it and we believe it to be true — but **no professional prior-art
  search has been conducted yet** (WP6). Prefer *"to the best of our knowledge,
  no operational system today does X"* over an unqualified first-in-the-world
  claim. An expert evaluator may know of a pilot we do not.
- **Live-data claims.** `attribution/v2` is implemented and tested, but has not
  yet processed a real Kieku session. Say *"implemented and validated against
  the defined telemetry, pending live integration"* — not *"in production."*

### 12.3 Claims to avoid entirely

- **Do not claim the rights engine is patentable.** European Patent Office
  practice treats "management of rights" as excluded, non-technical
  subject-matter, and case law has refused closely analogous
  capture→ledger→distribute architectures as business schemes. **The EPO advises
  the EIC jury on shortlisted proposals** — an overclaim here is read by an
  actual patent examiner. *(A possible exception is the creation-time
  contribution **measurement method**, which is arguably technical rather than
  administrative; that is exactly what WP6's search is for. Claim nothing until
  it closes.)*
- **Do not position the rights engine as the deep-tech breakthrough itself.**
  The EIC Work Programme frames deep tech around cutting-edge scientific
  advance, explicitly distinguishing it from "high tech," and the deep-tech
  criterion carries a hard scoring threshold under Excellence. **The real-time AI
  music model is the deep-tech pillar.** The rights engine's correct and
  powerful framing is as the system that makes that breakthrough
  *deployable, legally coherent, and defensible* — the moat and the
  market-enabler, not the science.

### 12.4 The recommended narrative shape

> Burst's breakthrough is a real-time AI musician that improvises with humans at
> low latency. Deploying such a model commercially raises an unsolved problem —
> nobody can say who owns, or who should be paid for, music co-created by a
> human, licensed samples, and an AI trained on real artists' playing. Burst has
> built the system that answers this: attribution captured at the moment of
> creation rather than guessed afterwards, resolved into exact fractional
> ownership across both copyrights, and paid out through an immutable, auditable
> ledger. The AI is the innovation; the rights engine is what makes it lawful,
> fair, financeable and European.

That framing is both accurate and, in our view, considerably more persuasive
than claiming two independent breakthroughs — because it explains why Burst,
specifically, is the company that can deploy generative music AI where others
will be blocked.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Composition / publishing right** | Copyright in the underlying song (melody, harmony, lyrics); held by writers and publishers |
| **Master right** | Copyright in a specific recording; held by artist/label |
| **Split** | Fractional ownership share of a right, expressed here in parts-per-million |
| **Provenance / recipe** | The verified record of what went into a creation |
| **Attribution** | Converting provenance into ownership shares |
| **Accrual** | An amount recorded as owed to a rights-holder |
| **Idempotency** | The property that reprocessing the same event has no additional effect — the defence against double-payment |
| **Property-based testing** | Testing that verifies mathematical properties hold across hundreds of randomly generated inputs, rather than checking hand-picked examples |
| **Append-only ledger** | A record store where history can never be altered, only extended — the basis of auditability |
| **Style lineage** | The chain from an AI musician back to the artists whose licensed data trained it |
| **Kieku** | Burst's real-time AI musician: transformer/attention-based next-note prediction, trained on licensed MIDI performance data |
| **ppm** | Parts per million; 1,000,000 ppm = 100%. Integer resolution of 0.0001% used for all ownership arithmetic |

---

*Prepared from the working codebase at `github.com/rafaelmocelin-burst/burst-rights-engine`.
Technical questions, architecture decision records, and the full open-questions
register are available in that repository's `docs/` directory. The engineering
team can walk through any claim in this document against the code that
implements it.*
