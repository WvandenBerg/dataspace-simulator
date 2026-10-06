# Dataspace Simulator

The simulator is a standalone, interactive dataspace environment for research and teaching.
It lets users experience end-to-end dataspace behavior visually, including participant
discovery, catalog visibility, policy-based access control, semantic search, contract
negotiation, and data transfer.

The focus is not protocol compliance, but conceptual correctness and reproducibility.
This makes the simulator suitable as the primary artifact for a semantics-focused paper.

## Purpose

- Demonstrate dataspace fundamentals in an interactive and explainable way
- Provide a controllable testbed for semantic discovery with DCAT and SPARQL
- Show how credential-based policies affect visibility and access decisions
- Offer a reproducible local environment with no external dependencies

## Scope and non-goals

What it includes:
- Interactive UI for participants, catalogs, semantic search, negotiation, and transfer
- Policy engine that evaluates access constraints against participant claims
- RDF/DCAT metadata indexing in Apache Fuseki with SPARQL querying
- Persistent local state via SQLite and Docker volumes

What it does not include:
- Full DSP/EDC interoperability
- Production-grade trust infrastructure and identity federation
- Real network-level data plane implementation

## Quick start

```bash
docker compose up -d --build
```

On first startup, the backend seeds a ready-to-run demo scenario with preset participants
and sample assets (including multiple product passports for NordBeton).

Open:
- Simulator UI: `http://localhost:4000`
- Backend API: `http://localhost:4001`
- Fuseki UI: `http://localhost:4030`

To reset to a clean first-run state (and re-apply demo seed data):

```bash
docker compose down -v
docker compose up -d --build
```

## Runtime architecture

| Component | Role | Port |
|---|---|---|
| `sim-frontend` | React-based interactive simulator UI | 3000 |
| `sim-backend` | Node.js API, policy checks, state machine, persistence | 3001 |
| `sim-fuseki` | RDF store and SPARQL endpoint for semantic metadata | 3030 |

Persistence:
- SQLite database inside backend container (`/data/simulator.db`), including dataspace
  settings and catalog profile files
- Fuseki dataset in Docker volume (`fuseki-data`)

## Functional model

### 1) Participants and credentials

Participants (nodes) represent organizations in a dataspace. Each node can carry claims
such as `industry` and `orgRole` and role capabilities (`provider`, `consumer`).

These claims are evaluated by policies during catalog and negotiation phases.

### 2) Publish

A provider publishes an asset with:
- Base fields: title, description, filename
- Optional policy template
- Metadata fields from the catalog's profile: the mandatory ones are in the form from the
  start, the others can be added
- File payload (`JSON`, `CSV`, or `TXT`)

On publish:
- Asset and payload are persisted in SQLite
- Semantic metadata is converted to RDF/DCAT and indexed in Fuseki

### 3) Discovery and catalog access

The consumer discovers available providers and requests catalogs.
Catalog responses are policy-filtered first, based on the consumer's claims.

This is intentional: semantic ranking is only applied within policy-visible assets.

### 4) Semantic search

Semantic search follows a catalog-first strategy:
1. Determine visible assets using policy checks
2. Restrict semantic query scope to those visible dataset IDs
3. Run SPARQL in Fuseki for semantic refinement

Supported query styles:
- Free-text search over the top-level fields of the catalog's profile
- Filters on any field of that profile, nested ones included, each showing how many entries
  fill it
- A data-standard filter on the field the profile names, optionally widened along the
  Vocabulary Hub's alignments
- Combinations of the above

### 5) Negotiation

The negotiation state machine models:
- `REQUESTED -> OFFERED -> AGREED`
- or `TERMINATED` on policy denial

Policy is checked again at negotiation time to model access enforcement at contract phase.

### 6) Transfer

After `AGREED`, transfer is initiated and completed through the backend state machine.

In this simulator, transfer means:
- provider asset payload is copied to the consumer-side received store
- transfer lifecycle is persisted and visualized

This models functional transfer semantics, not low-level data-plane transport.

### 7) Vocabulary Hub

Each dataspace can run a Vocabulary Hub: a dataspace service that joins the ring through its
own connector. It is drawn as a circle where participants are cards. Switch it on in the
Dataspace services panel; it only answers while it sits on the ring.

It holds:
- **profiles and alignments** from a scenario's catalogue export, used to widen semantic
  search along alignments;
- **catalog profiles:** SHACL shapes that define catalog entries (e.g. mobilityDCAT-AP,
  DCAT-AP), shipped with a scenario or uploaded in the hub dialog.

In the hub's Catalog profiles tab a dataspace chooses which profile its catalog uses. The
publish form, the entry view and the semantic search then follow that profile's fields. Without a hub, or with nothing chosen, the
catalog falls back to the simulator's default profile. Each profile also names the field in
which an entry gives its data standard; it defaults to `dct:conformsTo` and can be changed per
profile.

`demo-files/ccam-dcat-ap-draft` holds an illustrative CCAM-DCAT-AP: mobilityDCAT-AP 3.0.0 plus
one mandatory field, the SAE J3016 automation level. Upload all nine files to the FUSE4CCAM
dataspace's hub, set the data standard field to the one mobilityDCAT-AP uses, and use the
profile for the catalog. The search then offers automation level, filled by none of the
existing entries until someone publishes one with it.

## Semantic implementation details

### Data model

Assets are indexed as `dcat:Dataset` resources with common fields like:
- `dct:title`, `dct:description`, `dct:identifier`
- `dcat:keyword`, `dcat:theme`
- `dct:spatial`, `dct:temporal`
- any other field the catalog's profile defines

Nested parts of an entry, such as distributions, get IRIs under the dataset's own IRI, so a
dataset and everything it owns are replaced or deleted together.

### Named graphs

RDF is stored in named graphs grouped by publisher and session context.
This improves conceptual isolation and supports cleaner argumentation for multi-party data
spaces (even though runtime is simulated in a single local deployment).

### Query behavior

SPARQL queries are generated by backend code and include:
- catalog-derived dataset ID restrictions
- optional text matching across the top-level fields of the catalog's profile
- optional constraints on any field path that profile defines

The query only decides which datasets match. Their contents are then read back from Fuseki
as records, so a result carries every field it has.

## Policy model

Policies are represented as constraint sets and evaluated against consumer claims.
The evaluator supports practical claim checks (for example `In` over values like industry,
role, or participant identifier).

Policy effects appear in two places:
- Catalog visibility (what can be discovered)
- Negotiation decision (what can be contracted)

## Visual simulation model

The UI intentionally visualizes control flow:
- discovery pulses
- control plane request/response beams
- negotiation states
- data transfer states

This is used as explanatory instrumentation for teaching and for paper figures/demo videos.

## Project structure

```text
simulator/
  backend/
    server.js            API and orchestration
    db.js                SQLite schema and persistence access
    semantic.js          RDF mapping, Fuseki IO, SPARQL search
    record.js            Catalog entries as records, independent of any profile
    policy.js            Policy evaluation
    state-machine.js     Negotiation and transfer lifecycle
    vocabhub.js          Vocabulary Hub: profiles and alignments per dataspace
    catalogprofiles.js   Catalog profile files and the fields their shapes define
    scenarios.js         Scenario loading
    scenarios/           Scenario presets, with catalog-exports/ and catalog-profiles/
  frontend/
    src/
      components/        visualization and interaction components
      pages/             application pages
  demo-files/            Files to upload during a demo, e.g. the CCAM-DCAT-AP draft
  docker-compose.yml
  README.md
  PRESENTATION.md
```

## Why this is paper-ready

The simulator is suitable as the central artifact for a semantics paper because it provides:
- Controlled experimentation under reproducible local conditions
- Clear separation of policy filtering and semantic ranking
- Explainable UI traces for each phase of discovery and access
- Explicit RDF/SPARQL implementation that can be inspected and replicated

## Limitations (to state explicitly in the paper)

- Single deployment simulates multiple participants; no real distributed trust fabric
- No full connector protocol stack (DSP/EDC) in runtime path
- No binary data-plane implementation beyond local transfer semantics

These limitations are acceptable for early-stage semantic workflow validation and
interaction-centered evaluation.

## Related documentation

- `simulator/PRESENTATION.md` for a full talk/demo script and architecture narrative
- `TEST-LOG.md` for the exploratory test record and known defects
- `USER-STORIES.md` for the stories those tests imply, including the Vocabulary Hub
  alignment extension
