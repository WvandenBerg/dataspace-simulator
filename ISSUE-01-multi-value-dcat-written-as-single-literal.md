<!-- This is the template for a BUG REPORT. You can select other issue templates -->

### What is the current *bug* behavior?

Six DCAT fields are marked `multi: true` in the publish form, but only three of them
actually produce multiple RDF triples. `dct:language`, `dct:creator` and `dct:conformsTo`
are stored as one literal containing the user's commas.

Publishing an asset with `dct:conformsTo` set to `ASAM OpenLABEL 1.0, nuScenes` gives you
a single triple:

```
<urn:dataset:...> <http://purl.org/dc/terms/conformsTo> "ASAM OpenLABEL 1.0, nuScenes" .
```

and the search API returns it as a one-element array:

```json
{ "dcat": { "dct:conformsTo": ["ASAM OpenLABEL 1.0, nuScenes"] } }
```

Reading is fine since the DCAT projection fix. It is the write path that lumps the values.

### What is the expected *correct* behavior?

One triple per value, so the example above yields two `dct:conformsTo` triples and comes
back as `["ASAM OpenLABEL 1.0", "nuScenes"]`.

### Context information

* Version info: fork of `project-construct-x/dataspace-simulator`, at commit `40aa2bd`
* Environment: local `docker compose`, `sim-backend` on :4001, `sim-fuseki` on :4030
* Resource links: `frontend/src/components/PublishAssetDialog.jsx`, `backend/semantic.js`

### Steps to reproduce

1. Open http://localhost:4000 and publish an asset.
2. Add the `Conforms To` field and enter `ASAM OpenLABEL 1.0, nuScenes`.
3. Publish, then `POST /api/semantic/search` with `{"searchText": "<your title>"}`.
4. Look at `dcat["dct:conformsTo"]` in the response. It has one element, not two.

### Relevant logs and/or screenshots

`buildDcatPayload()` in `PublishAssetDialog.jsx` only splits three of the six multi fields.
Everything else is passed through as a trimmed string:

```js
const add = dcatFields
    .filter(f => !['dcat:keyword', 'dcat:theme', 'dct:spatial'].includes(f.key) && f.value.trim())
    .map(f => ({ key: f.key, value: f.value.trim() }));
```

`upsertSemanticDataset()` in `backend/semantic.js` then emits exactly one triple per entry,
while keywords, themes and spatial each get a loop:

```js
for (const entry of (dataset.additionalDcat || [])) {
    const predicate = DCAT_FIELD_TO_PREDICATE[entry.key];
    if (predicate && entry.value) {
        triples.push(`<${dsIri}> <${predicate}> "${escapeLiteral(entry.value)}" .`);
    }
}
```

### Possible fixes

Let `additionalDcat[].value` be a string or an array, split on the `multi` flag that
`DCAT_OPTIONS` already carries, and loop in `upsertSemanticDataset`. Accepting both shapes
keeps existing stored assets working without a migration.

Worth doing before set-membership filtering on `mobilitydcatap:schema`, which needs one
value per triple to match against a `VALUES` block. Until then any asset declaring more
than one data standard is invisible to that filter.
