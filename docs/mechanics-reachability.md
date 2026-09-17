# Mechanics Reachability Boundaries

Mechanics reachability analyzes a closed, declared MechanicsIR state model. It
does not model free narration, undeclared actions, or any candidate that was
not compiled into MechanicsIR. An `unreachable` result means the current
declared mechanism graph has no path; it does not claim that source prose has
no solution.

The analysis input explicitly supplies the entry scene, discovery locations,
connections, and symbols. A discovery location is a separate semantic input,
not an inference from a mechanics target or source text. Missing or dangling
locations, connections, or symbols fail closed.

States normalize all sets and maps before hashing. Terminal rules run first;
otherwise compatible automatic transitions settle, then one optional player
action is explored. Conflicting automatic writes and automatic cycles fail
closed. Checked-method failures follow the declared failback threshold and the
analyzer fails with `state_limit_exceeded` rather than silently truncating.

`src/compiler/mechanics-execution.ts` owns these executable semantics. The
reachability analyzer and witness replay consume that one pure core; the core
also supports diagnostics-only prescribed execution. This is not a runtime or
GameSession integration.

Each reported core clue, failback, ending, or closed-world deadlock has a
shortest witness measured by reported step count: player actions, atomic
compatible automatic batches, and ending steps each count once. A batch retains
its concrete declared mechanism IDs. Search and replay share the same execution
semantics; replay verifies every mechanism, outcome, and before/after state
hash. Witnesses are graph evidence, not player natural-language run evidence.

`src/diagnostics/compiler-process-simulation.ts` proves one narrower process:
`prepare -> questions -> hints -> resolve -> execute`. It accepts synthetic
in-memory pages and caller-prescribed mechanism/outcome pairs only, revalidates
each identity boundary, and returns a structured refusal for incomplete or
stale stages. It has no artifact persistence, public API, ModuleData projection,
PDF decoding, or runtime consumer.

Direct shared-core action execution rejects a terminal state or any state with a
pending terminal/automatic step. State budgets expose only a frozen count and
observation operation, and action provenance is copied before returning to a
caller. The diagnostics bundle retains graph, draft, prepared queue and validated
hints, then re-resolves all of them before execution; its complete resolved
queue, IR, analysis input and reachability report must match exactly.
Prepared and resolved diagnostics snapshots are bound to private in-memory
lineage and frozen; detached clones and mixed process components fail closed.

A checked core discovery method with no failback is a failure-policy risk when
its concrete post-failure state cannot reach a deterministic or bounded
alternative without another unbounded check. A success path or a fallback only
reachable elsewhere does not clear that risk. This is distinct from a
closed-world deadlock, which requires a reachable state with no declared
terminal recovery path. P4 does not modify ModuleData or runtime behavior.
