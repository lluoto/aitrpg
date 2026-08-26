# Numeric Domains for `applyAction`

## Decision

Extend the existing `StateVariableSpec` with a tagged `domain` union. Do not
add a parallel numeric-variable hierarchy: every variable still has one id,
one initial value, and a transition check; only the valid-value predicate
differs.

```ts
type StateDomain =
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "integer"; readonly min: number; readonly max: number };

type ProposedEffect =
  | { readonly variable: string; readonly to: string }
  | { readonly variable: string; readonly to: number };
```

`StateVariableSpec.initial`, `GateState.variables`, `VariableChange`, and
`TransitionSpec` must become the same value union (`string | number`) in that
change. `applyAction()` must narrow by `domain.kind`, reject mismatched value
types, and keep `StateDelta` immutable.

## Why This Shape

- The tagged union makes enum and integer validation exhaustive at compile
  time. `string | number` alone would allow the wrong type to drift into a
  domain without a branch proving it was checked.
- Integer HP/SAN bounds belong in the scenario declaration rather than inside
  each HTTP handler, so KP, LLM proposals, and rules all receive the same
  rejection reason.
- A parallel `NumericVariableSpec` duplicates ids, initial values, delta
  projection, and transition plumbing. It creates two call paths for every
  future caller while adding no semantic distinction beyond domain validation.

## Rejections

Use one structured code instead of separate below-min/above-max codes:

```ts
{ code: "value_out_of_domain", variable, to, domain }
```

For an integer domain, `domain` carries `{ kind: "integer", min, max }`.
This covers non-number, non-integer, below-min, and above-max without making
HTTP callers branch on four error kinds. The human-facing layer can format the
actual attempted value and bounds.

## Mutators Unblocked

| Mutator | Domain / operation |
| --- | --- |
| `setPlayerHp(pid, value)` | integer `0..maxHp` |
| `setPlayerSan(pid, value)` | integer `0..maxSAN` |
| `applyDamage(entityId, damage)` | arithmetic delta projected to HP, then checked |

The current `GameSession` does not expose dedicated setters for luck, MP, or
credit rating. If added later, luck and MP use the same bounded-integer model;
credit rating is also an integer range. Inventory, weapons, armor, and scene
selection remain different work: they are open collections or dynamically
registered identifiers, not numeric domains.

## Sequencing — done

> This section originally said `setPlayerHp`, `setPlayerSan`, and `applyDamage`
> still bypass the gate and described the numeric-domain work as "the next
> slice." That was true when this doc was written but is stale now: all three
> are wired. `StateDomain` (the tagged union above) lives in `apply-action.ts`
> (around lines 42-44); `game-session.ts` calls the gate at the three sites
> for `setPlayerHp`, `setPlayerSan`, and `applyDamage` (around lines 894, 917,
> 991). `apply-action.ts`'s own header comment was corrected for this in
> commit `02485f9` — this doc was the one file that didn't get updated
> alongside it.

`setDifficulty` was the enum pilot (Phase 3.1); the integer domain above
followed the same shape once it landed.
