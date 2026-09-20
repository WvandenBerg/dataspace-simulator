<!-- TARGET REPO: this one (dataspace-simulator). -->

<!-- This is the template for a FEATURE REQUEST. You can select other issue templates -->

### Problem / goal

Alignment-widened discovery works, but the simulator shows only one way of wiring it up,
shows it silently, and does not admit that the wiring is a design choice rather than a
fact.

#### The hop is invisible

A widened search looks exactly like a plain one while it runs. The consumer lights up,
the providers light up, results appear. The vocabulary hub takes no visible part in the
one workflow that cannot happen without it. `ControlPlaneBeam` and `setRingLight` already
exist and already animate the catalog hop, so the machinery is there and unused.

#### The topology on screen is one option presented as the only one

The hub currently tethers to the dashed dataspace circle, which reads as "the dataspace
runs a vocabulary service and discovery goes through it". `POST /api/semantic/search`
matches that picture: the consumer sends `useAlignments` and `minCoverage`, and something
on the dataspace side expands the profile set.

That is the better architecture and it is not the one anyone can deploy. The Data Space
Protocol has no room today for a catalog request that carries "and anything aligned to
this". Getting DSP and the EDC to grow one is a mid to long term commitment, with the
patience that implies.

What works with unmodified connectors is the other shape: each participant queries the
hub itself, resolves the set of schema values it cares about, and then sends an ordinary
catalog query carrying those literal values over the control plane. No connector learns
anything about vocabularies. The cost is that every participant integrates with the hub
separately, and N integrations is exactly the cost a dataspace standard exists to avoid.

Both are worth teaching. The first is where this should go, the second is what you can
build this year, and the difference between them is a real argument that people in this
space are actually having. A simulator that shows only one of them is arguing a position
rather than explaining a choice.

### What is the expected outcome?

The dataspace can be switched between two vocabulary hub integration topologies, the
canvas shows which one is in force, and a widened search animates the hop so you can see
what each topology actually puts on the wire.

### Which (groups of) users will actually use this feature?

Anyone using the simulator to explain why vocabulary alignment is hard to deploy, rather
than just that it is useful. That is the FUSE4CCAM audience and it is also the DSSC and
EDC audience.

Also anyone presenting the hub at all. Right now the most interesting thing the hub does
happens off screen.

### How will these users actually use this feature?

Pick a topology in the Dataspace services panel, run the same search twice, and watch two
different animations produce the same results for different reasons.

### Solution design

#### The backend already supports both

Worth stating up front, because it makes this much cheaper than it looks. The two
topologies differ in who expands the profile set and what the catalog request carries:

| | who expands | request carries |
| --- | --- | --- |
| dataspace-mediated | the search service | intent: `schemaProfiles` + `useAlignments` + `minCoverage` |
| participant-side | the consumer | values: an already-widened `schemaProfiles` |

`POST /api/semantic/search` handles the first today. It handles the second today too, if
the caller passes a widened set and leaves `useAlignments` off. So participant-side needs
no new endpoint. It needs the frontend to call `GET /api/vocabhub/alignments` itself,
union the sources into the picked set, and send that.

That symmetry is the teaching point in one line: same results, same endpoint, different
thing on the wire.

#### Ideas for showing the participant-side topology

Several of these combine. They are listed roughly in order of how much they buy.

1. Two beams instead of one. Dataspace-mediated animates consumer to ring, with a pulse
   travelling the hub tether while the ring holds. Participant-side animates consumer to
   hub first, waits for it to come back, then consumer to ring. The extra round trip is
   the whole difference and it should cost visible time.

2. Label the beam with its payload. Dataspace-mediated reads
   `schema ∈ {OpenLABEL}, aligned ≥ 0.8`. Participant-side reads
   `schema ∈ {OpenLABEL, nuScenes}`. Nothing else explains as fast why one needs a
   protocol change and the other does not.

3. Move the tether. In participant-side the hub stops being attached to the dashed circle
   and grows a thin line to whichever node is querying, drawn only during the query. Over
   a few searches from different nodes you watch the N integrations accumulate.

4. A per-participant integration flag, as a stretch. In participant-side, a node without
   the flag cannot widen and silently gets fewer results. That is the cost of N
   integrations made concrete rather than asserted, and it is the kind of thing people
   remember.

5. Keep the hub badge honest. Participant-side means the hub is a client-side dependency
   of each node, so a small hub mark on the connectors reads more truthfully than a
   dataspace-level service disc.

#### Where the switch lives

The Dataspace services panel, next to the vocabulary service toggle, since it is a
property of how the dataspace is put together. It pairs with the `services` key proposed
in ISSUE-08, so a scenario could ship either topology.

#### Two things to stay honest about

The dataspace-mediated mode is a stand-in for a protocol extension that does not exist.
The simulator's search API is not DSP and should not be presented as though DSP already
carries this. Say so on screen or in the walkthrough.

Provenance differs between the two. Participant-side, the consumer did its own expansion,
so it can label a result "via nuScenes 0.81" from its own knowledge. Dataspace-mediated,
that label comes back from a party the consumer is trusting. Same badge, different
grounds for believing it.

### Relevant documentation

`frontend/src/components/BalloonGroup/popups/BrowseDataspacePopup.jsx` for the search
call and the toggle, `backend/server.js` for `widenByAlignments`, and
`frontend/src/components/hooks/useVocabularyHub.js` plus `DataspaceServicesPanel.jsx` for
the tether and the panel.

`ControlPlaneBeam` and `setRingLight` in `MacroView.jsx` for the existing catalog hop
animation.
