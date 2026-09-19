<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a BUG REPORT. You can select other issue templates -->

### What is the current *bug* behavior?

A dataspace you create cannot be deleted from the UI, ever. The delete icon renders
under `{!space.isDemo && (`, and `submitCreate` in `DataspaceSidebar.jsx` creates every
new dataspace with `isDemo: true`. So the condition is false for exactly the dataspaces
that are allowed to be deleted, and true for the two built-in ones that are not.

The `isDemo: true` is deliberate. It was set in `caf2eae` so user-created dataspaces are
editable, since the same flag gates Publish Asset and the participant menu. One flag is
doing two unrelated jobs and the delete affordance lost.

There is a second half to this. `handleDeleteDataspace` in `SimulatorPage.jsx` only
filters the entry out of React state, which is persisted to
`localStorage['simulator.dataspaces']`:

```js
const handleDeleteDataspace = (id) => {
    if (id === 'demo' || id === 'simulator') return;
    setDataspaces((prev) => prev.filter((d) => d.id !== id));
    ...
};
```

Nothing is sent to the backend. The nodes, the assets and the Fuseki named graph all
survive. So even if the button were reachable, deleting would leave orphaned rows that
no longer have a dataspace pointing at them, and they would keep turning up in semantic
search.

That mattered less when a new dataspace held almost nothing. Now that a scenario can be
loaded into one, deleting leaves real assets and real triples behind.

### What is the expected *correct* behavior?

You can delete a dataspace you created, and doing so removes its participants, its
assets and its RDF as well as the sidebar entry. The two built-in dataspaces stay
undeletable.

### Context information

* Version info: fork of `project-construct-x/dataspace-simulator`, at commit `25da2aa`
* Environment: local `docker compose`, `sim-frontend` on :4000, `sim-backend` on :4001
* Resource links: `frontend/src/components/DataspaceSidebar.jsx`, `handleDeleteDataspace` in `frontend/src/pages/SimulatorPage.jsx`, `/api/reset` in `backend/server.js`

### Steps to reproduce

1. `docker compose up -d` and open http://localhost:4000.
2. Create a dataspace in the sidebar, with or without a scenario.
3. Hover it in the list. No trash icon appears, on any of them.
4. The only way out is `localStorage.removeItem('simulator.dataspaces')` in the console,
   which also drops every other dataspace you made.

To see the orphaning half, call `handleDeleteDataspace` by temporarily flipping the
`isDemo` guard, delete a dataspace that had a scenario loaded, then:

```bash
curl -s "localhost:4001/api/assets?dataspaceId=<the-deleted-id>"
```

The assets are still there.

### Possible fixes

Stop overloading `isDemo`. It currently means "this dataspace is editable", so the delete
icon should not be reading it at all. Gate on something that actually says what it means,
for example a `locked` flag, which `SYSTEM_DATASPACES` already carries on both built-in
entries.

For the cleanup half, the backend endpoint already exists. `/api/reset` takes a
`dataspaceId` and with `keepNodes: false, keepAssets: false` it deletes the nodes, the
assets and the semantic datasets for that dataspace. So `handleDeleteDataspace` can await
that call before dropping the sidebar entry, and no new route is needed.

Worth confirming a deletion that removes assets, rather than doing it on a single click.
