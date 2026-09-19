<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a FEATURE REQUEST. You can select other issue templates -->

### Problem / goal

`additionalDcat` can only ever produce a literal. In `semantic.js`:

```js
for (const entry of (dataset.additionalDcat || [])) {
    const predicate = DCAT_FIELD_TO_PREDICATE[entry.key];
    if (predicate && entry.value) {
        triples.push(`<${dsIri}> <${predicate}> "${escapeLiteral(entry.value)}" .`);
    }
}
```

The value is always quoted, so the object is always a string. That is fine for
`dct:title`, and wrong for every field whose range is a controlled vocabulary term.

mobilityDCAT-AP has ten controlled vocabularies of its own and inherits more from the
EU Publications Office. `dct:accrualPeriodicity` wants a term from the EU Frequency
authority table, `mobilitydcatap:mobilityTheme` wants a term from the mobility theme
vocabulary, `dct:spatial` wants a place URI. All of them currently go in as prose. So
`"Quarterly"` is stored where
`<http://publications.europa.eu/resource/authority/frequency/QUARTERLY>` belongs.

This is invisible until validation. A SHACL shape with `sh:nodeKind sh:IRI` or
`sh:class skos:Concept` will fail on every one of these, for a reason that has nothing
to do with the record the user actually wrote. It would make the validation demo report
violations that are artefacts of the simulator rather than of the metadata.

Distributions already dodge this: `dataStandard.conformsTo` and `dataStandard.schema`
are emitted as IRIs, because `distributionTriples` knows those two are references. The
generic path has no such knowledge.

### What is the expected outcome?

A DCAT field can declare whether its object is a literal or a reference, and the writer
honours that. Searching and filtering keep working either way.

### Which (groups of) users will actually use this feature?

Anyone publishing an asset that is meant to survive validation. Directly blocks the
metadata validation workflow.

### How will these users actually use this feature?

Unchanged in the UI for literal fields. For a controlled-vocabulary field the publish
dialog would offer terms rather than a free-text box, and store the term URI.

### Solution design

Give `DCAT_FIELD_TO_PREDICATE` entries a kind, rather than mapping straight to a
predicate string:

```js
'dct:title': { predicate: '...', kind: 'literal' },
'dct:accrualPeriodicity': { predicate: '...', kind: 'iri' },
```

Then `upsertSemanticDataset` picks `"${escapeLiteral(v)}"` or `<${escapeIri(v)}>`, and
`semanticSearch` keeps using `STR(?v)` so `CONTAINS` filters still match on the URI
text. Filtering on an IRI by substring is crude but it is what the current UI offers,
and set-membership filtering is coming with the alignment work anyway.

A value that is already an absolute URI could be emitted as an IRI regardless of the
declared kind, so existing scenario data does not have to be rewritten in one go.

### Relevant documentation

mobilityDCAT-AP 1.1.0, Appendix on controlled vocabularies.
The `sample_data/vocabularies` directory of github.com/mobilityDCAT-AP/validation holds
the vocabulary stubs their own runner merges before validating.
