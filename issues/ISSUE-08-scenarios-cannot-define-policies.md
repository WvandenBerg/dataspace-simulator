<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a FEATURE REQUEST. You can select other issue templates -->

### Problem / goal

A scenario owns its participants and its assets, but not its policies. Every asset in
`backend/scenarios/*.json` has to reference one of the four policies seeded globally in
the database, and all four were written for the construction demo:

| policy_id | constraint |
| --- | --- |
| `sys-open` | none |
| `sys-industry` | `cx-policy:industry In construction` |
| `sys-role` | `cx-policy:orgRole In contractor` |
| `sys-did-group` | `cx-policy:consumerDid In did:web:example.com` |

So a scenario from any other domain has exactly one usable policy, `sys-open`. The
fuse4ccam scenario puts all eleven of its assets on open access for that reason, which
makes it a poor demonstration of a dataspace: access control is the thing a dataspace is
for, and the scenario cannot show any.

It is also the wrong shape. Policies are content, the same as participants and assets,
and the other two moved into the scenario file. Leaving policies behind in a global seed
means the credentials a scenario gives its participants and the constraints its policies
test are written in two different places, and nothing checks that they agree.

### What is the expected outcome?

A scenario can define its own policies, and its assets can reference them. Loading a
scenario into a dataspace brings the policies with it.

### Which (groups of) users will actually use this feature?

Anyone writing a scenario. Also anyone using the simulator to teach what a policy
actually does, which is most of the point of the tool.

### How will these users actually use this feature?

Unchanged in the UI. The policy dropdown in the publish dialog would list the policies
belonging to the active dataspace rather than the four global ones.

### Solution design

The scenario schema already has a `policies` key in the original design sketch; it was
never implemented. Add it:

```json
"policies": [
  { "id": "f4c-consortium", "name": "Consortium members only",
    "constraintOperand": "Or",
    "constraints": [{ "key": "cx-policy:industry", "operator": "In", "value": "automotive" }] }
]
```

`scenarios.js` gains a `toPolicyRow` next to `toAssetRow` and `toNodeRow`, scoping the
id the same way. `validationProblems` should check that every `asset.policyId` names
either a scenario policy or one of the `sys-` defaults, the same way it already checks
that `ownerId` names a participant. That check is the real value here, since the current
failure mode is an asset silently referencing a policy that constrains something its
dataspace has never heard of.

Policies would then need scoping by dataspace on read, which `db.getPolicy` does not do
today.

### Relevant documentation

`backend/policy.js` for how claims are evaluated. Participant claims come from the flat
keys in `node.metadata` (`industry`, `orgRole`, `bpn`), which scenarios already set via
`participant.credentials`.
