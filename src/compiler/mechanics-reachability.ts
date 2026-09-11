import { validateMechanicsIR, type Effect, type MechanicsIR, type Predicate, type Scalar } from "./mechanics-ir";

export interface MechanicsAnalysisInput {
  entrySceneId: string;
  initialState: {
    foundClueIds: string[];
    visitedSceneIds: string[];
    ownedItemIds: string[];
    stateValues: Record<string, Scalar>;
    npcStates: Record<string, string>;
  };
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
  mechanismId: string;
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
  code: "unreachable_core_clue" | "unreachable_ending" | "core_clue_failure_deadlock" | "closed_world_deadlock";
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
  failureDeadlockMethodIds: string[];
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

interface SearchNode {
  state: MechanicsState;
  hash: string;
  steps: MechanicsReachabilityEdge[];
}

const scalar = (value: unknown): value is Scalar => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

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

export function mechanicsStateHash(state: MechanicsState): string {
  return canonical(normalizeState(state));
}

function requireKnown(id: string, values: readonly string[], label: string): void {
  if (!values.includes(id)) throw new MechanicsReachabilityError("unknown_symbol", `unknown ${label}: ${id}`);
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new MechanicsReachabilityError("duplicate_input", `duplicate ${label}`);
}

function validateInitialState(ir: MechanicsIR, input: MechanicsAnalysisInput): void {
  const initial = input.initialState;
  const listChecks: Array<[string[], string[], string]> = [
    [initial.foundClueIds, ir.symbols.clueIds, "initial clue"],
    [initial.visitedSceneIds, ir.symbols.sceneIds, "initial scene"],
    [initial.ownedItemIds, ir.symbols.itemIds, "initial item"],
    [input.coreClueIds, ir.symbols.clueIds, "core clue"],
  ];
  for (const [ids, symbols, label] of listChecks) {
    requireUnique(ids, label);
    ids.forEach((id) => requireKnown(id, symbols, label));
  }
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
  for (const gate of ir.connections) {
    if (!input.connections.some((connection) => connection.id === gate.connectionId)) {
      throw new MechanicsReachabilityError("missing_connection", `connection target is missing: ${gate.connectionId}`);
    }
  }
  const locations = Object.keys(input.discoveryLocations);
  requireUnique(locations, "discovery location");
  for (const discovery of ir.discoveryMethods) {
    const sceneId = input.discoveryLocations[discovery.id];
    if (!sceneId) throw new MechanicsReachabilityError("missing_discovery_location", `discovery location is missing: ${discovery.id}`);
    requireKnown(sceneId, ir.symbols.sceneIds, "discovery location scene");
  }
  for (const discoveryId of locations) {
    if (!ir.discoveryMethods.some((discovery) => discovery.id === discoveryId)) {
      throw new MechanicsReachabilityError("unknown_discovery_location", `unknown discovery location: ${discoveryId}`);
    }
  }
  for (const discovery of ir.discoveryMethods) {
    if (discovery.failback && !discovery.failback.effects.some((effect) => effect.kind === "discover_clue" && effect.clueId === discovery.clueId)) {
      throw new MechanicsReachabilityError("invalid_failback", `failback does not discover method clue: ${discovery.id}`);
    }
  }
}

function matches(predicate: Predicate, state: MechanicsState): boolean {
  switch (predicate.kind) {
    case "all": return predicate.predicates.every((entry) => matches(entry, state));
    case "any": return predicate.predicates.some((entry) => matches(entry, state));
    case "not": return !matches(predicate.predicate, state);
    case "clue_found": return state.foundClueIds.includes(predicate.clueId);
    case "scene_visited": return state.visitedSceneIds.includes(predicate.sceneId);
    case "item_owned": return state.ownedItemIds.includes(predicate.itemId);
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

function edge(mechanismId: string, outcome: MechanicsOutcome, before: MechanicsState, after: MechanicsState, sourceInterpretationIds: string[]): MechanicsReachabilityEdge {
  return {
    mechanismId,
    outcome,
    beforeStateHash: mechanicsStateHash(before),
    afterStateHash: mechanicsStateHash(after),
    sourceInterpretationIds: [...sourceInterpretationIds],
    summary: summary(before, after),
  };
}

function checked(discovery: MechanicsIR["discoveryMethods"][number]): boolean {
  return discovery.check !== undefined && discovery.check.kind !== "none";
}

function staticFailureDeadlocks(ir: MechanicsIR, coreClueIds: readonly string[]): string[] {
  return ir.discoveryMethods
    .filter((method) => coreClueIds.includes(method.clueId) && checked(method) && !method.failback)
    .filter((method) => !ir.discoveryMethods.some((other) => other.clueId === method.clueId && (!checked(other) || other.failback)))
    .map((method) => method.id)
    .sort();
}

export function analyzeMechanicsReachability(ir: MechanicsIR, input: MechanicsAnalysisInput): MechanicsReachabilityReport {
  validateMechanicsAnalysisInput(ir, input);
  const initial: MechanicsState = normalizeState({
    currentSceneId: input.entrySceneId,
    foundClueIds: input.initialState.foundClueIds,
    visitedSceneIds: [...input.initialState.visitedSceneIds, input.entrySceneId],
    ownedItemIds: input.initialState.ownedItemIds,
    stateValues: input.initialState.stateValues,
    npcStates: input.initialState.npcStates,
    unlockedConnectionIds: [],
    failureCounts: {},
    startedEncounterIds: [],
    rewardIds: [],
  });
  const initialHash = mechanicsStateHash(initial);
  const queue: SearchNode[] = [{ state: initial, hash: initialHash, steps: [] }];
  const seen = new Set<string>([initialHash]);
  const reachableClues = new Set<string>(initial.foundClueIds);
  const reachableEndings = new Set<string>();
  const terminalEndings = new Set<string>();
  const endingWitnesses: Record<string, MechanicsWitness> = {};
  const coreClueWitnesses: Record<string, MechanicsWitness> = {};
  const failbackWitnesses: Record<string, MechanicsWitness> = {};
  const deadlockWitnesses: MechanicsWitness[] = [];
  const allEdges: MechanicsReachabilityEdge[] = [];
  const failureDeadlockMethodIds = staticFailureDeadlocks(ir, input.coreClueIds);
  for (const clueId of input.coreClueIds) if (initial.foundClueIds.includes(clueId)) coreClueWitnesses[clueId] = { startSceneId: input.entrySceneId, steps: [], final: { kind: "clue", id: clueId, stateHash: initialHash } };

  const enqueue = (before: SearchNode, next: MechanicsState, nextEdge: MechanicsReachabilityEdge) => {
    if (nextEdge.beforeStateHash === nextEdge.afterStateHash) return;
    allEdges.push(nextEdge);
    const hash = nextEdge.afterStateHash;
    if (seen.has(hash)) return;
    if (seen.size >= input.maxStates) throw new MechanicsReachabilityError("state_limit_exceeded", `state limit exceeded: ${input.maxStates}`);
    seen.add(hash);
    const node: SearchNode = { state: normalizeState(next), hash, steps: [...before.steps, nextEdge] };
    for (const clueId of node.state.foundClueIds) {
      reachableClues.add(clueId);
      if (input.coreClueIds.includes(clueId) && !coreClueWitnesses[clueId]) coreClueWitnesses[clueId] = { startSceneId: input.entrySceneId, steps: node.steps, final: { kind: "clue", id: clueId, stateHash: hash } };
    }
    queue.push(node);
  };

  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!;
    const state = node.state;
    if (state.terminalEndingId) {
      reachableEndings.add(state.terminalEndingId);
      terminalEndings.add(state.terminalEndingId);
      if (!endingWitnesses[state.terminalEndingId]) endingWitnesses[state.terminalEndingId] = { startSceneId: input.entrySceneId, steps: node.steps, final: { kind: "ending", id: state.terminalEndingId, stateHash: node.hash } };
      continue;
    }
    const selectedEnding = [...ir.endings].filter((ending) => matches(ending.when, state)).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
    if (selectedEnding) {
      const terminal = applyEffects(state, selectedEnding.effects);
      terminal.terminalEndingId = selectedEnding.id;
      enqueue(node, terminal, edge(selectedEnding.id, "ending", state, terminal, selectedEnding.sourceInterpretationIds));
      continue;
    }
    let changedEdges = 0;
    const add = (mechanismId: string, outcome: MechanicsOutcome, next: MechanicsState, sourceInterpretationIds: string[]) => {
      const nextEdge = edge(mechanismId, outcome, state, next, sourceInterpretationIds);
      if (nextEdge.beforeStateHash !== nextEdge.afterStateHash) changedEdges++;
      enqueue(node, next, nextEdge);
      if (outcome === "failback" && nextEdge.beforeStateHash !== nextEdge.afterStateHash && !failbackWitnesses[mechanismId]) {
        const hash = nextEdge.afterStateHash;
        failbackWitnesses[mechanismId] = { startSceneId: input.entrySceneId, steps: [...node.steps, nextEdge], final: { kind: "clue", id: ir.discoveryMethods.find((method) => method.id === mechanismId)!.clueId, stateHash: hash } };
      }
    };
    for (const discovery of ir.discoveryMethods) {
      if (input.discoveryLocations[discovery.id] !== state.currentSceneId || (discovery.availability && !matches(discovery.availability, state))) continue;
      add(discovery.id, "success", applyEffects(state, discovery.onSuccess), discovery.sourceInterpretationIds);
      if (!checked(discovery)) continue;
      const count = state.failureCounts[discovery.id] ?? 0;
      if (discovery.failback && count >= discovery.failback.maxFailures) {
        add(discovery.id, "failback", applyEffects(state, discovery.failback.effects), discovery.sourceInterpretationIds);
      } else {
        const failed = applyEffects(state, discovery.onFailure ?? []);
        if (discovery.failback) failed.failureCounts[discovery.id] = Math.min(count + 1, discovery.failback.maxFailures);
        add(discovery.id, "failure", normalizeState(failed), discovery.sourceInterpretationIds);
      }
    }
    for (const gate of ir.connections) {
      const connection = input.connections.find((entry) => entry.id === gate.connectionId)!;
      if (connection.fromSceneId !== state.currentSceneId || (gate.availability && !matches(gate.availability, state))) continue;
      const traversed = applyEffects(state, gate.onTraverse ?? []);
      traversed.currentSceneId = connection.toSceneId;
      traversed.visitedSceneIds = sorted([...traversed.visitedSceneIds, connection.toSceneId]);
      add(gate.id, "traverse", normalizeState(traversed), gate.sourceInterpretationIds);
    }
    for (const transition of ir.transitions) {
      if (matches(transition.when, state)) add(transition.id, "transition", applyEffects(state, transition.effects), transition.sourceInterpretationIds);
    }
    if (changedEdges === 0) deadlockWitnesses.push({ startSceneId: input.entrySceneId, steps: node.steps, final: { kind: "deadlock", id: node.hash, stateHash: node.hash } });
  }

  const unreachableCoreClueIds = input.coreClueIds.filter((id) => !reachableClues.has(id)).sort();
  const unreachableEndingIds = ir.symbols.endingIds.filter((id) => !reachableEndings.has(id)).sort();
  const issues: MechanicsAnalysisIssue[] = [
    ...unreachableCoreClueIds.map((id) => ({ code: "unreachable_core_clue" as const, id })),
    ...unreachableEndingIds.map((id) => ({ code: "unreachable_ending" as const, id })),
    ...failureDeadlockMethodIds.map((id) => ({ code: "core_clue_failure_deadlock" as const, id })),
    ...deadlockWitnesses.map((entry) => ({ code: "closed_world_deadlock" as const, id: entry.final.stateHash, witness: entry })),
  ];
  return {
    reachableStateCount: seen.size,
    reachableClueIds: [...reachableClues].sort(),
    unreachableCoreClueIds,
    reachableEndingIds: [...reachableEndings].sort(),
    unreachableEndingIds,
    selectedTerminalEndingIds: [...terminalEndings].sort(),
    endingWitnesses,
    coreClueWitnesses,
    failbackWitnesses,
    deadlockWitnesses,
    failureDeadlockMethodIds,
    edges: allEdges,
    issues,
    analysisScope: "closed_world",
  };
}
