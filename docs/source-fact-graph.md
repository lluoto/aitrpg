# SourceFactGraph Boundaries

`SourceFactGraph` records source-exact document structure. Every statement has
an `EvidenceRef` that validates against retained DocumentIR page text. Headings,
paragraphs, marked items, and list items become separate statements; relations
such as containment, order, and heading scope are deterministic document facts.

`SourceStatement` is a verbatim source assertion, not an interpreted world or
game fact. `FactInterpretationCandidate` is the separate later step that maps
one or more statements to a `ClaimCandidate`. Its initial status is candidate;
the graph builder never creates an accepted interpretation.

Reviews may deterministically accept, reject, or defer an existing candidate.
They must reference source statements and the corresponding statement evidence
IDs. Missing statements, mismatched evidence, duplicate IDs, invalid spans, and
conflicting reviews fail validation.

`unknown` and `uninterpreted` are valid states. This graph does not connect a
world-model, classify prose into gameplay, create mechanics, or modify legacy
`SourceRef`/`sourceKey`. P3 will define MechanicsIR and P4 will validate
references, reachability, and end-state closure before any executable mechanism
is admitted.
