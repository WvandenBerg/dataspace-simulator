<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a BUG REPORT. You can select other issue templates -->

### What is the current *bug* behavior?

Browsing another participant's catalog shows every asset they published, including ones
whose access policy should hide them from you. The catalog view renders the frontend's
local asset list, which comes from `/api/assets`, and that route has no policy logic at all.

The policy-filtered endpoint `/api/catalog` exists and works correctly. Nothing calls it.
A search across `frontend/src` returns three fetches to `/api/assets` and zero to
`/api/catalog`.

Semantic search and contract negotiation both enforce policy properly, so the policy engine
itself is sound. This is one path going around it.

### What is the expected *correct* behavior?

The catalog view should show only what the consuming participant is entitled to see, the
same set that `/api/catalog?consumerNodeId=<id>` already returns.

### Context information

* Version info: fork of `project-construct-x/dataspace-simulator`, at commit `40aa2bd`
* Environment: local `docker compose`, `sim-backend` on :4001
* Resource links: `backend/server.js` `GET /api/catalog` and `GET /api/assets`, `frontend/src/components/MacroView.jsx`

### Steps to reproduce

1. Publish an asset with a restrictive policy, for example `Industry` limited to `energy`.
2. As a participant that does not hold that credential, browse the publisher's catalog.
3. The restricted asset is listed.
4. Compare against `curl -s "localhost:4001/api/catalog?consumerNodeId=<consumer>"`, which
   correctly omits it.

### Relevant logs and/or screenshots

The only asset fetch in the frontend, from `MacroView.jsx`:

```js
const res = await fetch(`/api/assets?dataspaceId=${encodeURIComponent(dataspaceId)}`);
```

Already documented in `AGENTS.md` and `TEST-LOG.md`. Filed here because it was explicitly
parked during the Vocabulary Hub work rather than fixed.

### Possible fixes

Point the catalog browse at `/api/catalog` and pass the viewing participant as
`consumerNodeId`. The endpoint already returns `dcatFields`, so the shape is close. The
response uses `@id` where `/api/assets` uses `id`, which the caller will need to handle.

Worth deciding whether `/api/assets` should stay unfiltered. It is reasonable as an
owner-side listing, but then it should be scoped to the owner rather than returning
everything in the dataspace.
