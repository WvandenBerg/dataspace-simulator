# Simulator Test Log

Exploratory test record for the standalone `simulator/` application.

Each test began as a question about whether the simulator behaves correctly, so each one
implies a user story it is really testing. Those stories are collected in
`USER-STORIES.md`; this file is the evidence behind them.

Tests are described from the participant's point of view first. The code-level cause
follows as a note on the observation, not as the headline.

## 0) Environment

| Item | Value |
|---|---|
| Date | 2026-09-19 |
| Revision | `433a5b2` |
| Services | `sim-frontend` :4000, `sim-backend` :4001, `sim-fuseki` :4030 |
| Method | UI interaction plus direct HTTP probes against the running stack |

## 1) Summary

| ID | What was tested | Result |
|---|---|---|
| T-01 | Role-restricted asset hidden when browsing a provider's catalog | **Fail** |
| T-02 | Role-restricted asset hidden from semantic search | Pass |
| T-03 | `dct:conformsTo` shown on a catalog entry | **Fail** |
| T-04 | `dct:conformsTo` usable as a search filter | Pass |
| T-05 | `dct:conformsTo` returned on a search result | **Fail** |
| T-06 | Cold start indexes every seeded asset | **Fail** |
| T-07 | Access labels are consistent and human-readable | Cosmetic |

Headline result: **the policy engine is correct, but one discovery path bypasses it.**
Access control is enforced in semantic search and at contract negotiation, and is not
enforced when browsing a provider's catalog. Separately, the field that carries the link
to a semantic model is filterable but never displayed.

## 2) Access policy at discovery time

The governing question: if a provider restricts an asset to one organisational role, is
that restriction felt by a participant who does not hold the role?

### T-01 — Role-restricted asset stays visible when browsing the catalog

**Result: Fail**

Setup:
- NordBeton AG's `Concrete Product Passport CP-442` set to access policy `Role`
  (`sys-role`), permitted role `manufacturer`.
- New participant `Randstad` created with claims `industry=construction`,
  `orgRole=supplier`.

Steps — as Randstad: `Browse Dataspace` → find NordBeton AG → `View Catalog`.

Expected: CP-442 absent. Randstad is a supplier, not a manufacturer.

Observed: all three NordBeton assets listed, CP-442 among them. The restriction had no
effect.

```text
GET /api/assets          # no consumer parameter exists on this route

  VISIBLE  Concrete Product Passport CP-442   policy = sys-role   <-- wrong
  VISIBLE  Concrete Product Passport CP-317   policy = null
  VISIBLE  Concrete Product Passport CP-291   policy = sys-open
```

Cause: browsing never asks the backend who is asking. The catalog view is populated from
the frontend's local asset list, loaded once from `/api/assets` — a route with no policy
logic. A policy-filtered `/api/catalog` endpoint exists and works, but no frontend code
calls it. The fallback request underneath targets `/api/participant/:bpn/catalog`, which
this backend does not implement, so it 404s and is discarded silently.

### T-02 — The same restriction is enforced in semantic search

**Result: Pass**

Setup unchanged. Steps — as Randstad: `Browse Dataspace` → `Semantic Search` →
search `concrete`.

```text
POST /api/semantic/search   consumerNodeId = Randstad

  EXCLUDED Concrete Product Passport CP-442   <-- correct
  VISIBLE  Concrete Product Passport CP-317
  VISIBLE  Concrete Product Passport CP-291

GET /api/catalog?consumerNodeId=Randstad   # the route the UI never calls

  EXCLUDED Concrete Product Passport CP-442   <-- also correct
```

T-02 is the control for T-01. The policy evaluator, the role claim and the constraint all
behave correctly. T-01 is therefore a wiring defect in one UI path, not a flaw in the
governance model. Contract negotiation re-checks policy server-side on the same evaluator,
so an asset made visible by mistake would still be refused at contract time.

Discovery leaks; access does not.

## 3) The semantic model link

`dct:conformsTo` is not an ordinary metadata string. The value is a resolvable identifier
pointing at a Vocabulary Hub, where a consumer can open the full model behind the dataset —
field tree, labels, cardinalities, definitions, usage notes and constraints on allowed
values. It is the difference between knowing a dataset exists and knowing whether it can
actually be consumed.

### T-03 — The conformsTo link never reaches the consumer's catalog view

**Result: Fail**

Setup: CP-442 given a `dct:conformsTo` value pointing at a message model in the Vocabulary
Hub.

Steps — as Randstad: browse to NordBeton AG → `View Catalog` → inspect the CP-442 entry.

Expected: the conformsTo value displayed, ideally as a link to the model.

Observed: title, description and an access tag. No DCAT metadata of any kind.

```text
Stored on CP-442:

  "additionalDcat": [
    { "key":   "dct:conformsTo",
      "value": "https://dpp.vocabulary-hub.eu/message-model/MessageModel_b564fa30-..." }
  ]

Catalog card renders:  title | description | access tag
                       dcat_fields is never read
```

Cause: not data loss. `/api/catalog` returns the complete `dcatFields` object. The catalog
card is built to show a name, a description and three tags for format, ontology and policy;
the first two are never populated by any code in the project, and `dcat_fields` is not read
at all.

### T-04 — Filtering a search by conformsTo works

**Result: Pass**

Steps: `Semantic Search` → field filter `dct:conformsTo` → partial value.

Observed: CP-442 returned, other assets excluded. Matching on the predicate is genuinely
performed in SPARQL.

### T-05 — The matched value is discarded before it reaches the result

**Result: Fail**

Steps: run the T-04 filter, then inspect the returned result.

Expected: the conformsTo value shown on the card that matched on it.

Observed: title, description, publisher and a fixed trio of keywords, themes and region.
The conformsTo value is absent — not merely unrendered, but missing from the API response.

```text
POST /api/semantic/search
  filter: dct:conformsTo ~ "vocabulary-hub"

  1 hit — Concrete Product Passport CP-442

  returned fields:
    datasetId, title, description, publisherBpn, publisherName,
    policyName, publishedAt, sessionCode, spatial, temporalCoverage,
    keywords, themes

    conformsTo — absent
```

Cause: the SPARQL `SELECT` in `backend/semantic.js` projects a fixed column list. A field
filter joins its predicate into the query under a generated variable purely so the `FILTER`
clause can test it; that variable is never projected. The value is matched and discarded in
the same query.

This affects **ten of the fifteen supported predicates**, including `dct:license`,
`dct:creator`, `dct:format`, `dct:language` and `dcat:landingPage`. Only title, description,
keywords, themes, spatial and temporal survive the projection.

For vocabulary work this is the sharpest edge in the system: the one field that points at a
semantic contract is in the group that cannot be returned.

## 4) Further observations

Found while establishing the test environment rather than by deliberate test, but both
affect whether a demonstration behaves the way it claims to.

### T-06 — A cold start silently indexes only part of the catalog

**Result: Fail**

Steps: `docker compose down -v` then `up --build` — the reset sequence the README
recommends.

Expected: all five seeded assets indexed and searchable.

Observed: one of five. Semantic search returned a single result while reporting success,
and the log read `[Seed] Semantic index recovered on retry 4`. A restart repairs it, which
is what makes it easy to miss.

Cause: `seedDemoAssets()` and `reindexAllAssetsToSemantic()` are both started unawaited at
`server.listen`. The reindexer takes its asset list before seeding has finished inserting,
so its retry loop only covers whatever existed at that instant. The rest fail against a
Fuseki that is not yet accepting connections and are never retried.

Risk for live demonstrations: the failure reports itself as a success.

### T-07 — Open access appears under two different labels

**Result: Cosmetic**

Observed: some assets are tagged `open`, others `sys-open`. They behave identically.

Cause: choosing "Open Access" stores no policy reference at all rather than the `sys-open`
policy, and the tag renders the stored identifier directly with no display mapping. An
unset policy falls back to the word `open`; a seeded asset shows its raw id. No behavioural
difference — an unset policy is treated as open — but it reads as two access levels to
anyone being shown the tool.

## 5) Notes on method

- T-01 through T-05 reproduce against the state described in each setup.
- Negotiation-time enforcement was read from source rather than executed, to leave the demo
  state untouched.
- Results were verified by direct HTTP probe against the running stack, not inferred from
  code alone.
