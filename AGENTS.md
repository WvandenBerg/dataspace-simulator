# AGENTS.md

Context for coding agents working on this repository. Read this before changing code.

## 1) What this project is

A standalone, local dataspace simulator for research and teaching. Three containers:

| Service | Role | Host port |
|---|---|---|
| `sim-frontend` | React + Framer Motion UI | 4000 |
| `sim-backend` | Node/Express API, policy engine, state machine, SQLite | 4001 |
| `sim-fuseki` | Apache Jena Fuseki, RDF/DCAT store queried with SPARQL | 4030 |

The semantic layer is real: metadata genuinely becomes RDF, is stored in named graphs
partitioned by publisher and dataspace, and is queried with SPARQL. It is not mocked.

Start with `docker compose up -d --build`. See `README.md` and `DOCUMENTATION.md`.

## 2) Read these first

- `TEST-LOG.md` — verified defects, with evidence. **Check before "fixing" anything**; the
  cause is often not where the symptom appears.
- `USER-STORIES.md` — what the simulator should do, including the Vocabulary Hub alignment
  extension (US-6) that the project is building toward.

## 3) Project provenance — this matters

This simulator was **extracted from a Catena-X EDC participant application**. A lot of
scaffolding survived the extraction and now refers to things that do not exist here:

- `frontend/public/silent-check-sso.html` — Keycloak shim; there is no auth in this tool.
- `cx-logo-text.svg`, BPNs, `cx-policy:` constraint keys — Catena-X vocabulary.
- `HEARTBEAT_TIMEOUT_MS` in `docker-compose.yml` and `.env.example` — **nothing implements
  it**; the only source mentions are comments saying "no heartbeat".
- `dspEndpoint` and `catalogUrl` on every participant — collected by the form, `dspEndpoint`
  is even displayed, but **neither is ever used to make a request**.
- `/api/participant/:bpn/catalog` and `/api/consumer/catalog` — called by the frontend,
  **not implemented by this backend**. They 404 and the result is silently discarded.

Before assuming a field or endpoint is wired up, grep for an actual use. Several are not.

## 4) Known traps

These are verified, not suspected. Full evidence in `TEST-LOG.md`.

**Browsing a catalog ignores access policy.** The catalog view reads the frontend's local
asset list, loaded from `/api/assets` — a route with no policy logic. The policy-filtered
`/api/catalog` endpoint exists, works, and **is never called by any frontend code**.
Semantic search and contract negotiation *do* enforce policy correctly. The policy engine
itself is sound; only this one path bypasses it.

**Ten of fifteen DCAT predicates are filterable but not returnable.** The SPARQL `SELECT`
in `backend/semantic.js` projects a fixed column list. A field filter joins its predicate
under a generated variable purely so `FILTER` can test it, then never projects it. So
`dct:conformsTo` can be searched on and its value is discarded in the same query. This
blocks US-6.

**Cold start under-indexes, and reports success.** `seedDemoAssets()` and
`reindexAllAssetsToSemantic()` are both launched unawaited in `server.listen`. The reindexer
snapshots the asset list before seeding finishes, so its retry loop covers only what existed
at that instant. A restart repairs it, which is why it is easy to miss.

**`isDemo` gates editing.** A dataspace with `isDemo: false` hides Publish Asset and
replaces the participant menu with "Managed by participant". This models participants owned
by external connectors — a distinction inherited from the parent application that means
nothing here, since nothing external is ever contacted.

**Demo assets are seeded only into the `demo` dataspace** (`dataspace_id: 'demo'`, hardcoded).
Every other dataspace starts empty. An empty Data Storage panel renders as three static dots
that look exactly like a loading spinner.

**The Browse Dataspace UI lives in `BalloonGroup/popups/BrowseDataspacePopup.jsx`.** An older
`BrowseDataspacePanel.jsx` was deleted once it was confirmed unreachable, along with the
`onViewCatalog` prop chain and `catalogRequestLine` that existed only to serve it. The line
you see between two control planes is `ControlPlaneBeam`, driven by `setRingLight`. Check
imports before editing a component.

## 5) Conventions

**Language.** Write new code, comments and identifiers in English. Much of the existing
codebase carries German comments from earlier development — leave them as they are unless
you are already rewriting that code for another reason. Do not open a translation pass
uninvited. German in demo *data* (participant tags, locations) is intentional.

**Comments.** Prefer code that does not need one. Where a comment earns its place, explain
*why*, not *what*.

**Style.** Match the surrounding file — it mixes inline styles and CSS classes; follow
whichever the file already uses. Theme via the CSS custom properties in `Components.css`;
never hardcode colours that only work in one theme.

**Verify before claiming.** This project rewards checking. Probe the running stack over HTTP
rather than inferring behaviour from source, and say plainly which you did.

## 6) Commits

Conventional Commits. **Keep messages brief.**

```
<type>: <subject>
```

- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- Subject in the imperative, lowercase, no trailing period.
- Body only when the *why* is not obvious. Wrap at 72 characters.
- One concern per commit. Split mixed changes rather than bundling them.

```
feat: add zoom in/out buttons to the canvas
fix: apply policy filtering to catalog browse
chore: translate German comments to English
```

## 7) Checks before committing

```bash
cd frontend && npx eslint src        # 60 problems is the known baseline — do not add to it
cd frontend && npx vite build        # must succeed
```

There is no test suite. Verify behaviour against the running stack:

```bash
curl -s localhost:4001/api/health
curl -s "localhost:4001/api/catalog?consumerNodeId=<id>"
curl -s -X POST localhost:4001/api/semantic/search \
  -H 'Content-Type: application/json' -d '{"searchText":"concrete"}'
```

Rebuild a single service with
`docker compose build sim-frontend && docker compose up -d sim-frontend`.
