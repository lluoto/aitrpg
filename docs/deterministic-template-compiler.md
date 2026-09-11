# Deterministic Template Compiler Boundaries

The deterministic template compiler works only from explicit SourceFactGraph
structure. A heading creates a draft scene candidate. A named marked item with
body evidence under that heading creates a draft clue candidate and the sole
P5 mechanism: `marked-item-observation-v1`.

That mechanism is an `engine_policy` default, not a module-explicit source
fact. It can compile only in compatible mode with its policy ID explicitly
allowed, an approved-policy review, exact statement evidence, default
derivation, and gameplay-mechanic schema. Strict mode rejects all engine policy
mechanisms. It cannot replace an accepted module-explicit mechanism on the same
path.

The template produces only `observe`, `check: none`, and an explicit
`discover_clue` success effect. It never infers skills, difficulty, importance,
core status, connections, state writes, endings, NPC dialogue, or paragraph
clues. Nameless or unscoped marked items remain unresolved rather than receiving
invented names or scenes.

Output is always `draft_only`. Its blocking codes report that scene candidates,
entry scene, ending rules, and connection topology remain unresolved. These
codes are intentional evidence that the draft is not publishable. P6 may add
explicit deterministic templates for topology, endings, and core-clue policy;
P5 does not modify ModuleData or runtime behavior.
