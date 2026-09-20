<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a FEATURE REQUEST. You can select other issue templates -->

### Problem / goal

A scenario owns its participants and its assets, but not its policies, and not the
services its dataspace runs.

#### Policies

Every asset in `backend/scenarios/*.json` has to reference one of the four policies
seeded globally in the database, and all four were written for the construction demo:

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

#### Services

The same gap, one level up. A dataspace can now run a vocabulary service or not, and the
switch is in `localStorage` under `vocabhub-enabled:<dataspaceId>`. A scenario cannot set
it. So loading the fuse4ccam scenario gives you the participants, the assets and the hub
contents, and then leaves the service switched off, which is the one state in which none
of the hub contents can be reached. Whoever is presenting has to know to flip it by hand.

Storing it in the browser is the wrong shape for a second reason: it is configuration of
the dataspace, not a view preference, so it should survive opening the simulator
somewhere else. The hub's canvas position is a genuine view preference and can stay where
it is.

### What is the expected outcome?

A scenario can define its own policies and declare which services its dataspace runs.
Loading a scenario brings both with it, so a preset arrives ready to demonstrate.

### Which (groups of) users will actually use this feature?

Anyone writing a scenario. Also anyone using the simulator to teach what a policy
actually does, which is most of the point of the tool.

For services, anyone presenting from a preset. Right now the fuse4ccam demo has a manual
step before it shows anything.

### How will these users actually use this feature?

Unchanged in the UI. The policy dropdown in the publish dialog would list the policies
belonging to the active dataspace rather than the four global ones. The Dataspace
services panel would show the scenario's services already switched on, and stay a live
toggle so it can still be switched off to make the teaching point.

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

For services, add a `services` key alongside it:

```json
"services": { "vocabulary": true }
```

That wants a home on the dataspace record rather than in `localStorage`, so
`useVocabularyHub` would read `isEnabled` from the dataspace instead of the browser and
write back through an endpoint. Worth keeping the shape open: discovery is currently
hardcoded as always-on in `DataspaceServicesPanel`, and the DSSC service set is longer
than two.

### Relevant documentation

`backend/policy.js` for how claims are evaluated. Participant claims come from the flat
keys in `node.metadata` (`industry`, `orgRole`, `bpn`), which scenarios already set via
`participant.credentials`.

`frontend/src/components/hooks/useVocabularyHub.js` for the current storage keys, and
`DataspaceServicesPanel.jsx` for the panel that would reflect the scenario's services.
