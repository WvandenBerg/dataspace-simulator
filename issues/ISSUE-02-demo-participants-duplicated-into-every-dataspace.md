<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a BUG REPORT. You can select other issue templates -->

### What is the current *bug* behavior?

Every dataspace gets its own copy of the three demo participants, but only `demo` gets
any assets. So switching to any other dataspace shows three familiar-looking participants
whose Data Storage panel is permanently empty.

The node table after a normal start with two dataspaces visited:

```
bergstein              dataspaceId="demo"       bpn=did:web:bergstein-bau.sim.local
nordbeton              dataspaceId="demo"       bpn=did:web:nordbeton-ag.sim.local
stahlwerk              dataspaceId="demo"       bpn=did:web:stahlwerk-weber.sim.local
simulator::bergstein   dataspaceId="simulator"  bpn=did:web:bergstein-bau.sim.local
simulator::nordbeton   dataspaceId="simulator"  bpn=did:web:nordbeton-ag.sim.local
simulator::stahlwerk   dataspaceId="simulator"  bpn=did:web:stahlwerk-weber.sim.local
```

All five assets carry `dataspace_id = 'demo'`. The `demo` dataspace itself is consistent,
so this is not a broken-ownership bug. The duplicates are the problem.

Two things follow from it. The same DID exists as two distinct nodes, which makes DID a
non-identifier across the simulator. And an empty Data Storage panel renders as three
static dots that look exactly like a loading spinner, so it reads as "still loading"
rather than "nothing here".

### What is the expected *correct* behavior?

A new dataspace should start either genuinely empty, or populated from a scenario that
brings its own participants and its own assets. Copying the construction demo's
participants into an unrelated dataspace and leaving them with nothing to serve is the
worst of both.

If participants are shared across dataspaces on purpose, they should be one node each
rather than one per dataspace.

### Context information

* Version info: fork of `project-construct-x/dataspace-simulator`, at commit `40aa2bd`
* Environment: local `docker compose`, `sim-backend` on :4001
* Resource links: `backend/server.js` `DEMO_ASSETS` / `seedDemoAssets()`, `frontend/src/components/DataspaceSidebar.jsx`

### Steps to reproduce

1. `docker compose up -d` and open http://localhost:4000.
2. Switch to any dataspace other than `demo`.
3. Three participants appear. Open any of them, the Data Storage panel is empty.
4. `curl -s localhost:4001/api/nodes` now returns six nodes for three organisations.

### Relevant logs and/or screenshots

`seedDemoAssets()` hardcodes the dataspace on every asset:

```js
dataspace_id: 'demo',
```

Node scoping is by `metadata.dataspaceId`, and `server.js` filters on it at line 761.
The `<dataspace>::<node>` prefix on the id is a frontend convention for keeping ids unique,
not something the backend reads.

Known and documented in `AGENTS.md` as "Demo assets are seeded only into the `demo`
dataspace". Filing it so the duplicate-participant half is tracked too.

### Possible fixes

Falls out of the scenario preset work. Once a scenario file owns both its participants and
its assets, "new dataspace from scenario" seeds a matching pair and nothing auto-copies the
construction demo participants anywhere.

Separately, the empty Data Storage panel should say so instead of rendering dots.
