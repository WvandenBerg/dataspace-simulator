<!-- TARGET REPO: semantic-treehouse, NOT this one. Relates to epic &50. -->
<!-- The simulator consumes the export, so this is filed upstream and the -->
<!-- missing data is carried as local fixture data in the meantime. -->

<!-- This is the template for a FEATURE REQUEST. You can select other issue templates -->

### Problem / goal

Two gaps in the STH catalogue export turned up while building a dataspace demo that
consumes it as the Vocabulary Hub's source of truth. Both block the alignment-driven
discovery story in US-6, and neither is a bug in the current export, they are things it was
never asked to carry.

**Alignments have no coverage figure.** US-6 describes alignments as directed and partial,
and the whole point of showing one to a user is to say how much of the source it actually
covers. "Reachable from X via alignment A1, 72% coverage" is the sentence we want to put on
screen. The export gives us the alignment and its direction, but no number, so a consumer
can only show "reachable" with no sense of how well.

**Only `MessageModelVersion` becomes a `prof:Profile`.** That is correct for standards
maintained inside STH, but it means external standards cannot be represented at all. In a
CCAM setting most of the interesting profiles are external: ASAM OpenDRIVE, ASAM
OpenSCENARIO, ASAM OpenLABEL, NDS.Live, Lanelet2, DATEX II. If the hub can only publish
profiles that STH itself hosts, it cannot describe the landscape it is supposed to help
people navigate, and every alignment has to point at something STH owns on both ends.

### What is the expected outcome?

Coverage available as a machine-readable value on the alignment, and some way to register
an externally-maintained standard as a profile so alignments can target it.

For coverage, DQV is the natural fit and keeps this in vocabulary terms rather than
inventing a field:

```turtle
<alignment/nuscenes-to-openlabel> a pmap:ProfileAlignment ;
    pmap:sourceProfile <profile/nuscenes> ;
    pmap:targetProfile <profile/openlabel> ;
    dqv:hasQualityMeasurement [
        dqv:isMeasurementOf <metric/elementCoverage> ;
        dqv:value "0.81"^^xsd:decimal
    ] .
```

For external profiles, the minimum is an identifier, a title and a version, with the
resource list allowed to be empty or to carry only a link out. No requirement that STH
holds the artefacts.

### Which (groups of) users will actually use this feature?

Data consumers browsing a dataspace catalogue, via whatever hub client sits in front of the
export. They are the ones who see "reachable via alignment" and have to decide whether that
is good enough for their purpose. A 0.8 coverage and a 0.4 coverage are very different
answers and right now they look identical.

Secondarily the FUSE4CCAM work, where the traceability spine runs from requirement to
CCAM-DCAT-AP element to SHACL constraint to aggregated validation failures. External
standards appear all over that chain.

### How will these users actually use this feature?

Filtering a catalogue by "conforms to profile Y", then widening the filter to include
datasets that conform to some X with an alignment to Y, with a minimum coverage threshold
so the widening stays honest. The threshold is the part that needs the number.

### Solution design

Both are additive, so existing consumers are unaffected. Coverage as an optional
`dqv:hasQualityMeasurement` on the alignment. External profiles as a registration that
produces a `prof:Profile` with no local artefacts.

How coverage gets computed is the real question and not one to answer here. Counting mapped
elements over source elements is the obvious starting point, but weighting by whether the
element is mandatory would give a more useful number. Worth agreeing the metric before the
predicate, since consumers will compare values across alignments.

### Relevant documentation

* Epic &50, Vocabulary hub federation phase 2, phases 2 and 3
* US-6, alignment-widened discovery with a coverage threshold
* MR 906, which flipped the direction to an STH catalogue export
* Parked from the dataspace simulator work. The demo currently carries coverage figures as
  local fixture data, which is exactly the thing this issue would remove the need for.
