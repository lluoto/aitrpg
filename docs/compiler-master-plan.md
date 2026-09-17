# Compiler Master Plan

This is the control plan for the evidence-bound module compiler. It describes
the current implementation boundary, not a new public compile entry point.

## Milestones

| Milestone | Status | Verified result |
| --- | --- | --- |
| Source structure through draft and question queue | complete | DocumentIR evidence, SourceFactGraph, deterministic marked-item draft, and evidence-bound questions remain separate from runtime module loading. |
| Checkpoint I: hints through closed-world analysis and P4 execution semantics | committed and pushed | The A/B/C delivery stack ending at `5095efe` is on `origin/master`. |
| Diagnostics process simulation | complete | Diagnostics retain private `WeakMap` lineage; detached process bundles still fail closed. |
| Checkpoint II: local artifact persistence | committed and pushed | Versioned JSON-safe prepared/resolved envelopes regenerate and compare compiler state on restore, use a distinct canonical artifact identity, and save atomically. |
| Checkpoint III: public compiler entry end-to-end validation | committed and pushed | Typed synthetic-pages and PDF-bytes preparation share the DocumentIR-to-artifact chain; resolve validates a restored prepared artifact before returning durable mechanically closed output. |
| ModuleData presentation projection | implemented, uncommitted | Complete resolved artifacts project source-backed presentation data with explicit caller metadata, artifact/mechanics identities, and a separate evidence map. It is not runtime loading. |
| Later milestone: runtime consumption | out of scope | GameSession, world-model/model-memory integration, and runtime consumers come after compiler artifacts and public-entry validation. |

## Checkpoint I contract

- A topology answer belongs to its source-scene question. It declares
  `connections[]`; an empty array is an explicit zero-outgoing declaration.
  Connection IDs are declarations and must be unique across the resolved set.
- An ending answer contains one or more declarations. Each declaration has a
  mechanism-rule ID that differs from its exactly one `end_game.endingId`.
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

The diagnostics process simulation keeps source graph, queue, mechanics and
state hashes under their existing owners. It revalidates snapshots at prepare,
questions, hints, resolve and execute boundaries, and accepts only a caller
prescribed mechanism/outcome script. Replay is a postcondition over the produced
trace, not a substitute for the script. Missing, stale, mismatched or
non-closed stages return a structured refusal. This slice deliberately excludes
artifact persistence, public APIs, real PDF ingestion, ModuleData, GameSession,
items, NPCs, combat, rewards, rulesets, narration, LLM and world-model support.

Hardening keeps direct actions behind terminal/automatic settlement, hides mutable
state-budget hashes, and copies outgoing provenance. Before execution, the
diagnostics bundle re-runs resolve against retained graph, draft, queue and hints
and compares the complete resolved queue, IR, analysis input and report. Test
preload assigns missing per-process world-model paths by default; real model
loading requires explicit `ALLOW_TEST_WORLD_MODEL=1` and remains untested here.
The default paths include a per-process UUID so stale files or PID reuse cannot
silently re-enable workstation-local model loading.

Final diagnostics closeout evidence: plain `bun test` exits 0 with 3147 pass /
32 intentional skip / 0 fail, 3179 tests across 216 files; plain preflight
exits 0. The replay postcondition is directly tested, and explicit network
opt-in causes all network-test probes to skip fetch calls.
This is a test-isolation result, not evidence that a real world-model runtime,
artifact persistence, public compiler entry, ModuleData projection, or
GameSession integration has been accepted.

Checkpoint I has focused positive and negative coverage for multi/zero
topology, multi-ending declarations, parent/child discovery, bounded failback,
unlock gating, ending-ID separation, heading-bound default-policy substitution,
automatic conflict/cycle handling, terminal-recovery loops, state-relative
failure-policy risks, and replayable shortest witnesses. The agreed
policy/provenance and process-summary audit is now verified. `bb42ef4` is
pushed; Group A (`906ef06`) and Group B (`1fea0b4`) are committed locally.
The delivery stack is pushed. Checkpoint II accepts durable artifact validation.
Checkpoint III accepts source-to-artifact compilation only. ModuleData projection
now accepts presentation-only output; neither is runtime acceptance.
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

Final compiler verification: 261 pass / 789 assertions across eight selected
files; typecheck exits 0; full tests exit 0 with 3117 pass / 32 intentional skip
/ 0 fail, 3149 tests across 215 files. A follow-up delivery-record run exits 0
with 3119 pass / 32 intentional skip / 0 fail, 3151 tests across 215 files.
The active baseline records tests/files/pass/skip so equal totals cannot conceal
pass-to-skip regressions. A follow-up parser guard rejects equal ending mechanism
and ending IDs; that historical full run was 3120 pass / 32 skip / 0 fail,
3152/215. The current final diagnostics result is recorded above.

Checkpoint II artifact evidence: prepared and resolved envelopes retain source
graph/draft/queue identities, accepted interpretations, hints, MechanicsIR,
analysis input, and reports. Restore validates component versions and an
artifact-specific canonical hash, regenerates deterministic queues and complete
resolution, and requires a mechanically closed terminal report. File storage
writes a flushed sibling temporary file before replacing the target. Diagnostics
lineage remains private and unchanged.

Checkpoint III API evidence: synthetic pages and original PDF bytes share one
DocumentIR-to-artifact preparation core. Resolve restores the prepared envelope
before binding caller hints to module, document, graph and queue identities; only
a mechanically closed result publishes a resolved artifact. It adds no HTTP,
CLI, filesystem-path, ModuleData, or runtime entry point.

ModuleData projection evidence: the adapter validates the complete resolved
artifact before projecting graph-verified playable scenes, source-exact clue
name/body fields, declared topology and ending IDs. Required legacy presentation
fields come only from exact caller metadata and the wrapper keeps artifact,
mechanics and evidence mappings separate from `ModuleData.provenance`.

Next action: commit the verified ModuleData projection after explicit authorization, then begin the separately scoped GameSession integration task. Real world-model loading remains intentionally unverified.
