# Mechanics Reachability Boundaries

Mechanics reachability analyzes a closed, declared MechanicsIR state model. It
does not model free narration, undeclared actions, or any candidate that was
not compiled into MechanicsIR. An `unreachable` result means the current
declared mechanism graph has no path; it does not claim that source prose has
no solution.

The analysis input explicitly supplies the entry scene, discovery locations,
action or from source text. Missing or dangling locations, connections, symbols,

States normalize all sets and maps before hashing. BFS explores only edges that
change the closed state, bounds checked-method failures at the declared
failback threshold, and fails with `state_limit_exceeded` rather than silently
truncating. Terminal selection evaluates matching ending rules by ascending
priority.

Each reported core clue, failback, ending, or closed-world deadlock has a
shortest witness composed of declared mechanism IDs, outcomes, and state
changes. These witnesses are graph evidence, not player natural-language run
evidence. P5 may later apply deterministic templates to real module input; P4
does not modify ModuleData or runtime behavior.
