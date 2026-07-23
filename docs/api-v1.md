# API v1 — contract

Stable, versioned contract between the UE5 client / storefront and the rights
engine. **v1 endpoints will not change shape**; breaking changes ship as `/v2`
so client and backend evolve independently (charter §6).

Base path: `/v1`. All requests and responses are JSON.

## Conventions

**Money never crosses the wire as a JSON number.** Amounts are decimal strings
of **integer minor units** (cents/öre) plus an ISO 4217 currency:

```json
{ "amountMinor": "999", "currency": "EUR" }
```

A JSON number is an IEEE-754 double; a large enough accrual would silently lose
precision, which is the exact failure the engine's bigint discipline exists to
prevent. Requests may send an integer number for convenience, but a fractional
value (`9.99`) is rejected with 400 — there are no fractional minor units.

**Every ingest endpoint is idempotent** on a client-generated `eventId`.
Replaying an event is safe and returns `200` with `"duplicate": true`; a first
sighting returns `201`. The client should therefore retry freely — that is what
makes the offline queue in the UE5 subsystem safe.

**Authentication** is `Authorization: Bearer <jwt>`, verified against the game's
issuer (ADR 0010). Errors are opaque by design:

```json
{ "error": { "code": "unauthorized", "message": "Token verification failed" } }
```

Branch on `code`, never on `message`.

---

## `GET /v1/health`

No auth. `200 → { "status": "ok", "api": "v1" }`.

## `POST /v1/events/provenance`

Records a creation and its recipe.

```json
{
  "eventId": "client-generated-unique-id",
  "externalCreationId": "ST_mayatrack001",
  "occurredAt": "2026-07-01T10:00:00Z",
  "recipe": { "…": "FTimelineSnapshot JSON, stored verbatim for audit" },
  "entries": [{ "assetExternalId": "S_neonhook12345678", "usage": "sampled" }]
}
```

`entries` is optional but **preferred**. Without it the server extracts asset
references from `recipe` conservatively (ADR 0006).

```json
{ "creationId": "uuid", "duplicate": false, "unresolvedAssets": ["S_notregistered00"] }
```

`unresolvedAssets` lists references that look like assets but are not in the
registry. **This is not an error and not noise** — an unregistered sample in a
recipe is a rights problem worth surfacing, so it is reported rather than
silently dropped.

## `POST /v1/events/usage`

Records a usage and accrues royalties. The money path.

```json
{
  "eventId": "client-generated-unique-id",
  "kind": "purchase",
  "creationId": "uuid",
  "occurredAt": "2026-07-15T20:00:00Z",
  "grossAmountMinor": "999",
  "currency": "EUR",
  "territory": "FI"
}
```

`kind` is `play | stream | purchase | gift`. `grossAmountMinor` and `currency`
must be supplied together or both omitted; omitting them records a
non-monetary event (a free play) that accrues nothing (ADR 0008).

```json
{
  "eventId": "…",
  "duplicate": false,
  "platformFee": { "amountMinor": "599", "currency": "EUR" },
  "ruleVersions": { "attribution": "attribution/v1", "royalty": "royalty/v1" },
  "accruals": [
    { "holderId": "uuid", "rightType": "composition", "amount": { "amountMinor": "50", "currency": "EUR" } }
  ],
  "licensePermitted": true,
  "licenseViolations": []
}
```

`platformFee` plus all `accruals` always sum to exactly `grossAmountMinor`.

**`licensePermitted: false` does not fail the request.** The event is still
recorded and royalties still accrue; the violation is flagged for an operator to
act on (ADR 0011). Callers should surface it, not treat it as an error.

Authorization: a user may report usage only for their own creations; a trusted
service principal may report any. Reporting for someone else's creation is
`403`.

## `GET /v1/creations/:id/splits`

Attributed ownership of a creation, per copyright side.

Query: `at` (optional ISO instant, defaults to now) — ownership is resolved
**as of that instant**, so historical splits reproduce exactly.

```json
{
  "creationId": "uuid",
  "ruleVersion": "attribution/v1",
  "composition": [{ "holderId": "uuid", "ppm": 250000, "percent": 25 }],
  "master": [{ "holderId": "uuid", "ppm": 500000, "percent": 50 }]
}
```

`ppm` is parts-per-million and each side always sums to exactly `1000000`.
`percent` is a convenience for display only — never compute with it.

## `GET /v1/holders/:id/statement`

Query (all required): `from`, `until` (ISO instants, half-open `[from, until)`),
`currency`.

```json
{
  "holderId": "uuid",
  "period": { "from": "2026-07-01T00:00:00Z", "until": "2026-08-01T00:00:00Z" },
  "currency": "EUR",
  "lines": [{ "rightType": "composition", "amount": { "amountMinor": "150", "currency": "EUR" }, "entryCount": 2 }],
  "total": { "amountMinor": "350", "currency": "EUR" },
  "ruleVersions": ["royalty/v1"]
}
```

Single currency per request by design (no FX policy — ADR 0011). Periods are
half-open so consecutive months never double-count a boundary entry. A holder
may read only their own statement; services may read any.

---

## Error codes

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `validation_failed` | Body or query failed validation; `details` lists field paths |
| 400 | `invalid_period` | `until` is not after `from` |
| 401 | `unauthorized` | Missing, malformed, or unverifiable token |
| 403 | `forbidden` | Authenticated but not permitted for this resource |
| 404 | `creation_not_found` | Unknown creation id |
| 404 | `route_not_found` | No such route |
| 500 | `internal_error` | Unexpected failure — details are logged server-side, never returned |
