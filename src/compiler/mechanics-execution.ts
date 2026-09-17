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
  mechanismId: string;
  mechanismIds: string[];
  outcome: MechanicsOutcome;
  beforeStateHash: string;
  afterStateHash: string;
  sourceInterpretationIds: string[];
  summary: string;
}

export interface MechanicsClosureTrace {
  state: MechanicsState;
  steps: MechanicsReachabilityEdge[];
  states: Array<{ state: MechanicsState; hash: string; stepCount: number }>;
}

export interface MechanicsPlayerAction {
  mechanismId: string;
  outcome: Extract<MechanicsOutcome, "success" | "failure" | "failback" | "traverse">;
  next: MechanicsState;
  sourceInterpretationIds: string[];
}

export interface MechanicsStateBudget {
  readonly count: number;
  observe(state: MechanicsState): string;
}

export class MechanicsReachabilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MechanicsReachabilityError";
  }
}

const scalar = (value: unknown): value is Scalar => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sorted(values: Iterable<string>): string[] { return [...new Set(values)].sort(); }
function sortedRecord<T>(record: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))); }

export function normalizeMechanicsState(state: MechanicsState): MechanicsState {
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

export function mechanicsStateHash(state: MechanicsState): string { return canonical(normalizeMechanicsState(state)); }
function requireKnown(id: string, values: readonly string[], label: string): void { if (!values.includes(id)) throw new MechanicsReachabilityError("unknown_symbol", `unknown ${label}: ${id}`); }
function requireUnique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new MechanicsReachabilityError("duplicate_input", `duplicate ${label}`); }

export function createMechanicsStateBudget(maxStates: number): MechanicsStateBudget {
  if (!Number.isInteger(maxStates) || maxStates < 1) throw new MechanicsReachabilityError("invalid_max_states", "maxStates must be a positive integer");
  const hashes = new Set<string>();
  return Object.freeze({
    get count() { return hashes.size; },
    observe(state: MechanicsState) {
      const hash = mechanicsStateHash(state);
      if (!hashes.has(hash)) {
        if (hashes.size >= maxStates) throw new MechanicsReachabilityError("state_limit_exceeded", `state limit exceeded: ${maxStates}`);
        hashes.add(hash);
      }
      return hash;
    },
  });
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

export function matchesMechanicsPredicate(predicate: Predicate, state: MechanicsState): boolean {
  switch (predicate.kind) {
    case "all": return predicate.predicates.every((entry) => matchesMechanicsPredicate(entry, state));
    case "any": return predicate.predicates.some((entry) => matchesMechanicsPredicate(entry, state));
    case "not": return !matchesMechanicsPredicate(predicate.predicate, state);
    case "clue_found": return state.foundClueIds.includes(predicate.clueId);
    case "scene_visited": return state.visitedSceneIds.includes(predicate.sceneId);
    case "item_owned": return state.ownedItemIds.includes(predicate.itemId);
    case "connection_unlocked": return state.unlockedConnectionIds.includes(predicate.connectionId);
    case "state_eq": return canonical(state.stateValues[predicate.stateKey]) === canonical(predicate.value);
    case "npc_state": return state.npcStates[predicate.npcId] === predicate.state;
  }
}

export function applyMechanicsEffects(state: MechanicsState, effects: readonly Effect[]): MechanicsState {
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
  return normalizeMechanicsState(next);
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

export function createMechanicsEdge(mechanismId: string, outcome: MechanicsOutcome, before: MechanicsState, after: MechanicsState, sourceInterpretationIds: string[], mechanismIds: string[] = [mechanismId]): MechanicsReachabilityEdge {
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
export function nextAutomaticMechanicsStep(ir: MechanicsIR, state: MechanicsState): { state: MechanicsState; step: MechanicsReachabilityEdge } | undefined {
  if (state.terminalEndingId) return undefined;
  const selectedEnding = ir.endings.filter((ending) => matchesMechanicsPredicate(ending.when, state)).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
  if (selectedEnding) {
    const terminal = applyMechanicsEffects(state, selectedEnding.effects);
    if (!terminal.terminalEndingId) throw new MechanicsReachabilityError("invalid_terminal", `ending rule did not produce end_game: ${selectedEnding.id}`);
    return { state: terminal, step: createMechanicsEdge(selectedEnding.id, "ending", state, terminal, selectedEnding.sourceInterpretationIds) };
  }
  const transitions = ir.transitions.filter((transition) => matchesMechanicsPredicate(transition.when, state));
  if (transitions.length === 0) return undefined;
  validateCompatibleAutomaticEffects(transitions);
  const next = applyMechanicsEffects(state, transitions.flatMap((transition) => transition.effects));
  if (mechanicsStateHash(next) === mechanicsStateHash(state)) return undefined;
  const ids = transitions.map((transition) => transition.id).sort();
  return { state: next, step: createMechanicsEdge(automaticBatchId(ids), "transition", state, next, transitions.flatMap((transition) => transition.sourceInterpretationIds), ids) };
}

export function settleAutomaticMechanics(ir: MechanicsIR, initial: MechanicsState, budget?: MechanicsStateBudget): MechanicsClosureTrace {
  let state = normalizeMechanicsState(initial);
  const steps: MechanicsReachabilityEdge[] = [];
  const hash = budget?.observe(state) ?? mechanicsStateHash(state);
  const states: MechanicsClosureTrace["states"] = [{ state, hash, stepCount: 0 }];
  const closureHashes = new Set<string>([hash]);
  while (true) {
    const automatic = nextAutomaticMechanicsStep(ir, state);
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

/** Lists all executable optional actions after callers settle automatic mechanics. */
export function availableMechanicsPlayerActions(ir: MechanicsIR, input: MechanicsAnalysisInput, state: MechanicsState): MechanicsPlayerAction[] {
  if (state.terminalEndingId) return [];
  const actions: MechanicsPlayerAction[] = [];
  for (const discovery of ir.discoveryMethods) {
    if (state.foundClueIds.includes(discovery.clueId)) continue;
    if (input.discoveryLocations[discovery.id] !== state.currentSceneId || (discovery.availability && !matchesMechanicsPredicate(discovery.availability, state))) continue;
    actions.push({ mechanismId: discovery.id, outcome: "success", next: applyMechanicsEffects(state, discovery.onSuccess), sourceInterpretationIds: [...discovery.sourceInterpretationIds] });
    if (!checked(discovery)) continue;
    const count = Object.hasOwn(state.failureCounts, discovery.id) ? state.failureCounts[discovery.id]! : 0;
    if (discovery.failback && count >= discovery.failback.maxFailures) actions.push({ mechanismId: discovery.id, outcome: "failback", next: applyMechanicsEffects(state, discovery.failback.effects), sourceInterpretationIds: [...discovery.sourceInterpretationIds] });
    else {
      const failed = applyMechanicsEffects(state, discovery.onFailure ?? []);
      if (discovery.failback) Object.defineProperty(failed.failureCounts, discovery.id, {
        value: Math.min(count + 1, discovery.failback.maxFailures), enumerable: true, writable: true, configurable: true,
      });
      actions.push({ mechanismId: discovery.id, outcome: "failure", next: normalizeMechanicsState(failed), sourceInterpretationIds: [...discovery.sourceInterpretationIds] });
    }
  }
  for (const gate of ir.connections) {
    const connection = input.connections.find((entry) => entry.id === gate.connectionId)!;
    if (connection.fromSceneId !== state.currentSceneId || (gate.availability && !matchesMechanicsPredicate(gate.availability, state))) continue;
    const traversed = applyMechanicsEffects(state, gate.onTraverse ?? []);
    traversed.currentSceneId = connection.toSceneId;
    traversed.visitedSceneIds = sorted([...traversed.visitedSceneIds, connection.toSceneId]);
    actions.push({ mechanismId: gate.id, outcome: "traverse", next: normalizeMechanicsState(traversed), sourceInterpretationIds: [...gate.sourceInterpretationIds] });
  }
  return actions;
}

export function executeMechanicsAction(ir: MechanicsIR, input: MechanicsAnalysisInput, state: MechanicsState, requested: Pick<MechanicsPlayerAction, "mechanismId" | "outcome">): { state: MechanicsState; edge: MechanicsReachabilityEdge } {
  if (nextAutomaticMechanicsStep(ir, state)) throw new MechanicsReachabilityError("action_before_settlement", "requested action is unavailable before automatic settlement");
  if (state.terminalEndingId) throw new MechanicsReachabilityError("action_after_terminal", "requested action is unavailable after terminal ending");
  const action = availableMechanicsPlayerActions(ir, input, state).find((candidate) => candidate.mechanismId === requested.mechanismId && candidate.outcome === requested.outcome);
  if (!action) throw new MechanicsReachabilityError("action_unavailable", `requested action is unavailable: ${requested.mechanismId}:${requested.outcome}`);
  return { state: action.next, edge: createMechanicsEdge(action.mechanismId, action.outcome, state, action.next, action.sourceInterpretationIds) };
}

export function initialMechanicsState(input: MechanicsAnalysisInput): MechanicsState {
  return normalizeMechanicsState({ currentSceneId: input.entrySceneId, foundClueIds: input.initialState.foundClueIds, visitedSceneIds: [...input.initialState.visitedSceneIds, input.entrySceneId], ownedItemIds: input.initialState.ownedItemIds, stateValues: input.initialState.stateValues, npcStates: input.initialState.npcStates, unlockedConnectionIds: [], failureCounts: {}, startedEncounterIds: [], rewardIds: [] });
}
