<!-- This is the template for a BUG REPORT. You can select other issue templates -->

### What is the current *bug* behavior?

The SHACL validator never dereferences `owl:imports` in the shapes graph. When a shapes
file is a thin wrapper that imports its real constraints, pySHACL validates against an
almost empty shapes graph, finds nothing to check, and reports `conforms: true`.

The failure is silent. You get a passing result rather than an error, which is the worst
possible way for this to go wrong. Anyone validating against a modular profile gets a green
light that means nothing.

This bites immediately with mobilityDCAT-AP, whose published shapes are structured as a
wrapper around imported shape graphs.

### What is the expected *correct* behavior?

Either resolve `owl:imports` so the full shapes graph is validated, or refuse to run and
say clearly that the shapes graph contains unresolved imports. Silently passing is not an
acceptable third option.

### Context information

* Version info: `json-ld-validator`, `src/shacl-validator/app.py`
* Environment: local checkout at `/home/bergwvd/json-ld-validator`
* Resource links: `app.py` `validate()`, pySHACL `do_owl_imports` parameter

### Steps to reproduce

1. Take a shapes graph whose only real content is `owl:imports <some-other-shapes-graph>`.
2. Post it to the validator with any data graph, valid or not.
3. The response is `conforms: true` with an empty results graph.

### Relevant logs and/or screenshots

`app.py` calls pySHACL without the import flag, so the default `do_owl_imports=False`
applies:

```python
conforms, results_graph, results_text = psh.validate(
    data_graph=data_graph,
    shacl_graph=shacl_graph,
    ont_graph=ontology_graph,
    inference=LITERAL_MAP[request.inference_type],
    abort_on_first=request.abort_on_first,
    meta_shacl=request.validate_shacl,
)
```

`load_graph()` does no dereferencing of its own, so nothing else picks this up.

### Possible fixes

Add `do_owl_imports` to `ShaclValidationRequest` and pass it through. Defaulting it to
`True` matches what most callers expect, though it does mean the validator starts making
outbound network calls, which is worth a conscious decision rather than a quiet default.

Note this is a real deployment question for FUSE4CCAM, where the validator is meant to run
as a testbed. A validator that fetches arbitrary imported URLs at request time is a
different security posture from one that does not. A cached or pre-flattened shapes bundle
avoids both the network calls and the silent pass.

Blocks using the validator against mobilityDCAT-AP as published. Workaround for now is to
pre-flatten the shapes into a single graph and validate against that.
