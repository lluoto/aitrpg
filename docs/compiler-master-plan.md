# Compiler Master Plan

This is the control plan for the evidence-bound module compiler. It describes
the current implementation boundary, not a new public compile entry point.

## Milestones

| Milestone | Status | Verified result |
| --- | --- | --- |
| Source structure through draft and question queue | complete | DocumentIR evidence, SourceFactGraph, deterministic marked-item draft, and evidence-bound questions remain separate from runtime module loading. |
| Checkpoint I: hints through closed-world analysis and P4 execution semantics | verified, uncommitted | Explicit hints resolve into accepted interpretations, MechanicsIR and replayable witnesses. P4 and the agreed policy/provenance/process-summary audit have regressions, restored production mutations and independent review; final full tests/typecheck pass. |
| Checkpoint II: local artifact persistence | deferred dependency | A future artifact save/restore format must preserve queue identity, document identity, module scope, accepted interpretation evidence, and the distinct queue/IR/state hash purposes. Not implemented here. |
| Checkpoint III: public compiler entry end-to-end validation | deferred dependency | A future public compile entry will validate the same chain for in-memory pages/fixtures and real PDFs. It is not implemented in this checkpoint. |
| Later milestone: runtime consumption | out of scope | GameSession, world-model/model-memory integration, and runtime consumers come after compiler artifacts and public-entry validation. |

## Checkpoint I contract

- A topology answer belongs to its source-scene question. It declares
  `connections[]`; an empty array is an explicit zero-outgoing declaration.
  Connection IDs are declarations and must be unique across the resolved set.
- An ending answer contains one or more declarations. Each declaration has a
  mechanism-rule ID and exactly one separately named `end_game.endingId`.
- Named draft clues receive a discovery question with separate clue, location,
  and mechanics-target domains. Explicit discovery requires its location;
  generic prose questions cannot bind an arbitrary clue.
- Parsed hint values are a discriminated union shared by validation and
  resolution. Queue, hints, and draft agree on module ID plus document/source
  graph identity. The graph itself remains document identity, not a module
  container.
- Resolved interpretations retain queue evidence, authority, explicit
  derivation, rights status, review audit, and `{ moduleId }` scope.
- Resolved readiness is derived from the current answered queue and current
  generated MechanicsIR; it does not copy the draft queue snapshot. Open
  draft-warning questions remain distinct from publish blockers.

## Execution and analysis policy

The analyzer uses one execution order for graph search and witnesses:

1. Select a matching ending rule by priority and execute its declared
   `end_game` effect.
2. Otherwise apply compatible automatic transitions until their effects reach
   a fixed point.
3. Then explore one optional player action (discovery or traversal).

Conflicting automatic state writes and automatic state cycles fail closed.
Ordinary connections remain traversable unless their declared availability uses
`connection_unlocked`; `unlock_connection` is the only state change required
by that predicate.

Discovery methods are unavailable once their clue is found, including other
methods for the same clue. `maxFailures: N` means N failed checked attempts
are recorded; the next attempted use follows the declared failback. A checked
core method without bounded recovery is reported as a policy risk, not falsely
named a proven deadlock. Recovery is evaluated from that method's concrete
post-failure state: a fallback in a past or mutually exclusive branch, or one
requiring another unbounded check, does not clear the risk. A real reachable
state with no terminal path is reported separately with a witness.

Witness minimality is the count of reported `steps`: player actions,
atomic compatible automatic batches, and ending steps all count once. Search
propagates an improved shorter route to later states. Every automatic batch
also retains its concrete MechanicsIR mechanism IDs, so replay can execute the
same terminal-first/automatic-settlement/player-action semantics and verify
each outcome and state hash.

Default marked-item observation uses the draft clue's graph-verified heading
scope as its location. Its target remains a separate semantics field; a target
cannot relocate the default. The default's clue, heading relation, source and
evidence binding, module scope, and target binding must all validate or the
result stays `draft_only`. Explicit discovery substitutes only a default with
the same verified clue and location.

## Hash ownership

- `queueHash` hashes the complete current queue, including answer status and
  resolutions. Its canonical construction is owned by the queue module.
- `mechanicsHash` hashes the compiled executable MechanicsIR.
- State hashes identify normalized closed-world analyzer states and are not
  artifact or queue identities.

## Acceptance evidence and next action

Checkpoint I has focused positive and negative coverage for multi/zero
topology, multi-ending declarations, parent/child discovery, bounded failback,
unlock gating, ending-ID separation, heading-bound default-policy substitution,
automatic conflict/cycle handling, terminal-recovery loops, state-relative
failure-policy risks, and replayable shortest witnesses. The agreed
policy/provenance and process-summary audit is now verified. This is an
uncommitted implementation result, not artifact/public-entry/runtime acceptance.
Repository regression evidence is recorded in the active handoff.

Local P4 verification now includes action-specific replay charging, real
two-state replay cycles with hash deduplication and fresh invocation budgets,
own `__proto__` failure counters, JSON-restored witness replay, and an explicit
special-key resolver-location integration. Four-file regression: 46 pass / 192
assertions. Typecheck exits 0; full tests exit 0 with 3024 pass / 32 intentional
skip / 0 fail, 3056 tests across 214 files. Real production mutations for
action-only undercharging, per-observation overcharging, and unsafe counter
writes each failed the intended regression and were precisely restored.

The final audit validates original defaults completely before substitution,
including original-source symbols rather than replacement-only symbols;
canonical subtree identity, relation and review coverage; retained location
provenance and playable explicit locations; foreign/domain override isolation;
and stable returned provenance snapshots. Script regressions cover exact complete
Bun summaries, decoys/ambiguity, process-before-output verdicts, genuine unset
hooks versus errors, and preservation/separation of handwritten checkpoint text.
Real mutations for every audit family failed their intended assertions and were
restored. Independent follow-up reviews found no remaining issues in this scope.

Final verification: 261 pass / 789 assertions across eight selected files;
typecheck exits 0; full tests exit 0 with 3117 pass / 32 intentional skip / 0 fail,
3149 tests across 215 files. Baseline is reconciled to this successful result.

Next action: report the verified uncommitted Checkpoint-I result. Commit/push
requires user authorization. Further milestones require a new scoped task.
Do not implement Checkpoint II persistence or Checkpoint III's public
entry here; do not start runtime wiring, GameSession/world-model integration,
or later prompt stages without a new scoped task.
