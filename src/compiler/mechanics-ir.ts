import { sha256 } from "../ingest/document-ir";
import { validateSourceFactGraph, type FactInterpretationCandidate, type SourceFactGraph } from "./source-fact-graph";

export const MECHANICS_IR_SCHEMA_VERSION = "1.0.0";

export type Scalar = string | number | boolean | null;
export type Difficulty = "regular" | "hard" | "extreme";
export type DiscoveryAction = "observe" | "search" | "talk" | "read" | "use_item" | "move" | "custom";
export type DiscoveryTarget = "clue" | "item" | "npc" | "scene";

export type Predicate =
  | { kind: "all"; predicates: Predicate[] }
  | { kind: "any"; predicates: Predicate[] }
  | { kind: "not"; predicate: Predicate }
  | { kind: "clue_found"; clueId: string }
  | { kind: "scene_visited"; sceneId: string }
  | { kind: "item_owned"; itemId: string }
  | { kind: "state_eq"; stateKey: string; value: Scalar }
  | { kind: "npc_state"; npcId: string; state: string };

export type Effect =
  | { kind: "discover_clue"; clueId: string }
  | { kind: "set_state"; stateKey: string; value: Scalar }
  | { kind: "unlock_connection"; connectionId: string }
  | { kind: "start_encounter"; encounterId: string }
  | { kind: "reward"; rewardId: string }
  | { kind: "end_game"; endingId: string };

export type CheckSpec =
  | { kind: "none" }
  | { kind: "skill"; skill: string; difficulty: Difficulty }
  | { kind: "attribute"; attribute: "str" | "dex" | "pow" | "con" | "app" | "edu" | "int" | "siz"; difficulty: Difficulty };

export interface DiscoveryMethodIR {
  id: string;
  clueId: string;
  action: DiscoveryAction;
  target: DiscoveryTarget;
  targetId: string;
  availability?: Predicate;
  check?: CheckSpec;
  onSuccess: Effect[];
  onFailure?: Effect[];
  failback?: { maxFailures: number; effects: Effect[] };
  sourceInterpretationIds: string[];
}

export interface ConnectionGateIR {
  id: string;
  connectionId: string;
  availability?: Predicate;
  onTraverse?: Effect[];
  sourceInterpretationIds: string[];
}

export interface StateTransitionIR {
  id: string;
  when: Predicate;
  effects: Effect[];
  sourceInterpretationIds: string[];
}

export interface EndingRuleIR {
  id: string;
  priority: number;
  when: Predicate;
  effects: Effect[];
  sourceInterpretationIds: string[];
}

export interface MechanicsSymbols {
  clueIds: string[];
  sceneIds: string[];
  itemIds: string[];
  npcIds: string[];
  connectionIds: string[];
  encounterIds: string[];
  endingIds: string[];
  rewardIds: string[];
  declaredStateKeys: string[];
}

export interface MechanicsIR {
  schemaVersion: typeof MECHANICS_IR_SCHEMA_VERSION;
  moduleId: string;
  documentHash: string | null;
  sourceGraphIdentity: string;
  mechanicsHash: string;
  symbols: MechanicsSymbols;
  /** Catalog retained so validation can reject dangling mechanism provenance. */
  sourceInterpretationIds: string[];
  discoveryMethods: DiscoveryMethodIR[];
  connections: ConnectionGateIR[];
  transitions: StateTransitionIR[];
  endings: EndingRuleIR[];
}

export type DiscoveryMethodSpec = Omit<DiscoveryMethodIR, "sourceInterpretationIds"> & { kind: "discovery_method" };
export type ConnectionGateSpec = Omit<ConnectionGateIR, "sourceInterpretationIds"> & { kind: "connection_gate" };
export type StateTransitionSpec = Omit<StateTransitionIR, "sourceInterpretationIds"> & { kind: "state_transition" };
export type EndingRuleSpec = Omit<EndingRuleIR, "sourceInterpretationIds"> & { kind: "ending_rule" };
export type MechanicsCandidateSpec = DiscoveryMethodSpec | ConnectionGateSpec | StateTransitionSpec | EndingRuleSpec;

export interface MechanicsCompilationInput {
  moduleId: string;
  documentHash: string | null;
  sourceGraphSchemaVersion: string;
  symbols: MechanicsSymbols;
  acceptedInterpretationIds: string[];
  requiredMechanicIds?: string[];
  /** Strict is the default; compatible mode requires an explicit policy allowlist. */
  compilationMode?: "strict" | "compatible";
  allowedEnginePolicyIds?: string[];
}

export class MechanicsCompilationError extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
    readonly interpretationId?: string,
    readonly path?: string,
    readonly sourceStatementIds?: string[],
  ) {
    super(reason);
    this.name = "MechanicsCompilationError";
  }
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as RecordValue;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function assertKeys(value: RecordValue, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new MechanicsCompilationError("invalid_schema", `undeclared field: ${path}.${key}`, undefined, `${path}.${key}`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new MechanicsCompilationError("invalid_schema", `expected non-empty string: ${path}`, undefined, path);
  return value;
}

function scalar(value: unknown, path: string): Scalar {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  throw new MechanicsCompilationError("invalid_schema", `expected scalar value: ${path}`, undefined, path);
}

function requiredEffects(value: unknown, path: string): Effect[] {
  if (!Array.isArray(value) || value.length === 0) throw new MechanicsCompilationError("invalid_schema", `expected non-empty effects: ${path}`, undefined, path);
  return value.map((entry, index) => parseEffect(entry, `${path}[${index}]`));
}

function parseEffect(value: unknown, path: string): Effect {
  if (!isRecord(value)) throw new MechanicsCompilationError("invalid_schema", `expected effect object: ${path}`, undefined, path);
  const kind = requiredString(value.kind, `${path}.kind`);
  switch (kind) {
    case "discover_clue":
      assertKeys(value, ["kind", "clueId"], path);
      return { kind, clueId: requiredString(value.clueId, `${path}.clueId`) };
    case "set_state":
      assertKeys(value, ["kind", "stateKey", "value"], path);
      return { kind, stateKey: requiredString(value.stateKey, `${path}.stateKey`), value: scalar(value.value, `${path}.value`) };
    case "unlock_connection":
      assertKeys(value, ["kind", "connectionId"], path);
      return { kind, connectionId: requiredString(value.connectionId, `${path}.connectionId`) };
    case "start_encounter":
      assertKeys(value, ["kind", "encounterId"], path);
      return { kind, encounterId: requiredString(value.encounterId, `${path}.encounterId`) };
    case "reward":
      assertKeys(value, ["kind", "rewardId"], path);
      return { kind, rewardId: requiredString(value.rewardId, `${path}.rewardId`) };
    case "end_game":
      assertKeys(value, ["kind", "endingId"], path);
      return { kind, endingId: requiredString(value.endingId, `${path}.endingId`) };
    default:
      throw new MechanicsCompilationError("invalid_schema", `unsupported effect kind: ${kind}`, undefined, `${path}.kind`);
  }
}

function parsePredicate(value: unknown, path: string): Predicate {
  if (!isRecord(value)) throw new MechanicsCompilationError("invalid_schema", `expected predicate object: ${path}`, undefined, path);
  const kind = requiredString(value.kind, `${path}.kind`);
  switch (kind) {
    case "all":
    case "any": {
      assertKeys(value, ["kind", "predicates"], path);
      if (!Array.isArray(value.predicates) || value.predicates.length === 0) throw new MechanicsCompilationError("invalid_schema", `empty ${kind} predicate: ${path}`, undefined, path);
      return { kind, predicates: value.predicates.map((entry, index) => parsePredicate(entry, `${path}.predicates[${index}]`)) };
    }
    case "not":
      assertKeys(value, ["kind", "predicate"], path);
      return { kind, predicate: parsePredicate(value.predicate, `${path}.predicate`) };
    case "clue_found":
      assertKeys(value, ["kind", "clueId"], path);
      return { kind, clueId: requiredString(value.clueId, `${path}.clueId`) };
    case "scene_visited":
      assertKeys(value, ["kind", "sceneId"], path);
      return { kind, sceneId: requiredString(value.sceneId, `${path}.sceneId`) };
    case "item_owned":
      assertKeys(value, ["kind", "itemId"], path);
      return { kind, itemId: requiredString(value.itemId, `${path}.itemId`) };
    case "state_eq":
      assertKeys(value, ["kind", "stateKey", "value"], path);
      return { kind, stateKey: requiredString(value.stateKey, `${path}.stateKey`), value: scalar(value.value, `${path}.value`) };
    case "npc_state":
      assertKeys(value, ["kind", "npcId", "state"], path);
      return { kind, npcId: requiredString(value.npcId, `${path}.npcId`), state: requiredString(value.state, `${path}.state`) };
    default:
      throw new MechanicsCompilationError("invalid_schema", `unsupported predicate kind: ${kind}`, undefined, `${path}.kind`);
  }
}

function parseCheck(value: unknown, path: string): CheckSpec {
  if (!isRecord(value)) throw new MechanicsCompilationError("invalid_schema", `expected check object: ${path}`, undefined, path);
  const kind = requiredString(value.kind, `${path}.kind`);
  if (kind === "none") {
    assertKeys(value, ["kind"], path);
    return { kind };
  }
  if (kind !== "skill" && kind !== "attribute") throw new MechanicsCompilationError("invalid_schema", `unsupported check kind: ${kind}`, undefined, `${path}.kind`);
  assertKeys(value, kind === "skill" ? ["kind", "skill", "difficulty"] : ["kind", "attribute", "difficulty"], path);
  const difficulty = requiredString(value.difficulty, `${path}.difficulty`);
  if (difficulty !== "regular" && difficulty !== "hard" && difficulty !== "extreme") throw new MechanicsCompilationError("invalid_schema", `unsupported difficulty: ${path}.difficulty`, undefined, `${path}.difficulty`);
  if (kind === "skill") return { kind, skill: requiredString(value.skill, `${path}.skill`), difficulty };
  const attribute = requiredString(value.attribute, `${path}.attribute`);
  if (!(["str", "dex", "pow", "con", "app", "edu", "int", "siz"] as string[]).includes(attribute)) {
    throw new MechanicsCompilationError("invalid_schema", `unsupported attribute: ${path}.attribute`, undefined, `${path}.attribute`);
  }
  return { kind, attribute: attribute as CheckSpec & { kind: "attribute" } extends { attribute: infer A } ? A : never, difficulty };
}

export function parseMechanicsCandidateSpec(value: unknown): MechanicsCandidateSpec {
  if (!isRecord(value)) throw new MechanicsCompilationError("invalid_schema", "mechanics candidate must be an object");
  const kind = requiredString(value.kind, "claim.value.kind");
  if (kind === "discovery_method") {
    assertKeys(value, ["kind", "id", "clueId", "action", "target", "targetId", "availability", "check", "onSuccess", "onFailure", "failback"], "claim.value");
    const action = requiredString(value.action, "claim.value.action");
    const target = requiredString(value.target, "claim.value.target");
    if (!(["observe", "search", "talk", "read", "use_item", "move", "custom"] as string[]).includes(action)) throw new MechanicsCompilationError("invalid_schema", "unsupported discovery action", undefined, "claim.value.action");
    if (!(["clue", "item", "npc", "scene"] as string[]).includes(target)) throw new MechanicsCompilationError("invalid_schema", "unsupported discovery target", undefined, "claim.value.target");
    const failback = value.failback === undefined ? undefined : parseFailback(value.failback, "claim.value.failback");
    return {
      kind,
      id: requiredString(value.id, "claim.value.id"),
      clueId: requiredString(value.clueId, "claim.value.clueId"),
      action: action as DiscoveryAction,
      target: target as DiscoveryTarget,
      targetId: requiredString(value.targetId, "claim.value.targetId"),
      ...(value.availability === undefined ? {} : { availability: parsePredicate(value.availability, "claim.value.availability") }),
      ...(value.check === undefined ? {} : { check: parseCheck(value.check, "claim.value.check") }),
      onSuccess: requiredEffects(value.onSuccess, "claim.value.onSuccess"),
      ...(value.onFailure === undefined ? {} : { onFailure: requiredEffects(value.onFailure, "claim.value.onFailure") }),
      ...(failback ? { failback } : {}),
    };
  }
  if (kind === "connection_gate") {
    assertKeys(value, ["kind", "id", "connectionId", "availability", "onTraverse"], "claim.value");
    return {
      kind,
      id: requiredString(value.id, "claim.value.id"),
      connectionId: requiredString(value.connectionId, "claim.value.connectionId"),
      ...(value.availability === undefined ? {} : { availability: parsePredicate(value.availability, "claim.value.availability") }),
      ...(value.onTraverse === undefined ? {} : { onTraverse: requiredEffects(value.onTraverse, "claim.value.onTraverse") }),
    };
  }
  if (kind === "state_transition") {
    assertKeys(value, ["kind", "id", "when", "effects"], "claim.value");
    return { kind, id: requiredString(value.id, "claim.value.id"), when: parsePredicate(value.when, "claim.value.when"), effects: requiredEffects(value.effects, "claim.value.effects") };
  }
  if (kind === "ending_rule") {
    assertKeys(value, ["kind", "id", "priority", "when", "effects"], "claim.value");
    if (typeof value.priority !== "number" || !Number.isInteger(value.priority)) throw new MechanicsCompilationError("invalid_schema", "ending priority must be an integer", undefined, "claim.value.priority");
    return { kind, id: requiredString(value.id, "claim.value.id"), priority: value.priority, when: parsePredicate(value.when, "claim.value.when"), effects: requiredEffects(value.effects, "claim.value.effects") };
  }
  throw new MechanicsCompilationError("invalid_schema", `unsupported mechanics kind: ${kind}`, undefined, "claim.value.kind");
}

function parseFailback(value: unknown, path: string): { maxFailures: number; effects: Effect[] } {
  if (!isRecord(value)) throw new MechanicsCompilationError("invalid_schema", `expected failback object: ${path}`, undefined, path);
  assertKeys(value, ["maxFailures", "effects"], path);
  if (typeof value.maxFailures !== "number" || !Number.isInteger(value.maxFailures) || value.maxFailures < 1) {
    throw new MechanicsCompilationError("invalid_schema", `failback maxFailures must be a positive integer: ${path}.maxFailures`, undefined, `${path}.maxFailures`);
  }
  return { maxFailures: value.maxFailures, effects: requiredEffects(value.effects, `${path}.effects`) };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new MechanicsCompilationError("duplicate_id", `duplicate ${label}`);
}

function normalizeSymbols(symbols: MechanicsSymbols): MechanicsSymbols {
  const normalized: MechanicsSymbols = {
    clueIds: [...symbols.clueIds], sceneIds: [...symbols.sceneIds], itemIds: [...symbols.itemIds], npcIds: [...symbols.npcIds],
    connectionIds: [...symbols.connectionIds], encounterIds: [...symbols.encounterIds], endingIds: [...symbols.endingIds], rewardIds: [...symbols.rewardIds], declaredStateKeys: [...symbols.declaredStateKeys],
  };
  const symbolGroups: Array<[string, string[]]> = [
    ["clueIds", normalized.clueIds], ["sceneIds", normalized.sceneIds], ["itemIds", normalized.itemIds], ["npcIds", normalized.npcIds],
    ["connectionIds", normalized.connectionIds], ["encounterIds", normalized.encounterIds], ["endingIds", normalized.endingIds], ["rewardIds", normalized.rewardIds], ["declaredStateKeys", normalized.declaredStateKeys],
  ];
  for (const [label, values] of symbolGroups) {
    if (values.some((value) => !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value))) throw new MechanicsCompilationError("invalid_symbol", `invalid ${label} symbol`);
    assertUnique(values, `${label} symbol`);
  }
  if (normalized.declaredStateKeys.some((key) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key))) {
    throw new MechanicsCompilationError("invalid_symbol", "state keys must be declared identifiers");
  }
  return normalized;
}

/** Source graph identity is structural source evidence, independent of later interpretations. */
export function sourceFactGraphIdentity(graph: SourceFactGraph): string {
  return sha256(canonical({
    schemaVersion: graph.schemaVersion,
    documentIdentity: graph.documentIdentity,
    statements: graph.statements,
    relations: graph.relations,
  }));
}

type CompiledNode =
  | { kind: "discovery_method"; node: DiscoveryMethodIR }
  | { kind: "connection_gate"; node: ConnectionGateIR }
  | { kind: "state_transition"; node: StateTransitionIR }
  | { kind: "ending_rule"; node: EndingRuleIR };

function compileSpec(spec: MechanicsCandidateSpec, interpretationId: string): CompiledNode {
  const sourceInterpretationIds = [interpretationId];
  switch (spec.kind) {
    case "discovery_method": return { kind: spec.kind, node: { ...spec, sourceInterpretationIds } };
    case "connection_gate": return { kind: spec.kind, node: { ...spec, sourceInterpretationIds } };
    case "state_transition": return { kind: spec.kind, node: { ...spec, sourceInterpretationIds } };
    case "ending_rule": return { kind: spec.kind, node: { ...spec, sourceInterpretationIds } };
  }
}

const ACCEPTED_AUTHORITIES = new Set(["module_errata", "module_explicit", "user_document", "open_licensed", "project_original"]);

function eligibleInterpretation(graph: SourceFactGraph, interpretationId: string, input: MechanicsCompilationInput): FactInterpretationCandidate {
  const interpretation = graph.interpretations.find((candidate) => candidate.id === interpretationId);
  if (!interpretation) throw new MechanicsCompilationError("missing_interpretation", `interpretation is missing: ${interpretationId}`, interpretationId);
  const claim = interpretation.claim;
  if (interpretation.interpretationStatus !== "accepted" || claim.status !== "accepted") {
    throw new MechanicsCompilationError("interpretation_not_accepted", `interpretation is not accepted: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
  }
  if (interpretation.sourceStatementIds.length === 0) throw new MechanicsCompilationError("missing_source", `interpretation has no source statements: ${interpretationId}`, interpretationId);
  if (claim.domain !== "gameplay_mechanic") throw new MechanicsCompilationError("invalid_domain", `interpretation is not a gameplay mechanic: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
  if (claim.authority === "engine_policy") {
    if ((input.compilationMode ?? "strict") !== "compatible") throw new MechanicsCompilationError("engine_policy_strict", `strict mode rejects engine policy: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
    if (claim.derivation !== "default") throw new MechanicsCompilationError("engine_policy_derivation", `engine policy must be a default: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
    if (interpretation.review?.decision !== "accept" || interpretation.review.reviewerKind !== "approved_policy") {
      throw new MechanicsCompilationError("engine_policy_review", `engine policy lacks approved policy review: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
    }
    if (!interpretation.review.policyId || !input.allowedEnginePolicyIds?.includes(interpretation.review.policyId)) {
      throw new MechanicsCompilationError("engine_policy_not_allowed", `engine policy is not allowed: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
    }
    if (graph.interpretations.some((candidate) => candidate.id !== interpretation.id && candidate.interpretationStatus === "accepted" && candidate.claim.status === "accepted" && candidate.claim.authority === "module_explicit" && candidate.claim.path === claim.path)) {
      throw new MechanicsCompilationError("engine_policy_override", `engine policy cannot override module explicit mechanic: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
    }
    return interpretation;
  }
  if (!ACCEPTED_AUTHORITIES.has(claim.authority)) throw new MechanicsCompilationError("invalid_authority", `interpretation authority is not allowed: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
  if (!claim.path.startsWith("mechanics.")) throw new MechanicsCompilationError("invalid_path", `mechanics claim path is required: ${interpretationId}`, interpretationId, claim.path, interpretation.sourceStatementIds);
  return interpretation;
}

export function compileMechanics(graph: SourceFactGraph, input: MechanicsCompilationInput): MechanicsIR {
  validateSourceFactGraph(graph);
  if (!input.moduleId.trim()) throw new MechanicsCompilationError("invalid_input", "moduleId is required");
  if (input.documentHash !== graph.documentIdentity.documentHash) throw new MechanicsCompilationError("document_mismatch", "documentHash does not match SourceFactGraph");
  if (input.sourceGraphSchemaVersion !== graph.schemaVersion) throw new MechanicsCompilationError("schema_mismatch", "sourceGraphSchemaVersion does not match SourceFactGraph");
  if (input.compilationMode && input.compilationMode !== "strict" && input.compilationMode !== "compatible") throw new MechanicsCompilationError("invalid_input", "unknown compilationMode");
  assertUnique(input.acceptedInterpretationIds, "accepted interpretation id");
  if (input.allowedEnginePolicyIds) assertUnique(input.allowedEnginePolicyIds, "allowed engine policy id");
  if (input.requiredMechanicIds) assertUnique(input.requiredMechanicIds, "required mechanic id");
  const symbols = normalizeSymbols(input.symbols);
  const nodes = input.acceptedInterpretationIds.map((interpretationId) => {
    const interpretation = eligibleInterpretation(graph, interpretationId, input);
    try {
      return compileSpec(parseMechanicsCandidateSpec(interpretation.claim.value), interpretation.id);
    } catch (error) {
      if (error instanceof MechanicsCompilationError) throw new MechanicsCompilationError(error.code, error.reason, interpretation.id, error.path ?? interpretation.claim.path, interpretation.sourceStatementIds);
      throw error;
    }
  });
  const ir: MechanicsIR = {
    schemaVersion: MECHANICS_IR_SCHEMA_VERSION,
    moduleId: input.moduleId,
    documentHash: input.documentHash,
    sourceGraphIdentity: sourceFactGraphIdentity(graph),
    mechanicsHash: "",
    symbols,
    sourceInterpretationIds: [...input.acceptedInterpretationIds].sort(),
    discoveryMethods: nodes.filter((node): node is Extract<CompiledNode, { kind: "discovery_method" }> => node.kind === "discovery_method").map((node) => node.node).sort((left, right) => left.id.localeCompare(right.id)),
    connections: nodes.filter((node): node is Extract<CompiledNode, { kind: "connection_gate" }> => node.kind === "connection_gate").map((node) => node.node).sort((left, right) => left.id.localeCompare(right.id)),
    transitions: nodes.filter((node): node is Extract<CompiledNode, { kind: "state_transition" }> => node.kind === "state_transition").map((node) => node.node).sort((left, right) => left.id.localeCompare(right.id)),
    endings: nodes.filter((node): node is Extract<CompiledNode, { kind: "ending_rule" }> => node.kind === "ending_rule").map((node) => node.node).sort((left, right) => left.id.localeCompare(right.id)),
  };
  validateMechanicsStructure(ir);
  if (input.requiredMechanicIds) {
    const compiled = new Set([...ir.discoveryMethods, ...ir.connections, ...ir.transitions, ...ir.endings].map((node) => node.id));
    for (const id of input.requiredMechanicIds) if (!compiled.has(id)) throw new MechanicsCompilationError("missing_required_mechanic", `required mechanic is missing: ${id}`);
  }
  const mechanicsHash = sha256(canonical({ ...ir, mechanicsHash: undefined }));
  const completed = { ...ir, mechanicsHash };
  validateMechanicsIR(completed);
  return completed;
}

function assertKnown(id: string, ids: readonly string[], label: string): void {
  if (!ids.includes(id)) throw new MechanicsCompilationError("unknown_symbol", `unknown ${label}: ${id}`);
}

function validatePredicate(predicate: Predicate, symbols: MechanicsSymbols): void {
  switch (predicate.kind) {
    case "all":
    case "any":
      if (predicate.predicates.length === 0) throw new MechanicsCompilationError("invalid_predicate", `empty ${predicate.kind} predicate`);
      predicate.predicates.forEach((entry) => validatePredicate(entry, symbols));
      return;
    case "not": validatePredicate(predicate.predicate, symbols); return;
    case "clue_found": assertKnown(predicate.clueId, symbols.clueIds, "clue"); return;
    case "scene_visited": assertKnown(predicate.sceneId, symbols.sceneIds, "scene"); return;
    case "item_owned": assertKnown(predicate.itemId, symbols.itemIds, "item"); return;
    case "state_eq": assertKnown(predicate.stateKey, symbols.declaredStateKeys, "state key"); return;
    case "npc_state": assertKnown(predicate.npcId, symbols.npcIds, "npc"); return;
  }
}

function validateEffects(effects: readonly Effect[], symbols: MechanicsSymbols, allowEndGame: boolean): void {
  if (effects.length === 0) throw new MechanicsCompilationError("invalid_effect", "effects must not be empty");
  const writes = new Map<string, string>();
  for (const effect of effects) {
    switch (effect.kind) {
      case "discover_clue": assertKnown(effect.clueId, symbols.clueIds, "clue"); break;
      case "set_state": {
        assertKnown(effect.stateKey, symbols.declaredStateKeys, "state key");
        const previous = writes.get(effect.stateKey);
        const value = canonical(effect.value);
        if (previous !== undefined && previous !== value) throw new MechanicsCompilationError("conflicting_state_write", `mutually exclusive state values for ${effect.stateKey}`);
        writes.set(effect.stateKey, value);
        break;
      }
      case "unlock_connection": assertKnown(effect.connectionId, symbols.connectionIds, "connection"); break;
      case "start_encounter": assertKnown(effect.encounterId, symbols.encounterIds, "encounter"); break;
      case "reward": assertKnown(effect.rewardId, symbols.rewardIds, "reward"); break;
      case "end_game":
        if (!allowEndGame) throw new MechanicsCompilationError("invalid_end_game", "end_game is only allowed in an ending or explicit terminal transition");
        assertKnown(effect.endingId, symbols.endingIds, "ending");
        break;
    }
  }
}

function validateSourceIds(ids: readonly string[], available: readonly string[]): void {
  if (ids.length === 0) throw new MechanicsCompilationError("missing_source", "mechanic lacks sourceInterpretationIds");
  assertUnique(ids, "source interpretation id");
  for (const id of ids) assertKnown(id, available, "source interpretation");
}

function validateMechanicsStructure(ir: MechanicsIR): void {
  if (ir.schemaVersion !== MECHANICS_IR_SCHEMA_VERSION) throw new MechanicsCompilationError("schema_mismatch", `unsupported mechanics schema: ${ir.schemaVersion}`);
  if (!ir.moduleId.trim() || !ir.sourceGraphIdentity || !/^[a-f0-9]{64}$/.test(ir.sourceGraphIdentity)) throw new MechanicsCompilationError("invalid_identity", "invalid mechanics identity");
  const symbols = normalizeSymbols(ir.symbols);
  const sourceIds = [...ir.sourceInterpretationIds];
  assertUnique(sourceIds, "source interpretation id");
  const allNodes = [...ir.discoveryMethods, ...ir.connections, ...ir.transitions, ...ir.endings];
  const nodeIds = allNodes.map((node) => node.id);
  assertUnique(nodeIds, "mechanism id");
  for (const discovery of ir.discoveryMethods) {
    assertKnown(discovery.clueId, symbols.clueIds, "clue");
    assertKnown(discovery.targetId, discovery.target === "clue" ? symbols.clueIds : discovery.target === "item" ? symbols.itemIds : discovery.target === "npc" ? symbols.npcIds : symbols.sceneIds, `${discovery.target} target`);
    if (!discovery.onSuccess.some((effect) => effect.kind === "discover_clue" && effect.clueId === discovery.clueId)) throw new MechanicsCompilationError("missing_discovery_effect", `discovery method must discover its clue: ${discovery.id}`);
    if (discovery.availability) validatePredicate(discovery.availability, symbols);
    if (discovery.onFailure) validateEffects(discovery.onFailure, symbols, false);
    if (discovery.failback) validateEffects(discovery.failback.effects, symbols, false);
    validateEffects(discovery.onSuccess, symbols, false);
    validateSourceIds(discovery.sourceInterpretationIds, sourceIds);
  }
  for (const connection of ir.connections) {
    assertKnown(connection.connectionId, symbols.connectionIds, "connection");
    if (connection.availability) validatePredicate(connection.availability, symbols);
    if (connection.onTraverse) validateEffects(connection.onTraverse, symbols, false);
    validateSourceIds(connection.sourceInterpretationIds, sourceIds);
  }
  for (const transition of ir.transitions) {
    validatePredicate(transition.when, symbols);
    validateEffects(transition.effects, symbols, true);
    validateSourceIds(transition.sourceInterpretationIds, sourceIds);
  }
  const priorities = new Set<number>();
  for (const ending of ir.endings) {
    if (priorities.has(ending.priority)) throw new MechanicsCompilationError("duplicate_ending_priority", `duplicate ending priority: ${ending.priority}`);
    priorities.add(ending.priority);
    validatePredicate(ending.when, symbols);
    validateEffects(ending.effects, symbols, true);
    validateSourceIds(ending.sourceInterpretationIds, sourceIds);
  }
}

export function validateMechanicsIR(ir: MechanicsIR): void {
  validateMechanicsStructure(ir);
  const expected = sha256(canonical({ ...ir, mechanicsHash: undefined }));
  if (ir.mechanicsHash !== expected) throw new MechanicsCompilationError("hash_mismatch", "mechanicsHash does not match canonical IR");
}
