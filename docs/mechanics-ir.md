# MechanicsIR Boundaries

MechanicsIR is a small executable data language. It is not an automatic
semantic extractor: source prose, headings, and marked items remain only
SourceStatements until an explicit interpretation is reviewed and accepted.

`compileMechanics` consumes only caller-named accepted interpretations. Each
accepted interpretation must have source statements, matching evidence refs, a
permitted gameplay authority, a `mechanics.*` path, a strict candidate schema,
and an auditable review. The compiler does not infer actions, checks, effects,

The DSL limits predicates to boolean composition, clue/scene/item facts,
declared state equality, and NPC state. Effects are limited to clue discovery,
declared state writes, connection unlocks, encounters, rewards, and an explicit
end game. IDs and all referenced symbols are statically checked, and the
canonical MechanicsIR hash is stable for identical input.

`availability` means an action may be attempted. `onSuccess` means an effect
occurs after that attempt succeeds. A parent clue making a child action
available does not discover the child; only an explicit `discover_clue` effect
does so.

Unknown, candidate, rejected, and deferred interpretations remain valid
non-executable states. P4 will add mechanism-graph reachability and ending
closure validation. P5 may apply deterministic templates to real module input;
this P3 implementation does neither and does not alter ModuleData or runtime
behavior.
