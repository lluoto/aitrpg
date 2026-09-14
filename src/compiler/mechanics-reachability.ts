import { validateMechanicsIR, type Effect, type MechanicsIR, type Predicate, type Scalar } from "./mechanics-ir";

export interface MechanicsAnalysisInput {
  entrySceneId: string;
  initialState: { foundClueIds: string[]; visitedSceneIds: string[]; ownedItemIds: string[]; stateValues: Record<string, Scalar>; npcStates: Record<string, string> };
  coreClueIds: string[];
  connections: Array<{ id: string; fromSceneId: string; toSceneId: string }>;
  discoveryLocations: Record<string, string>;
  maxStates: number;
}

export interface MechanicsState {
  currentSceneId: string;
  foundClueIds: string[];
  visitedSceneIds: string[];
  ownedItemIds: string[];
  stateValues: Record<string, Scalar>;
  npcStates: Record<string, string>;
  unlockedConnectionIds: string[];
  failureCounts: Record<string, number>;
  startedEncounterIds: string[];
  rewardIds: string[];
  terminalEndingId?: string;
}

export type MechanicsOutcome = "success" | "failure" | "failback" | "traverse" | "transition" | "ending";

export interface MechanicsReachabilityEdge {
  /** Display ID for a single mechanism or an atomic compatible automatic batch. */
  mechanismId: string;
  /** Concrete MechanicsIR mechanism IDs executed by this step. */
  mechanismIds: string[];
  outcome: MechanicsOutcome;
  beforeStateHash: string;
  afterStateHash: string;
  sourceInterpretationIds: string[];
  summary: string;
}

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
  /** States with no path to a declared terminal, including closed cycles. */
  deadlockWitnesses: MechanicsWitness[];
  /** A boundedness policy risk, not a proof of an unrecoverable state. */
  failurePolicyRiskMethodIds: string[];
  /** Actual deadlock witnesses immediately reached by a failed method. */
  failureDeadlockWitnesses: Record<string, MechanicsWitness>;
  edges: MechanicsReachabilityEdge[];
  issues: MechanicsAnalysisIssue[];
  analysisScope: "closed_world";
}

export class MechanicsReachabilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MechanicsReachabilityError";
  }
}

interface SearchNode { state: MechanicsState; hash: string; steps: MechanicsReachabilityEdge[]; }
interface ClosureTraceState { state: MechanicsState; hash: string; stepCount: number; }
interface ClosureTrace { state: MechanicsState; steps: MechanicsReachabilityEdge[]; states: ClosureTraceState[]; }
interface PlayerAction { mechanismId: string; outcome: MechanicsOutcome; next: MechanicsState; sourceInterpretationIds: string[]; }
interface StateBudgetObserver { hashes: Set<string>; observe(state: MechanicsState): string; }

const scalar = (value: unknown): value is Scalar => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sorted(values: Iterable<string>): string[] { return [...new Set(values)].sort(); }
function sortedRecord<T>(record: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))); }

function normalizeState(state: MechanicsState): MechanicsState {
  return {
    currentSceneId: state.currentSceneId,
    foundClueIds: sorted(state.foundClueIds),
    visitedSceneIds: sorted(state.visitedSceneIds),
    ownedItemIds: sorted(state.ownedItemIds),
    stateValues: sortedRecord(state.stateValues),
    npcStates: sortedRecord(state.npcStates),
    unlockedConnectionIds: sorted(state.unlockedConnectionIds),
    failureCounts: sortedRecord(state.failureCounts),
    startedEncounterIds: sorted(state.startedEncounterIds),
    rewardIds: sorted(state.rewardIds),
    ...(state.terminalEndingId ? { terminalEndingId: state.terminalEndingId } : {}),
  };
}

export function mechanicsStateHash(state: MechanicsState): string { return canonical(normalizeState(state)); }
function requireKnown(id: string, values: readonly string[], label: string): void { if (!values.includes(id)) throw new MechanicsReachabilityError("unknown_symbol", `unknown ${label}: ${id}`); }
function requireUnique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new MechanicsReachabilityError("duplicate_input", `duplicate ${label}`); }

function createStateBudget(maxStates: number): StateBudgetObserver {
  const hashes = new Set<string>();
  return {
    hashes,
    observe(state) {
      const hash = mechanicsStateHash(state);
      if (!hashes.has(hash)) {
        if (hashes.size >= maxStates) throw new MechanicsReachabilityError("state_limit_exceeded", `state limit exceeded: ${maxStates}`);
        hashes.add(hash);
      }
      return hash;
    },
  };
}

function validateInitialState(ir: MechanicsIR, input: MechanicsAnalysisInput): void {
  const initial = input.initialState;
  const listChecks: Array<[string[], string[], string]> = [
    [initial.foundClueIds, ir.symbols.clueIds, "initial clue"],
    [initial.visitedSceneIds, ir.symbols.sceneIds, "initial scene"],
    [initial.ownedItemIds, ir.symbols.itemIds, "initial item"],
    [input.coreClueIds, ir.symbols.clueIds, "core clue"],
  ];
  for (const [ids, symbols, label] of listChecks) { requireUnique(ids, label); ids.forEach((id) => requireKnown(id, symbols, label)); }
  for (const [key, value] of Object.entries(initial.stateValues)) {
    requireKnown(key, ir.symbols.declaredStateKeys, "state key");
    if (!scalar(value)) throw new MechanicsReachabilityError("invalid_initial_state", `invalid state value: ${key}`);
  }
  for (const [npcId, state] of Object.entries(initial.npcStates)) {
    requireKnown(npcId, ir.symbols.npcIds, "npc");
    if (!state.trim()) throw new MechanicsReachabilityError("invalid_initial_state", `invalid NPC state: ${npcId}`);
  }
}

export function validateMechanicsAnalysisInput(ir: MechanicsIR, input: MechanicsAnalysisInput): void {
  validateMechanicsIR(ir);
  if (!Number.isInteger(input.maxStates) || input.maxStates < 1) throw new MechanicsReachabilityError("invalid_max_states", "maxStates must be a positive integer");
  requireKnown(input.entrySceneId, ir.symbols.sceneIds, "entry scene");
  validateInitialState(ir, input);
  const connectionIds = input.connections.map((connection) => connection.id);
  requireUnique(connectionIds, "connection input");
  for (const connection of input.connections) {
    requireKnown(connection.id, ir.symbols.connectionIds, "connection");
    requireKnown(connection.fromSceneId, ir.symbols.sceneIds, "connection source scene");
    requireKnown(connection.toSceneId, ir.symbols.sceneIds, "connection target scene");
  }
  for (const gate of ir.connections) if (!input.connections.some((connection) => connection.id === gate.connectionId)) throw new MechanicsReachabilityError("missing_connection", `connection target is missing: ${gate.connectionId}`);
  const locations = Object.keys(input.discoveryLocations);
  requireUnique(locations, "discovery location");
  for (const discovery of ir.discoveryMethods) {
    const sceneId = input.discoveryLocations[discovery.id];
    if (!sceneId) throw new MechanicsReachabilityError("missing_discovery_location", `discovery location is missing: ${discovery.id}`);
    requireKnown(sceneId, ir.symbols.sceneIds, "discovery location scene");
  }
  for (const discoveryId of locations) if (!ir.discoveryMethods.some((discovery) => discovery.id === discoveryId)) throw new MechanicsReachabilityError("unknown_discovery_location", `unknown discovery location: ${discoveryId}`);
  for (const discovery of ir.discoveryMethods) if (discovery.failback && !discovery.failback.effects.some((effect) => effect.kind === "discover_clue" && effect.clueId === discovery.clueId)) throw new MechanicsReachabilityError("invalid_failback", `failback does not discover method clue: ${discovery.id}`);
}

function matches(predicate: Predicate, state: MechanicsState): boolean {
  switch (predicate.kind) {
    case "all": return predicate.predicates.every((entry) => matches(entry, state));
    case "any": return predicate.predicates.some((entry) => matches(entry, state));
    case "not": return !matches(predicate.predicate, state);
    case "clue_found": return state.foundClueIds.includes(predicate.clueId);
    case "scene_visited": return state.visitedSceneIds.includes(predicate.sceneId);
    case "item_owned": return state.ownedItemIds.includes(predicate.itemId);
    case "connection_unlocked": return state.unlockedConnectionIds.includes(predicate.connectionId);
    case "state_eq": return canonical(state.stateValues[predicate.stateKey]) === canonical(predicate.value);
    case "npc_state": return state.npcStates[predicate.npcId] === predicate.state;
  }
}

function applyEffects(state: MechanicsState, effects: readonly Effect[]): MechanicsState {
  const next: MechanicsState = structuredClone(state);
  for (const effect of effects) {
    switch (effect.kind) {
      case "discover_clue": next.foundClueIds = sorted([...next.foundClueIds, effect.clueId]); break;
      case "set_state": next.stateValues[effect.stateKey] = effect.value; break;
      case "unlock_connection": next.unlockedConnectionIds = sorted([...next.unlockedConnectionIds, effect.connectionId]); break;
      case "start_encounter": next.startedEncounterIds = sorted([...next.startedEncounterIds, effect.encounterId]); break;
      case "reward": next.rewardIds = sorted([...next.rewardIds, effect.rewardId]); break;
      case "end_game": next.terminalEndingId = effect.endingId; break;
    }
  }
  return normalizeState(next);
}

function summary(before: MechanicsState, after: MechanicsState): string {
  const changes: string[] = [];
  if (before.currentSceneId !== after.currentSceneId) changes.push(`scene:${before.currentSceneId}->${after.currentSceneId}`);
  const added = (beforeValues: string[], afterValues: string[], label: string) => {
    const values = afterValues.filter((value) => !beforeValues.includes(value));
    if (values.length) changes.push(`${label}:${values.join(",")}`);
  };
  added(before.foundClueIds, after.foundClueIds, "clue");
  added(before.unlockedConnectionIds, after.unlockedConnectionIds, "unlock");
  added(before.startedEncounterIds, after.startedEncounterIds, "encounter");
  added(before.rewardIds, after.rewardIds, "reward");
  for (const [key, value] of Object.entries(after.stateValues)) if (canonical(before.stateValues[key]) !== canonical(value)) changes.push(`state:${key}=${canonical(value)}`);
  for (const [key, value] of Object.entries(after.failureCounts)) if (before.failureCounts[key] !== value) changes.push(`failures:${key}=${value}`);
  if (before.terminalEndingId !== after.terminalEndingId && after.terminalEndingId) changes.push(`ending:${after.terminalEndingId}`);
  return changes.join("; ") || "no state change";
}

function edge(mechanismId: string, outcome: MechanicsOutcome, before: MechanicsState, after: MechanicsState, sourceInterpretationIds: string[], mechanismIds: string[] = [mechanismId]): MechanicsReachabilityEdge {
  return { mechanismId, mechanismIds: sorted(mechanismIds), outcome, beforeStateHash: mechanicsStateHash(before), afterStateHash: mechanicsStateHash(after), sourceInterpretationIds: sorted(sourceInterpretationIds), summary: summary(before, after) };
}

function checked(discovery: MechanicsIR["discoveryMethods"][number]): boolean { return discovery.check !== undefined && discovery.check.kind !== "none"; }

function validateCompatibleAutomaticEffects(transitions: MechanicsIR["transitions"]): void {
  const writes = new Map<string, string>();
  const endingIds = new Set<string>();
  for (const transition of transitions) for (const effect of transition.effects) {
    if (effect.kind === "set_state") {
      const value = canonical(effect.value);
      const previous = writes.get(effect.stateKey);
      if (previous !== undefined && previous !== value) throw new MechanicsReachabilityError("automatic_transition_conflict", `automatic transitions disagree on ${effect.stateKey}`);
      writes.set(effect.stateKey, value);
    }
    if (effect.kind === "end_game") endingIds.add(effect.endingId);
  }
  if (endingIds.size > 1) throw new MechanicsReachabilityError("automatic_transition_conflict", "automatic transitions select different endings");
}

function automaticBatchId(ids: readonly string[]): string { return ids.length === 1 ? ids[0]! : `automatic:${[...ids].sort().join("+")}`; }

/** Executes exactly one terminal-first automatic step; compatible transitions are one atomic batch. */
function nextAutomaticStep(ir: MechanicsIR, state: MechanicsState): { state: MechanicsState; step: MechanicsReachabilityEdge } | undefined {
  if (state.terminalEndingId) return undefined;
  const selectedEnding = ir.endings.filter((ending) => matches(ending.when, state)).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
  if (selectedEnding) {
    const terminal = applyEffects(state, selectedEnding.effects);
    if (!terminal.terminalEndingId) throw new MechanicsReachabilityError("invalid_terminal", `ending rule did not produce end_game: ${selectedEnding.id}`);
    return { state: terminal, step: edge(selectedEnding.id, "ending", state, terminal, selectedEnding.sourceInterpretationIds) };
  }
  const transitions = ir.transitions.filter((transition) => matches(transition.when, state));
  if (transitions.length === 0) return undefined;
  validateCompatibleAutomaticEffects(transitions);
  const next = applyEffects(state, transitions.flatMap((transition) => transition.effects));
  if (mechanicsStateHash(next) === mechanicsStateHash(state)) return undefined; // level-triggered fixed point
  const ids = transitions.map((transition) => transition.id).sort();
  return { state: next, step: edge(automaticBatchId(ids), "transition", state, next, transitions.flatMap((transition) => transition.sourceInterpretationIds), ids) };
}

/** Terminal rules run first; compatible automatic transitions settle before one optional player action. */
function settleAutomatic(ir: MechanicsIR, initial: MechanicsState, budget?: StateBudgetObserver): ClosureTrace {
  let state = normalizeState(initial);
  const steps: MechanicsReachabilityEdge[] = [];
  const hash = budget?.observe(state) ?? mechanicsStateHash(state);
  const states: ClosureTraceState[] = [{ state, hash, stepCount: 0 }];
  const closureHashes = new Set<string>([hash]);
  while (true) {
    const automatic = nextAutomaticStep(ir, state);
    if (!automatic) break;
    const afterHash = budget?.observe(automatic.state) ?? mechanicsStateHash(automatic.state);
    if (closureHashes.has(afterHash)) throw new MechanicsReachabilityError("automatic_transition_cycle", "automatic transitions form a closed state cycle");
    closureHashes.add(afterHash);
    steps.push(automatic.step);
    state = automatic.state;
    states.push({ state, hash: afterHash, stepCount: steps.length });
    if (state.terminalEndingId) break;
  }
  return { state, steps, states };
}

/** Shared optional-action semantics for graph search, failure-policy recovery, and witness replay. */
function playerActions(ir: MechanicsIR, input: MechanicsAnalysisInput, state: MechanicsState): PlayerAction[] {
  if (state.terminalEndingId) return [];
  const actions: PlayerAction[] = [];
  for (const discovery of ir.discoveryMethods) {
    if (state.foundClueIds.includes(discovery.clueId)) continue;
    if (input.discoveryLocations[discovery.id] !== state.currentSceneId || (discovery.availability && !matches(discovery.availability, state))) continue;
    actions.push({ mechanismId: discovery.id, outcome: "success", next: applyEffects(state, discovery.onSuccess), sourceInterpretationIds: discovery.sourceInterpretationIds });
    if (!checked(discovery)) continue;
    const count = Object.hasOwn(state.failureCounts, discovery.id) ? state.failureCounts[discovery.id]! : 0;
    if (discovery.failback && count >= discovery.failback.maxFailures) actions.push({ mechanismId: discovery.id, outcome: "failback", next: applyEffects(state, discovery.failback.effects), sourceInterpretationIds: discovery.sourceInterpretationIds });
    else {
      const failed = applyEffects(state, discovery.onFailure ?? []);
      if (discovery.failback) Object.defineProperty(failed.failureCounts, discovery.id, {
        value: Math.min(count + 1, discovery.failback.maxFailures), enumerable: true, writable: true, configurable: true,
      });
      actions.push({ mechanismId: discovery.id, outcome: "failure", next: normalizeState(failed), sourceInterpretationIds: discovery.sourceInterpretationIds });
    }
  }
  for (const gate of ir.connections) {
    const connection = input.connections.find((entry) => entry.id === gate.connectionId)!;
    if (connection.fromSceneId !== state.currentSceneId || (gate.availability && !matches(gate.availability, state))) continue;
    const traversed = applyEffects(state, gate.onTraverse ?? []);
    traversed.currentSceneId = connection.toSceneId;
    traversed.visitedSceneIds = sorted([...traversed.visitedSceneIds, connection.toSceneId]);
    actions.push({ mechanismId: gate.id, outcome: "traverse", next: normalizeState(traversed), sourceInterpretationIds: gate.sourceInterpretationIds });
  }
  return actions;
}

function initialMechanicsState(input: MechanicsAnalysisInput): MechanicsState {
  return normalizeState({ currentSceneId: input.entrySceneId, foundClueIds: input.initialState.foundClueIds, visitedSceneIds: [...input.initialState.visitedSceneIds, input.entrySceneId], ownedItemIds: input.initialState.ownedItemIds, stateValues: input.initialState.stateValues, npcStates: input.initialState.npcStates, unlockedConnectionIds: [], failureCounts: {}, startedEncounterIds: [], rewardIds: [] });
}

/**
 * A no-failback checked core method is safe only when, after its concrete
 * failure state, a deterministic or bounded alternative for the same clue is
 * reachable without relying on another unbounded check. This deliberately
 * models recovery, not merely a successful branch elsewhere in the graph.
 */
function hasBoundedRecoveryFromFailure(ir: MechanicsIR, input: MechanicsAnalysisInput, riskyMethodId: string, failedState: MechanicsState): boolean {
  const risky = ir.discoveryMethods.find((method) => method.id === riskyMethodId)!;
  const unsafe = new Set(ir.discoveryMethods.filter((method) => checked(method) && !method.failback).map((method) => method.id));
  const budget = createStateBudget(input.maxStates);
  const initial = settleAutomatic(ir, failedState, budget);
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
    const actionGroups = new Map<string, PlayerAction[]>();
    for (const action of playerActions(ir, input, state)) {
      if (unsafe.has(action.mechanismId)) continue;
      const group = actionGroups.get(action.mechanismId) ?? [];
      group.push(action);
      actionGroups.set(action.mechanismId, group);
    }
    const stateChoices: RecoveryChoice[] = [];
    for (const actions of actionGroups.values()) {
      const outcomes: RecoveryOutcome[] = [];
      for (const action of actions) {
        const trace = settleAutomatic(ir, action.next, budget);
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
  const stateBudget = createStateBudget(input.maxStates);
  const initialTrace = settleAutomatic(ir, initial, stateBudget);
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
  const recordTraceClues = (trace: ClosureTrace, prefix: MechanicsReachabilityEdge[]) => {
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
    const action = edge(mechanismId, outcome, node.state, next, sourceInterpretationIds);
    const actionChanged = action.beforeStateHash !== action.afterStateHash;
    if (!actionChanged) return;
    const actionSteps = [...node.steps, ...(actionChanged ? [action] : [])];
    if (outcome === "failback" && shorter(actionSteps, failbackWitnesses[mechanismId]?.steps)) {
      const discovery = ir.discoveryMethods.find((method) => method.id === mechanismId)!;
      failbackWitnesses[mechanismId] = { startSceneId: input.entrySceneId, steps: actionSteps, final: { kind: "clue", id: discovery.clueId, stateHash: action.afterStateHash } };
    }
    const trace = settleAutomatic(ir, next, stateBudget);
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
    const state = node.state;
    for (const action of playerActions(ir, input, state)) addAction(node, action.mechanismId, action.outcome, action.next, action.sourceInterpretationIds);
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
    .filter((method) => input.coreClueIds.includes(method.clueId) && checked(method) && !method.failback)
    .filter((method) => [...stateNodes.values()].some((node) => {
      if (node.state.foundClueIds.includes(method.clueId) || input.discoveryLocations[method.id] !== node.state.currentSceneId || (method.availability && !matches(method.availability, node.state))) return false;
      const failed = applyEffects(node.state, method.onFailure ?? []);
      return !hasBoundedRecoveryFromFailure(ir, input, method.id, failed);
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
  return { reachableStateCount: stateBudget.hashes.size, reachableClueIds: [...reachableClues].sort(), unreachableCoreClueIds, reachableEndingIds: [...reachableEndings].sort(), unreachableEndingIds, selectedTerminalEndingIds: [...terminalEndings].sort(), endingWitnesses, coreClueWitnesses, failbackWitnesses, deadlockWitnesses, failurePolicyRiskMethodIds, failureDeadlockWitnesses, edges: allEdges, issues, analysisScope: "closed_world" };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }

function assertReplayStep(actual: MechanicsReachabilityEdge, expected: MechanicsReachabilityEdge): void {
  if (actual.mechanismId !== expected.mechanismId || !sameStrings(actual.mechanismIds, expected.mechanismIds) || actual.outcome !== expected.outcome) throw new MechanicsReachabilityError("invalid_witness_step", "witness mechanism or outcome is not executable from this state");
  if (actual.beforeStateHash !== expected.beforeStateHash || actual.afterStateHash !== expected.afterStateHash) throw new MechanicsReachabilityError("invalid_witness_hash", "witness state hash does not match execution");
}

/** Replays a reported witness with the same terminal-first and automatic-settlement semantics as analysis. */
export function replayMechanicsWitness(ir: MechanicsIR, input: MechanicsAnalysisInput, witness: MechanicsWitness): MechanicsState {
  validateMechanicsAnalysisInput(ir, input);
  if (witness.startSceneId !== input.entrySceneId) throw new MechanicsReachabilityError("invalid_witness_start", "witness start scene does not match analysis input");
  let state = initialMechanicsState(input);
  const budget = createStateBudget(input.maxStates);
  budget.observe(state);
  for (const step of witness.steps) {
    if (step.beforeStateHash !== mechanicsStateHash(state)) throw new MechanicsReachabilityError("invalid_witness_hash", "witness before-state hash does not match execution");
    if (state.terminalEndingId) throw new MechanicsReachabilityError("invalid_witness_step", "witness continues after terminal ending");
    const automatic = nextAutomaticStep(ir, state);
    if (step.outcome === "transition" || step.outcome === "ending") {
      if (!automatic) throw new MechanicsReachabilityError("invalid_witness_step", "witness names an unavailable automatic mechanism");
      assertReplayStep(step, automatic.step);
      state = automatic.state;
      budget.observe(state);
      continue;
    }
    if (automatic) throw new MechanicsReachabilityError("invalid_witness_step", "optional action was attempted before automatic settlement");
    const action = playerActions(ir, input, state).find((candidate) => candidate.mechanismId === step.mechanismId && candidate.outcome === step.outcome);
    if (!action) throw new MechanicsReachabilityError("invalid_witness_step", "witness action is unavailable from this state");
    const expected = edge(action.mechanismId, action.outcome, state, action.next, action.sourceInterpretationIds);
    assertReplayStep(step, expected);
    state = action.next;
    budget.observe(state);
  }
  if (mechanicsStateHash(state) !== witness.final.stateHash) throw new MechanicsReachabilityError("invalid_witness_hash", "witness final state hash does not match execution");
  if (witness.final.kind === "clue" && !state.foundClueIds.includes(witness.final.id)) throw new MechanicsReachabilityError("invalid_witness_goal", "witness did not discover its declared clue");
  if (witness.final.kind === "ending" && state.terminalEndingId !== witness.final.id) throw new MechanicsReachabilityError("invalid_witness_goal", "witness did not reach its declared ending");
  if (witness.final.kind === "deadlock" && state.terminalEndingId) throw new MechanicsReachabilityError("invalid_witness_goal", "deadlock witness reached an ending");
  return state;
}
