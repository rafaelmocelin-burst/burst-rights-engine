# IP strategy — is this patentable, and what to do instead

*Researched 2026-07-23. Not legal advice; no professional prior-art search was run.
Verify the load-bearing citations with a European patent attorney before filing
anything or before quoting this in a grant application.*

## Short answer

**The rights/royalty engine is very likely unpatentable at the EPO in its core
form**, and claiming otherwise in the EIC application would backfire. But **IP is
an explicitly scored EIC sub-criterion**, so the answer is a documented
non-patent IP strategy, not silence.

## Why patenting the engine fails

Three independent facts, each sufficient on its own:

1. **"Management of rights" is a named exclusion.** EPO Guidelines G-II 3.5.3
   lists "licensing, management of rights and contractual agreements" as
   commercial/administrative subject-matter — and adds that "the mere
   possibility of using technical means is not sufficient to avoid exclusion,
   even if the description discloses a technical embodiment." This is not a grey
   area at the level of the field; every claim starts from that presumption.

2. **The closest decided case refused this exact architecture.** T 1587/20
   (Loyyal, Board 3.5.01, Dec 2023) claimed: capture user activity from client
   devices → record on an append-only ledger → distribute tokens per system
   rules. Refused — every distinguishing feature was held non-technical, a
   business scheme. Our architecture (provenance capture → append-only ledger →
   deterministic allocation → value transfer) is structurally the same claim.

3. **The one close music-rights analogue died.** EP1062605A1 (Harry Fox Agency),
   an online works registry with licensing rights determination, was withdrawn.

The mechanism that kills it is COMVIK (T 641/00, Guidelines G-VII 5.4):
non-technical aims are handed to the engineer as a *requirements
specification*. "Royalties must split exactly, ledgers must be immutable,
history must reproduce" becomes a free constraint, not a source of
inventiveness — precisely our best engineering arguments, neutralised.

In this field EP patents are granted for **signal processing** (EP2795913B1,
audio fingerprinting) and **device/network/protocol engineering** (EP2021954B1,
Omnifone — which survived on handset architecture and transport protocol, not
on its licensing model). Not for rights registries or ledger-based value
distribution.

### Angles assessed

| Angle | Verdict |
| --- | --- |
| Idempotent distributed event ingestion | Best of the set — genuine machine-level effects (network traffic, availability, scalability). But crowded prior art (Kafka, outbox, dedup keys); **novelty**, not eligibility, becomes the blocker. |
| Tamper-evident provenance capture from a real-time client | Possible if it involves cryptographic integrity/attestation under adverse network conditions — encryption *is* on the technical list. "Log which loop IDs were dragged in" is not. |
| Append-only / event-sourced ledger | Weak — squarely T 1587/20, and decades of prior art. |
| Deterministic reproducible computation | Weak — serves accounting trust, not the machine. |
| Exact-integer allocation / no rounding loss | Weak — a mathematical method applied to a non-technical purpose (G-II 3.3). |

## Does a patent help the EIC application?

**IP is scored, but the criterion does not ask for patents.** EIC Work
Programme 2026 (C(2026) 4080), Table 8, under EXCELLENCE at both short and full
proposal stage: *"Does the innovation have adequate IP protection and a sound IP
strategy to enter the market to be addressed?"* Excellence threshold is 4/5. A
reasoned strategy answers it; an empty answer scores badly.

**Critically: the EPO advises the jury.** WP2026 p.54 — EIC seeks EPO assistance
to analyse "technological novelty, the inventive merit and the proposed future
strategy" of proposals shortlisted for jury interview. So an actual patent
professional reads the novelty claim. Overclaiming patentability of a rights
engine to an EPO examiner reads as naive and gets flagged. Saying *"the core
engine is trade-secret protected because EPO practice treats rights management
as excluded subject-matter; we have filed narrowly on [specific mechanism]"*
reads as sophisticated.

**Freedom to operate is soft here.** WP2026 asks for an FTO analysis *"if
available."* The sibling STEP Scale Up call states outright: *"In cases where
the FTO is not relevant (e.g. software), please upload a simple statement."*
That is the Commission's own language — a proportionate 2-page note suffices;
no €10-20k formal search needed.

## The real EIC risk is not IP

WP2026 p.19 defines deep tech as "based on cutting-edge scientific advances and
discoveries... distinct from 'high tech' which tends to refer only to R&D
intensity," and footnote 26 ties it to tangible products and industrialisation.
A TypeScript + Postgres royalty ledger is close to the archetype that definition
is drafted to exclude, and "deep tech and breakthrough nature" sits inside the
same 4/5-threshold Excellence criterion.

**Implication for the charter's §2 secondary goal:** this engine should be
positioned as *enabling infrastructure and a regulatory/market moat* supporting
a breakthrough claimed elsewhere in the Burst stack (the real-time AI music
model), **not** as the deep-tech breakthrough itself.

## Recommended strategy

1. **Trade secrets as the stated core.** Server-side code that never ships is
   the textbook secrecy case — unlike a patent, it never expires and never
   publishes. Directive (EU) 2016/943 requires "reasonable steps" to keep it
   secret: access control, repo segmentation, NDAs, employee IP clauses. **Do
   the hygiene and document it** — the documentation is both the legal position
   and the EIC evidence.
2. **Copyright** on the implementation — automatic and free, but narrow: CJEU
   C-406/10 (SAS v WPL) says functionality, languages and file formats are not
   protected. It stops literal copying and nothing more.
3. **Sui generis database right on the third-party rights corpus, not our own
   ledger.** C-203/02 (BHB v William Hill) protects investment in *obtaining and
   verifying* data, not *creating* it — so ingested/reconciled CMO, publisher and
   label metadata (ISRC/ISWC matching) is the strong ground; our self-generated
   ledger is the weak ground.
4. **A cheap priority filing** on the one or two mechanisms with machine-level
   effects (idempotent ingestion; tamper-evident provenance capture), claimed in
   the T 697/17 vocabulary — reduced network traffic, memory footprint,
   availability under concurrent load. **Never claim "computing royalty splits."**
   ~€500-1,500 at a national office buys a 12-month priority window, a citable
   "patent pending," and defers the real €13-18k EP decision. Check the EUIPO
   SME Fund 2026 patent voucher (up to €3,500; open 2 Feb - 4 Dec 2026) and the
   EPO micro-entity 30% reduction first.
   *Sequencing trap:* if we file and then don't pursue, **withdraw before the
   18-month publication** or the mechanism publishes and trade-secret status is
   lost.
5. **Defensive publication** for mechanisms we want to practise freely but not
   own — via an examiner-indexed service (IP.com, Research Disclosure), not a
   blog post.

**Free help:** the European IP Helpdesk is an EIC ecosystem partner with a free
helpline and runs joint EPO-EIC training on patents-vs-trade-secrets for deep
tech companies.

## Caveats

No professional prior-art search was run — novelty on the ingestion and
provenance angles is unassessed and could sink a filing regardless of
eligibility. The exact on-form IP field wording for the 2026 Accelerator was not
retrievable (portal returned 403); the criteria above come from the Work
Programme and Guide for Applicants v6.0, which are authoritative. Patentability
opinions in computer-implemented inventions are genuinely examiner- and
board-dependent; a good attorney might take a more optimistic view of the
ingestion angle specifically.
