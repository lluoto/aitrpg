# Compilation Authority Contract

`src/compiler/` defines pure compiler inputs and candidate resolution. It does
not import datasets, source-bound artifacts, world-model runtime code, or
`ModuleData` loaders.

## Evidence

`FieldEvidence` records why a candidate can be considered. `ClaimCandidate`
adds a path, value, domain, and scope. Authority and derivation are independent:
authority ranks a source; derivation records whether the value was explicit,
inferred, defaulted, or unknown. Confidence is optional metadata and never
changes authority order.

Existing `Provenance` remains ingest rewrite history. It is not FieldEvidence.
Latent candidates require `sourceRef: null` and `rightsStatus: "unknown"`.

## Scope

`CompilationManifest` is compiler input, not module plot data. It records the
module/ruleset identity, work scope, transfer policy, mode, compiler version,
and artifact hashes. An empty `allowedWorkIds` fails closed. Cross-work queries
require an explicit corpus scope and `analogy_only` policy.

Transfer policies are constrained as follows:

- `canon_fill`: declared corpus candidates must be entity-general or world-law.
- `mechanic_only`: cannot supply plot facts.
- `analogy_only`: cannot auto-accept a candidate.
- `no_transfer`: rejects world candidates.

## Resolution

`resolveCandidates()` uses domain-specific priorities, rejects out-of-scope
inputs, and reports same-precedence disagreement as `conflicted`. The result
retains accepted, rejected, and conflicted candidates with reasons; only its
`accepted` result may supply a runtime value.

The four ordered domains are plot facts, rule numbers, behavior priors, and
gameplay mechanics. Full tables live in `src/compiler/candidate-resolution.ts`.

## Runtime Boundary

The Barn Mi-Go encounter demonstrates module authority: module runtime HP 11,
maxHP 11, and AC 10 override generic catalogue values 12, 12, and 14.
Name, faction, and attributes also come from the module snapshot. WorldEntity
does not persist skills, abilities, or tactics, so this registration path does
not merge generic values into them.

No source-bound artifact consumer exists yet. A later compiler wiring task must
load artifact candidates/evidence lazily, construct a CompilationManifest, and
pass only resolved outputs to an explicit compilation boundary.
