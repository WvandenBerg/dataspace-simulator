<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a FEATURE REQUEST. You can select other issue templates -->

### Problem / goal

The repo now ships third-party SHACL files as scenario fixtures, under
`backend/scenarios/catalog-profiles/mobilitydcat-ap-1.1.0/`:

| file | from | licence |
| --- | --- | --- |
| `mobilitydcat-ap_1.1.0_shacl_shapes.ttl` | NAPCORE SWG 4.4, mobilityDCAT-AP 1.1.0 | CC BY 4.0 |
| `mobilitydcat-ap_1.1.0_shacl_range.ttl` | same | CC BY 4.0 |
| `mobilitydcat-ap_1.1.0_shacl_mdr-vocabularies.shape.ttl` | same | CC BY 4.0 |
| `dcat-ap_2.0.1_shacl_shapes.ttl` | SEMIC / DIGIT, DCAT-AP 2.0.1 | CC BY 4.0 |

The licence is declared inside each file (`dct:license`), and the files are copied
verbatim, so the notice travels with them. That is probably enough for CC BY, but
nothing at repo level says these files are not ours, where they came from, or that
`LICENSE_non-code` does not cover them in our name. Someone reusing the scenario
folder would have to open the Turtle to find out.

### What is the expected outcome?

A short attribution note at repo level for every third-party file we ship, with
source URL, rights holder, licence and "unmodified". Applies to the mobilityDCAT-AP
and DCAT-AP shapes now, and to whatever profile fixture comes next.

### Which (groups of) users will actually use this feature?

Anyone reusing or redistributing the simulator, and us when FUSE4CCAM asks what we
can share publicly.

### How will these users actually use this feature?

Read the note before copying the scenario folder somewhere else.

### Solution design

Smallest thing that works: a `NOTICE` file in the repo root, or a section in
`LICENSE_non-code`, listing the files in the table above. Alternatively a
`README` next to the files in `catalog-profiles/`, which keeps the note where the
files are and scales per profile.

Worth deciding whether the simulator default profile (`simulator-default_shacl.ttl`,
written here) needs saying explicitly to be ours under `LICENSE_non-code`.

### Relevant documentation

- <https://mobilitydcat-ap.github.io/mobilityDCAT-AP/releases/shaclShapes/>
- <https://semiceu.github.io/DCAT-AP/releases/2.0.1/>
- <https://creativecommons.org/licenses/by/4.0/>, section 3(a) on attribution
