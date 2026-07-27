# Innovation roadmap — the extraordinary part

*Created 2026-07-24. This is the tracked answer to: "we need something that
hasn't been done before, not just a solid foundation." The foundation (Phases
0–4, the API) is the rails; this document is the train.*

---

## 1. The one-sentence claim we are building towards

> **The first operational royalty engine that attributes and pays every
> contributor to an AI-co-created piece of music — the human creator, the
> sample rights-holders, and the artists whose licensed playing trained the AI
> — deterministically, auditably, and at the moment of creation.**

No shipping system does this end-to-end today. Academic work proposes economic
models for it; industry does post-hoc *detection*; nobody runs creation-time
attribution through to an auditable ledger and payout. (Verification of that
novelty claim is action item V1 below.)

## 2. Why Burst can do what nobody else can: provenance at the point of creation

The entire industry approaches attribution **backwards**: a track appears in
the world, and services try to *detect* what's inside it after the fact — audio
fingerprinting (Content ID, Audible Magic), AI-music detectors, stylistic
similarity models. Post-hoc detection is probabilistic, adversarial, and
legally fragile: it guesses.

Burst does not need to guess. **Burst is the instrument.** The game *is* the
studio where the music is made, and Kieku *is* the AI musician playing on it.
That means ground truth is available at creation time:

- every sample/loop/stem placed on the timeline is a known registry asset
  (already captured — `FTimelineSnapshot`, Phase 2);
- every note can be tagged **human-played or AI-generated at the moment it is
  played** — the Kieku session knows which notes the model emitted, which the
  human played, what the human kept, deleted, or modified;
- the AI musician itself has a known **style lineage**: which artist's licensed
  data trained it, under what terms (Kieku's marketplace model).

Creation-time provenance is **deterministic where the whole industry is
probabilistic**. That inversion is the moat, and it is only available to a
platform that owns the instrument, the AI, and the ledger — which is exactly
the Burst + Kieku + rights-engine stack. It also aligns squarely with the EU
AI Act's transparency direction and the EU's stated interest in fair creator
compensation: European sovereignty over an auditable alternative to black-box
US detection systems.

## 3. What this makes possible: Kieku's promise, operationalized

Kieku's public positioning already promises the "inspiration economy":
rights-holders license their playing to train AI musicians and *"receive
royalties generated from every release that has been created using their
Kieku."* That promise is currently **unbacked by any mechanism** — there is no
system anywhere that can take "this track was made 30% with Artist X's AI
musician" and turn it into a correct, auditable micro-payment to Artist X.

This engine becomes that mechanism. The three-contributor attribution:

```
Creation ──┬── human creator            (keeps a share — performance/arrangement)
           ├── sample rights-holders    (composition + master flow-through, built)
           └── AI-musician style licensors  (NEW — flow through model lineage
                to the artists whose licensed data trained the Kieku)
```

## 4. The concrete R&D: `attribution/v2` and the provenance capture that feeds it

### 4a. Note-level provenance capture (with Kieku + the game)

Extend the provenance event with an **AI-session block**, captured live during
a Kieku jam session:

- `modelId` + `modelVersion` of each AI musician used (versioned, like our rules);
- style lineage: model → training license(s) → artist rights-holder(s);
- **contribution telemetry**, counted at capture time, per track/clip:
  notes emitted by AI vs played by human; AI phrases kept vs discarded vs
  edited (an edited AI phrase is a *joint* contribution); duration/bars each
  contribution occupies in the final arrangement.

None of this is inference — it is logging what the instrument already knows.
The UE5/Kieku capture spec is the joint piece of work with the game side.

### 4b. `attribution/v2` — usage- and AI-aware attribution

Replaces v1's placeholder (equal split per asset) with a deterministic
weighting over ground-truth telemetry:

- ingredient weight = f(duration in final mix, contribution kind, kept/edited
  status) — pure, versioned, exact-integer (same ppm machinery as v1);
- AI-musician ingredients route their weight through **style lineage** to the
  licensor artists, using the same flow-through mechanism samples already use
  (an AI musician is, structurally, an "asset" whose rights-holders are its
  training licensors — the registry already models this shape);
- human/AI note-share modulates the creator's retained share instead of a
  flat 50%: a creation that is 95% hand-played attributes differently from one
  where the human tapped one chord and kept everything the AI offered;
- output remains a valid exact-100% split set per copyright side, so royalty/v1
  and the whole ledger/statement pipeline work **unchanged**.

The scientific meat: designing a weighting function that is *defensible*
(musicologically and legally), *deterministic*, and *robust to gaming* (players
will try to farm attribution). That is a real research problem — measurement
theory over musical contribution — not CRUD.

### 4c. The EIC demo this produces

Live on stage: jam with an artist's Kieku AI musician inside Burst → the
creation's split sheet appears *as the music is played* — artist X%, sample
owners Y%, creator Z% → a purchase happens → the artist's statement shows the
accrued royalty, explainable line by line, reproducible forever. **Automatic
rights attribution for AI-co-created music, demonstrated end-to-end.** Nobody
else can show this today.

## 5. Honest positioning (unchanged by enthusiasm)

- The **AI model (Kieku) remains the deep-tech pillar** for EIC Excellence
  (E1 stands). This roadmap makes the rights engine a *second genuine
  innovation* — but its strongest framing is as the system that makes the AI
  pillar *economically legitimate and defensible*: the AI creates the music,
  the engine makes it fair, auditable, and EU-regulation-ready.
- Patentability (E2) is unchanged for the *ledger*; whether creation-time
  AI-contribution measurement is patentable is a **new, open question** for a
  professional search — it is a technical measurement method, not "management
  of rights" per se. Do not claim anything before that search (V1).

## 6. Action items (tracked; also cross-referenced in open-questions.md)

- **V1 — Novelty verification.** Professional prior-art + literature search on
  creation-time AI-contribution attribution (against: Computational Copyright
  arXiv 2312.06646, STIM/Sureel-style AI royalty pilots, C2PA provenance,
  Content ID). Claim nothing "first" publicly until this closes.
- **V2 — Capture spec with Kieku.** Define the AI-session provenance block with
  the actual Kieku model integration (blocked on the Kieku↔Unreal integration
  work; the thesis model's I/O defines what is measurable).
- **V3 — `attribution/v2` design ADR.** The weighting function, its invariants,
  its property tests, and the anti-gaming analysis.
- **V4 — Registry extension.** AI musicians as first-class registry subjects
  with training-license lineage (mostly reuses existing structures).
- **V5 — Demo milestone.** The Section 4c demo, measured (latency, scale,
  reproducibility figures) — the EIC evidence artifact.

## Sources (Kieku research, 2026-07-24)

- [Kieku AI Tools — main site](https://www.kieku-ai.tools/) — virtual music
  collaborator; supervised next-note prediction over MIDI with attention;
  real-time improvisation with keyboard/MIDI input; marketplace of AI musicians.
- [Kieku AI Tools — Ethical AI](https://www.kieku-ai.tools/ethical-ai) —
  licensing agreements with artists for training data; revenue-sharing with
  copyright holders "similar to radio play royalties."
- [Kieku AI Tools — The Prediction Model](https://www.kieku-ai.tools/the-prediction-model)
- [Computational Copyright: Towards A Royalty Model for Music Generative AI
  (arXiv 2312.06646)](https://arxiv.org/pdf/2312.06646) — closest academic
  prior art; proposes royalty economics for generative music AI, not an
  operational creation-time system.

*(Site pages were unreachable directly at research time — DNS failure — content
summarized from search-index snapshots; re-verify against the live site or the
original research docs when available.)*
