# Simulator Technical Documentation

This document describes the technical design and runtime behavior of the standalone
`simulator/` application.

## 1) System overview

The simulator consists of four containers:

| Service | Tech | Responsibility | Port |
|---|---|---|---|
| `sim-frontend` | React + Framer Motion | UI, interaction, visual workflow rendering | 3000 |
| `sim-backend` | Node.js + Express | API, persistence orchestration, policy checks, state machine | 3001 |
| `sim-fuseki` | Apache Jena Fuseki | RDF graph storage, SPARQL queries | 3030 |
| `sim-validator` | Python, pyshacl | SHACL validation of catalog entries (Semantic Treehouse's json-ld-validator) | 8000 |

High-level data flow:
1. Frontend triggers backend APIs.
2. Backend persists operational state in SQLite.
3. Backend maps metadata to RDF and writes/queries Fuseki.
4. Frontend visualizes process states (discovery, catalog fan-out, negotiation, transfer).

## 2) Backend modules

### `backend/server.js`

Main HTTP API and orchestration layer.

Responsibilities:
- node, asset, policy, catalog endpoints
- semantic search endpoint (`/api/semantic/search`)
- negotiation/transfer endpoints
- dataspace endpoints: list, create from a scenario, rename, reset, delete

### `backend/db.js`

SQLite schema and data access layer (better-sqlite3).

Core tables:
- `dataspaces`: the list in the sidebar, with the scenario each came from
- `nodes`
- `assets`
- `policies`
- `negotiations`
- `transfers`
- `received_data`

Notes:
- Uses `WAL` journal mode.
- Includes schema migration helper (`ensureColumn`) for additive columns.

### `backend/semantic.js`

Fuseki integration and SPARQL logic.

Responsibilities:
- map published assets to RDF/DCAT triples
- upsert/delete datasets in Fuseki
- execute semantic search query with filter composition
- support optional Fuseki Basic Auth via env vars

### `backend/validator.js`

Checks a dataspace's catalog against its catalog profile.

Responsibilities:
- build the data graph: the entries' triples, the profile's vocabulary files, and the hub's
  types of resources the entries point at
- send it with the profile's shapes to `sim-validator`
- map each finding back to its entry and to a field path from the dataset

### `backend/policy.js`

Policy evaluation against participant claims.

Used in:
- catalog visibility filtering
- negotiation acceptance/denial

### `backend/state-machine.js`

Negotiation and transfer lifecycle.

Negotiation states:
- `REQUESTED -> OFFERED -> AGREED`
- `TERMINATED` on denial/error

Transfer states:
- `STARTED -> COMPLETED`
- `TERMINATED` on failure

## 3) Frontend modules

### `frontend/src/components/MacroView.jsx`

Root visualization surface:
- nodes/connector positioning
- beams and pulses for control/data plane
- node assets loading and local updates

### `frontend/src/components/BalloonGroup/*`

Participant interaction UI:
- browse dataspace
- semantic search popup
- negotiation/transfer hooks
- data storage section

### `frontend/src/components/PublishAssetDialog.jsx`

Asset publish form with:
- file upload (`JSON`, `CSV`, `TXT`)
- policy selection and constraint values
- dynamic DCAT field selection

### `frontend/src/components/hooks/useViewState.js`

Canvas pan/zoom logic.

Implementation detail:
- middle-mouse pan uses immediate x/y updates for direct control
- zoom remains eased

## 4) API reference (key endpoints)

Base URL: `http://localhost:3001/api`

### Nodes
- `GET /nodes`
- `GET /nodes/:id`
- `POST /nodes`
- `PATCH /nodes/:id`
- `PATCH /nodes/:id/position`
- `DELETE /nodes/:id`

### Assets
- `GET /assets?nodeId=<id>`
- `GET /assets/:id`
- `POST /assets`
- `DELETE /assets/:id`

`POST /assets` stores:
- name/description
- file metadata
- payload content (`content`)
- policy reference
- DCAT fields

### Policies
- `GET /policies`
- `POST /policies`
- `DELETE /policies/:id`

### Catalog
- `GET /catalog?consumerNodeId=<id>&providerNodeId=<id>`

Behavior:
- applies policy visibility filtering for consumer
- optional provider-scoping for fan-out simulation

### Semantic
- `POST /semantic/search`

Request body fields:
- `searchText` (optional)
- `consumerNodeId` (optional but recommended)
- `dcatFieldFilters: [{ key, value }]` (optional)
- `limit`

### Negotiation/Transfer
- `POST /negotiate`
- `GET /negotiate/:id`
- `POST /transfer`

### Dataspaces
- `GET /dataspaces`: each with its scenario and its participant and asset counts
- `POST /dataspaces` with `{ name, scenarioId? }`: creates it and loads the scenario
- `PATCH /dataspaces/:id` with `{ name }`
- `POST /dataspaces/:id/reset`: back to its scenario, or empty without one
- `DELETE /dataspaces/:id`: removes it with everything it holds, in SQLite and Fuseki

### Dataspace settings and validation
- `GET /dataspaces/:id/settings`
- `PATCH /dataspaces/:id/settings` with `{ vocabHub }`, `{ validator: { enabled } }` or
  `{ catalog: { profileId } }`
- `GET /dataspaces/:id/validation`: every entry checked against the catalog profile, with
  findings per entry. Answers 409 unless both the Vocabulary Hub and the validator are on.

## 5) Persistence model

## 5.1 SQLite

Operational state and payload persistence:
- published assets and payload content
- policy definitions
- negotiation/transfer records
- received-data entries for consumers

## 5.2 Fuseki

Semantic metadata persistence:
- RDF/DCAT graph data
- named graph grouping by publisher/session
- queried by SPARQL for semantic refinement

## 6) Semantic pipeline details

The semantic endpoint is catalog-first:

1. Load all assets from SQLite.
2. Apply policy visibility against `consumerNodeId` claims.
3. Build visible dataset ID set.
4. Execute SPARQL limited to visible IDs.
5. Return enriched semantic result list.

This prevents semantic search from exposing non-visible datasets.

### SPARQL filtering dimensions

Free text may target title/description/keywords/themes.

Structured field filters are mapped to predicates including:
- `dcat:keyword`
- `dcat:theme`
- `dct:spatial`
- `dct:temporal`
- `dct:language`
- `dct:format`
- `dct:license`
- `dct:creator`
- `dct:conformsTo`
- `dct:accrualPeriodicity`
- `dcat:landingPage`
- `dcat:contactPoint`

## 7) Policy evaluation model

Policy constraints are evaluated against node claims in metadata.

Example claim keys used in simulator flows:
- `industry`
- `orgRole`
- participant identifier / DID-like values

Policy effects:
- catalog inclusion/exclusion
- negotiation acceptance/termination

## 8) Negotiation and transfer sequence

Sequence (auto mode):
1. Consumer sends `POST /negotiate`.
2. Backend creates negotiation and advances state asynchronously.
3. Frontend polls `GET /negotiate/:id`.
4. On `AGREED`, frontend triggers `POST /transfer`.
5. Backend records transfer and copies payload to consumer received store.
6. Frontend updates consumer storage view.

Semantic-result action path:
- `Request Contract` can run with auto-transfer option.

## 9) File payload handling

Publish accepts `JSON`, `CSV`, `TXT`.

Behavior:
- `JSON`: parsed if valid, otherwise treated as text
- `CSV/TXT`: stored as text payload

Payload is persisted in:
- `assets.asset_content`
- `received_data.asset_content` (after transfer)

## 10) Configuration

Relevant environment variables:
- `PORT` (backend)
- `DB_PATH`
- `FUSEKI_URL`
- `FUSEKI_DATASET`
- `FUSEKI_USERNAME`
- `FUSEKI_PASSWORD`
- `VALIDATOR_URL`
- `AUTO_ACCEPT_NEGOTIATIONS`

## 11) Known limitations

- single local deployment simulates multiple participants
- no full DSP/EDC connector runtime path
- simplified transfer semantics vs. production data plane
- no cryptographic identity/trust infrastructure

## 12) Developer operations

Start:
```bash
docker compose up -d --build
```

Rebuild frontend only:
```bash
docker compose build sim-frontend && docker compose up -d sim-frontend
```

Rebuild backend only:
```bash
docker compose build sim-backend && docker compose up -d sim-backend
```

Tail backend logs:
```bash
docker compose logs -f sim-backend
```

## 13) Suggested paper positioning

When citing this artifact in a paper, position it as:
- an executable reference implementation of policy-constrained semantic discovery,
- a controlled experimentation environment,
- and a communication tool for complex dataspace workflows.
