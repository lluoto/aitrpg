import type { MechanicsIR } from "./mechanics-ir";
import {
  applyMechanicsEffects,
  availableMechanicsPlayerActions,
  createMechanicsEdge,
  createMechanicsStateBudget,
  executeMechanicsAction,
  initialMechanicsState,
  mechanicsStateHash,
  matchesMechanicsPredicate,
  MechanicsReachabilityError,
  settleAutomaticMechanics,
  nextAutomaticMechanicsStep,
  validateMechanicsAnalysisInput,
  type MechanicsAnalysisInput,
  type MechanicsOutcome,
  type MechanicsReachabilityEdge,
  type MechanicsState,
} from "./mechanics-execution";

export {
  MechanicsReachabilityError,
  mechanicsStateHash,
  validateMechanicsAnalysisInput,
} from "./mechanics-execution";
export type {
  MechanicsAnalysisInput,
  MechanicsOutcome,
  MechanicsReachabilityEdge,
  MechanicsState,
} from "./mechanics-execution";

export interface MechanicsWitness {
  startSceneId: string;
  steps: MechanicsReachabilityEdge[];
  final: { kind: "clue" | "ending" | "deadlock"; id: string; stateHash: string };
}

export interface MechanicsAnalysisIssue {
  code: "unreachable_core_clue" | "unreachable_ending" | "core_clue_failure_policy_risk" | "closed_world_deadlock";
  id: string;
  witness?: MechanicsWitness;
}

export interface MechanicsReachabilityReport {
  reachableStateCount: number;
  reachableClueIds: string[];
  unreachableCoreClueIds: string[];
  reachableEndingIds: string[];
  unreachableEndingIds: string[];
  selectedTerminalEndingIds: string[];
  endingWitnesses: Record<string, MechanicsWitness>;
  coreClueWitnesses: Record<string, MechanicsWitness>;
  failbackWitnesses: Record<string, MechanicsWitness>;
  deadlockWitnesses: MechanicsWitness[];
  failurePolicyRiskMethodIds: string[];
  failureDeadlockWitnesses: Record<string, MechanicsWitness>;
  edges: MechanicsReachabilityEdge[];
  issues: MechanicsAnalysisIssue[];
  analysisScope: "closed_world";
}

interface SearchNode { state: MechanicsState; hash: string; steps: MechanicsReachabilityEdge[]; }

function hasBoundedRecoveryFromFailure(ir: MechanicsIR, input: MechanicsAnalysisInput, riskyMethodId: string, failedState: MechanicsState): boolean {
  const risky = ir.discoveryMethods.find((method) => method.id === riskyMethodId)!;
  const unsafe = new Set(ir.discoveryMethods.filter((method) => method.check !== undefined && method.check.kind !== "none" && !method.failback).map((method) => method.id));
  const budget = createMechanicsStateBudget(input.maxStates);
  const initial = settleAutomaticMechanics(ir, failedState, budget);
  if (initial.states.some((entry) => entry.state.foundClueIds.includes(risky.clueId))) return true;
  if (initial.state.terminalEndingId) return false;
  type RecoveryOutcome = { kind: "goal" | "loss" } | { kind: "state"; hash: string };
  type RecoveryChoice = { outcomes: RecoveryOutcome[] };
  const states = new Map<string, MechanicsState>([[mechanicsStateHash(initial.state), initial.state]]);
  const choices = new Map<string, RecoveryChoice[]>();
  const queue = [mechanicsStateHash(initial.state)];
  while (queue.length) {
    const hash = queue.shift()!;
    const state = states.get(hash)!;
    const actionGroups = new Map<string, ReturnType<typeof availableMechanicsPlayerActions>>();
    for (const action of availableMechanicsPlayerActions(ir, input, state)) {
      if (unsafe.has(action.mechanismId)) continue;
      const group = actionGroups.get(action.mechanismId) ?? [];
      group.push(action);
      actionGroups.set(action.mechanismId, group);
    }
    const stateChoices: RecoveryChoice[] = [];
    for (const actions of actionGroups.values()) {
      const outcomes: RecoveryOutcome[] = [];
      for (const action of actions) {
        const trace = settleAutomaticMechanics(ir, action.next, budget);
        if (trace.states.some((entry) => entry.state.foundClueIds.includes(risky.clueId))) {
          outcomes.push({ kind: "goal" });
          continue;
        }
        if (trace.state.terminalEndingId) {
          outcomes.push({ kind: "loss" });
          continue;
        }
        const nextHash = mechanicsStateHash(trace.state);
        if (!states.has(nextHash)) {
          states.set(nextHash, trace.state);
          queue.push(nextHash);
        }
        outcomes.push({ kind: "state", hash: nextHash });
      }
      stateChoices.push({ outcomes });
    }
    choices.set(hash, stateChoices);
  }
  const winning = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [hash, stateChoices] of choices) {
      if (winning.has(hash) || !stateChoices.some((choice) => choice.outcomes.every((outcome) => outcome.kind === "goal" || (outcome.kind === "state" && winning.has(outcome.hash))))) continue;
      winning.add(hash);
      changed = true;
    }
  }
  return winning.has(mechanicsStateHash(initial.state));
}

export function analyzeMechanicsReachability(ir: MechanicsIR, input: MechanicsAnalysisInput): MechanicsReachabilityReport {
  validateMechanicsAnalysisInput(ir, input);
  const initial = initialMechanicsState(input);
  const stateBudget = createMechanicsStateBudget(input.maxStates);
  const initialTrace = settleAutomaticMechanics(ir, initial, stateBudget);
  const allEdges: MechanicsReachabilityEdge[] = [...initialTrace.steps];
  const stateNodes = new Map<string, SearchNode>();
  const terminalHashes = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const reachableClues = new Set<string>();
  const reachableEndings = new Set<string>();
  const terminalEndings = new Set<string>();
  const endingWitnesses: Record<string, MechanicsWitness> = Object.create(null) as Record<string, MechanicsWitness>;
  const coreClueWitnesses: Record<string, MechanicsWitness> = Object.create(null) as Record<string, MechanicsWitness>;
  const failbackWitnesses: Record<string, MechanicsWitness> = Object.create(null) as Record<string, MechanicsWitness>;
  const failureTraces: Array<{ mechanismId: string; stateHash: string; steps: MechanicsReachabilityEdge[] }> = [];
  const queue: SearchNode[] = [];
  const shorter = (candidate: MechanicsReachabilityEdge[], current: MechanicsReachabilityEdge[] | undefined): boolean => !current || candidate.length < current.length;
  const recordClues = (state: MechanicsState, steps: MechanicsReachabilityEdge[], hash: string) => {
    for (const clueId of state.foundClueIds) {
      reachableClues.add(clueId);
      if (input.coreClueIds.includes(clueId) && shorter(steps, coreClueWitnesses[clueId]?.steps)) coreClueWitnesses[clueId] = { startSceneId: input.entrySceneId, steps, final: { kind: "clue", id: clueId, stateHash: hash } };
    }
  };
  const recordTraceClues = (trace: ReturnType<typeof settleAutomaticMechanics>, prefix: MechanicsReachabilityEdge[]) => {
    for (const entry of trace.states) recordClues(entry.state, [...prefix, ...trace.steps.slice(0, entry.stepCount)], entry.hash);
  };
  const recordTerminal = (state: MechanicsState, steps: MechanicsReachabilityEdge[]) => {
    const hash = stateBudget.observe(state);
    terminalHashes.add(hash);
    recordClues(state, steps, hash);
    const endingId = state.terminalEndingId!;
    reachableEndings.add(endingId);
    terminalEndings.add(endingId);
    if (shorter(steps, endingWitnesses[endingId]?.steps)) endingWitnesses[endingId] = { startSceneId: input.entrySceneId, steps, final: { kind: "ending", id: endingId, stateHash: hash } };
  };
  const registerStable = (state: MechanicsState, steps: MechanicsReachabilityEdge[]): SearchNode | undefined => {
    if (state.terminalEndingId) { recordTerminal(state, steps); return undefined; }
    const hash = stateBudget.observe(state);
    recordClues(state, steps, hash);
    if (stateNodes.has(hash)) {
      const previous = stateNodes.get(hash);
      if (previous && shorter(steps, previous.steps)) {
        const replacement = { state, hash, steps };
        stateNodes.set(hash, replacement);
        queue.push(replacement);
        return replacement;
      }
      return previous;
    }
    const node = { state, hash, steps };
    stateNodes.set(hash, node);
    adjacency.set(hash, new Set());
    queue.push(node);
    return node;
  };
  recordTraceClues(initialTrace, []);
  registerStable(initialTrace.state, initialTrace.steps);
  const addAction = (node: SearchNode, mechanismId: string, outcome: MechanicsOutcome, next: MechanicsState, sourceInterpretationIds: string[]) => {
    const action = createMechanicsEdge(mechanismId, outcome, node.state, next, sourceInterpretationIds);
    if (action.beforeStateHash === action.afterStateHash) return;
    const actionSteps = [...node.steps, action];
    if (outcome === "failback" && shorter(actionSteps, failbackWitnesses[mechanismId]?.steps)) {
      const discovery = ir.discoveryMethods.find((method) => method.id === mechanismId)!;
      failbackWitnesses[mechanismId] = { startSceneId: input.entrySceneId, steps: actionSteps, final: { kind: "clue", id: discovery.clueId, stateHash: action.afterStateHash } };
    }
    const trace = settleAutomaticMechanics(ir, next, stateBudget);
    const steps = [...actionSteps, ...trace.steps];
    recordTraceClues(trace, actionSteps);
    allEdges.push(action, ...trace.steps);
    const finalHash = mechanicsStateHash(trace.state);
    if (outcome === "failure") failureTraces.push({ mechanismId, stateHash: finalHash, steps });
    if (trace.state.terminalEndingId) {
      if (finalHash !== node.hash) adjacency.get(node.hash)!.add(finalHash);
      recordTerminal(trace.state, steps);
      return;
    }
    if (finalHash === node.hash) return;
    adjacency.get(node.hash)!.add(finalHash);
    registerStable(trace.state, steps);
  };
  while (queue.length) {
    queue.sort((left, right) => left.steps.length - right.steps.length || left.hash.localeCompare(right.hash));
    const node = queue.shift()!;
    if (stateNodes.get(node.hash) !== node) continue;
    for (const action of availableMechanicsPlayerActions(ir, input, node.state)) addAction(node, action.mechanismId, action.outcome, action.next, action.sourceInterpretationIds);
  }
  const reverse = new Map<string, Set<string>>();
  for (const [from, tos] of adjacency) for (const to of tos) { const sources = reverse.get(to) ?? new Set<string>(); sources.add(from); reverse.set(to, sources); }
  const canReachTerminal = new Set<string>(terminalHashes);
  const work = [...terminalHashes];
  while (work.length) {
    const current = work.pop()!;
    for (const predecessor of reverse.get(current) ?? []) if (!canReachTerminal.has(predecessor)) { canReachTerminal.add(predecessor); work.push(predecessor); }
  }
  const deadlockWitnesses = [...stateNodes.values()].filter((node) => !canReachTerminal.has(node.hash)).sort((left, right) => left.steps.length - right.steps.length || left.hash.localeCompare(right.hash)).map((node) => ({ startSceneId: input.entrySceneId, steps: node.steps, final: { kind: "deadlock" as const, id: node.hash, stateHash: node.hash } }));
  const failureDeadlockWitnesses: Record<string, MechanicsWitness> = Object.create(null) as Record<string, MechanicsWitness>;
  for (const trace of failureTraces.filter((entry) => !canReachTerminal.has(entry.stateHash)).sort((left, right) => left.steps.length - right.steps.length || left.stateHash.localeCompare(right.stateHash) || left.mechanismId.localeCompare(right.mechanismId))) {
    if (!Object.hasOwn(failureDeadlockWitnesses, trace.mechanismId)) failureDeadlockWitnesses[trace.mechanismId] = { startSceneId: input.entrySceneId, steps: trace.steps, final: { kind: "deadlock", id: trace.stateHash, stateHash: trace.stateHash } };
  }
  const failurePolicyRiskMethodIds = ir.discoveryMethods
    .filter((method) => input.coreClueIds.includes(method.clueId) && method.check !== undefined && method.check.kind !== "none" && !method.failback)
    .filter((method) => [...stateNodes.values()].some((node) => {
      if (node.state.foundClueIds.includes(method.clueId) || input.discoveryLocations[method.id] !== node.state.currentSceneId || (method.availability && !matchesMechanicsPredicate(method.availability, node.state))) return false;
      return !hasBoundedRecoveryFromFailure(ir, input, method.id, applyMechanicsEffects(node.state, method.onFailure ?? []));
    }))
    .map((method) => method.id)
    .sort();
  const unreachableCoreClueIds = input.coreClueIds.filter((id) => !reachableClues.has(id)).sort();
  const unreachableEndingIds = ir.symbols.endingIds.filter((id) => !reachableEndings.has(id)).sort();
  const issues: MechanicsAnalysisIssue[] = [
    ...unreachableCoreClueIds.map((id) => ({ code: "unreachable_core_clue" as const, id })),
    ...unreachableEndingIds.map((id) => ({ code: "unreachable_ending" as const, id })),
    ...failurePolicyRiskMethodIds.map((id) => ({ code: "core_clue_failure_policy_risk" as const, id })),
    ...deadlockWitnesses.map((entry) => ({ code: "closed_world_deadlock" as const, id: entry.final.stateHash, witness: entry })),
  ];
  return { reachableStateCount: stateBudget.count, reachableClueIds: [...reachableClues].sort(), unreachableCoreClueIds, reachableEndingIds: [...reachableEndings].sort(), unreachableEndingIds, selectedTerminalEndingIds: [...terminalEndings].sort(), endingWitnesses, coreClueWitnesses, failbackWitnesses, deadlockWitnesses, failurePolicyRiskMethodIds, failureDeadlockWitnesses, edges: allEdges, issues, analysisScope: "closed_world" };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }

function assertReplayStep(actual: MechanicsReachabilityEdge, expected: MechanicsReachabilityEdge): void {
  if (actual.mechanismId !== expected.mechanismId || !sameStrings(actual.mechanismIds, expected.mechanismIds) || actual.outcome !== expected.outcome) throw new MechanicsReachabilityError("invalid_witness_step", "witness mechanism or outcome is not executable from this state");
  if (actual.beforeStateHash !== expected.beforeStateHash || actual.afterStateHash !== expected.afterStateHash) throw new MechanicsReachabilityError("invalid_witness_hash", "witness state hash does not match execution");
}

export function replayMechanicsWitness(ir: MechanicsIR, input: MechanicsAnalysisInput, witness: MechanicsWitness): MechanicsState {
  validateMechanicsAnalysisInput(ir, input);
  if (witness.startSceneId !== input.entrySceneId) throw new MechanicsReachabilityError("invalid_witness_start", "witness start scene does not match analysis input");
  let state = initialMechanicsState(input);
  const budget = createMechanicsStateBudget(input.maxStates);
  budget.observe(state);
  for (const step of witness.steps) {
    if (step.beforeStateHash !== mechanicsStateHash(state)) throw new MechanicsReachabilityError("invalid_witness_hash", "witness before-state hash does not match execution");
    if (state.terminalEndingId) throw new MechanicsReachabilityError("invalid_witness_step", "witness continues after terminal ending");
    const automatic = nextAutomaticMechanicsStep(ir, state);
    if (step.outcome === "transition" || step.outcome === "ending") {
      if (!automatic) throw new MechanicsReachabilityError("invalid_witness_step", "witness names an unavailable automatic mechanism");
      assertReplayStep(step, automatic.step);
      state = automatic.state;
      budget.observe(state);
      continue;
    }
    if (automatic) throw new MechanicsReachabilityError("invalid_witness_step", "optional action was attempted before automatic settlement");
    let executed;
    try {
      executed = executeMechanicsAction(ir, input, state, step as { mechanismId: string; outcome: "success" | "failure" | "failback" | "traverse" });
    } catch (error) {
      if (!(error instanceof MechanicsReachabilityError)) throw error;
      throw new MechanicsReachabilityError("invalid_witness_step", "witness action is unavailable from this state");
    }
    assertReplayStep(step, executed.edge);
    state = executed.state;
    budget.observe(state);
  }
  if (mechanicsStateHash(state) !== witness.final.stateHash) throw new MechanicsReachabilityError("invalid_witness_hash", "witness final state hash does not match execution");
  if (witness.final.kind === "clue" && !state.foundClueIds.includes(witness.final.id)) throw new MechanicsReachabilityError("invalid_witness_goal", "witness did not discover its declared clue");
  if (witness.final.kind === "ending" && state.terminalEndingId !== witness.final.id) throw new MechanicsReachabilityError("invalid_witness_goal", "witness did not reach its declared ending");
  if (witness.final.kind === "deadlock" && state.terminalEndingId) throw new MechanicsReachabilityError("invalid_witness_goal", "deadlock witness reached an ending");
  return state;
}
