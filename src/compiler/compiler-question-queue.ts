import { sha256 } from "../ingest/document-ir";
import { sourceFactGraphIdentity, parseMechanicsCandidateSpec, type ConnectionGateSpec, type DiscoveryMethodSpec, type DiscoveryTarget, type EndingRuleSpec } from "./mechanics-ir";
import type { RightsStatus } from "./source-authority";
import type { DraftModuleStructure } from "./deterministic-template-compiler";
import { validateSourceFactGraph, type SourceFactGraph, type SourceStatement } from "./source-fact-graph";

export const COMPILER_QUESTION_QUEUE_SCHEMA_VERSION = "1.1.0";
export const MODULE_COMPILE_HINTS_SCHEMA_VERSION = "1.1.0";

export type CompilerQuestionKind = "scene_role" | "entry_scene" | "connection_topology" | "core_clue" | "ending_rule" | "discovery_method" | "check_spec" | "npc_binding" | "item_binding" | "state_key";
export type CompilerQuestionStatus = "open" | "answered" | "rejected" | "deferred";
export type CompilerQuestionSeverity = "publish_blocking" | "draft_warning";
export type SceneRole = "playable_scene" | "rules_section" | "character_section" | "ending_section" | "other";

export interface CompilerQuestion {
  id: string;
  kind: CompilerQuestionKind;
  prompt: string;
  sourceStatementIds: string[];
  evidenceRefs: string[];
  /** Legacy general candidate set; semantic domains below are used where needed. */
  candidateIds?: string[];
  subjectCandidateId?: string;
  allowedCandidateIds?: string[];
  /** Discovery location candidates are deliberately distinct from mechanism targets. */
  allowedLocationCandidateIds?: string[];
  allowedMechanicsTargetIds?: Partial<Record<DiscoveryTarget, string[]>>;
  status: CompilerQuestionStatus;
  resolution?: CompilerQuestionResolution;
  blockingCode: string;
  severity: CompilerQuestionSeverity;
}

export interface CompilerQuestionQueue {
  schemaVersion: typeof COMPILER_QUESTION_QUEUE_SCHEMA_VERSION;
  moduleId: string;
  documentHash: string | null;
  sourceGraphIdentity: string;
  questions: CompilerQuestion[];
  queueHash: string;
}

export interface CompilerQuestionResolution {
  questionId: string;
  kind: CompilerQuestionKind;
  value: unknown;
  sourceStatementIds: string[];
  evidenceRefs: string[];
  authority: "module_explicit" | "user_document" | "project_original";
  derivation: "explicit";
  reviewerKind: "deterministic_rule" | "human" | "approved_policy";
  policyId?: string;
  rightsStatus: RightsStatus;
  reason: string;
}

export interface ModuleCompileHints {
  schemaVersion: typeof MODULE_COMPILE_HINTS_SCHEMA_VERSION;
  moduleId: string;
  documentHash: string | null;
  sourceGraphIdentity: string;
  resolutions: CompilerQuestionResolution[];
}

export type ParsedCompilerHintValue =
  | { kind: "scene_role"; role: SceneRole }
  | { kind: "entry_scene"; sceneId: string }
  | { kind: "core_clue"; clueId: string; required: boolean }
  | { kind: "connection_topology"; connections: Array<{ fromSceneId: string; toSceneId: string; connectionId: string; spec: ConnectionGateSpec }> }
  | { kind: "ending_rule"; declarations: Array<{ endingId: string; spec: EndingRuleSpec }> }
  | { kind: "discovery_method"; clueId: string; locationSceneId: string; spec: DiscoveryMethodSpec };

export class CompilerQuestionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CompilerQuestionError";
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function documentIdentity(graph: SourceFactGraph): string { return graph.documentIdentity.documentHash ?? `synthetic:${graph.documentIdentity.sourceDescriptor ?? "unspecified"}`; }
function uniqueSorted(ids: readonly string[]): string[] { return [...new Set(ids)].sort(); }
function questionId(graph: SourceFactGraph, kind: CompilerQuestionKind, sourceStatementIds: string[], role: string): string { return `question_${sha256(`${documentIdentity(graph)}|${kind}|${uniqueSorted(sourceStatementIds).join("|")}|${role}`).slice(0, 24)}`; }

function statements(graph: SourceFactGraph, ids: readonly string[]): SourceStatement[] {
  return ids.map((id) => {
    const statement = graph.statements.find((candidate) => candidate.id === id);
    if (!statement) throw new CompilerQuestionError("missing_statement", `question source statement is missing: ${id}`);
    return statement;
  });
}
function refs(graph: SourceFactGraph, ids: readonly string[]): string[] { return statements(graph, ids).map((statement) => statement.evidenceRefId); }

interface QuestionOptions {
  candidateIds?: string[];
  subjectCandidateId?: string;
  allowedCandidateIds?: string[];
  allowedLocationCandidateIds?: string[];
  allowedMechanicsTargetIds?: Partial<Record<DiscoveryTarget, string[]>>;
}
function createQuestion(graph: SourceFactGraph, kind: CompilerQuestionKind, sourceStatementIds: string[], role: string, prompt: string, blockingCode: string, severity: CompilerQuestionSeverity, options: QuestionOptions = {}): CompilerQuestion {
  const sources = uniqueSorted(sourceStatementIds);
  if (sources.length === 0) throw new CompilerQuestionError("missing_source", `question ${kind} has no source statements`);
  const targets = options.allowedMechanicsTargetIds && Object.fromEntries(Object.entries(options.allowedMechanicsTargetIds).map(([kind, ids]) => [kind, uniqueSorted(ids!)]));
  return {
    id: questionId(graph, kind, sources, role), kind, prompt, sourceStatementIds: sources, evidenceRefs: refs(graph, sources),
    ...(options.candidateIds?.length ? { candidateIds: uniqueSorted(options.candidateIds) } : {}),
    ...(options.subjectCandidateId ? { subjectCandidateId: options.subjectCandidateId } : {}),
    ...(options.allowedCandidateIds?.length ? { allowedCandidateIds: uniqueSorted(options.allowedCandidateIds) } : {}),
    ...(options.allowedLocationCandidateIds?.length ? { allowedLocationCandidateIds: uniqueSorted(options.allowedLocationCandidateIds) } : {}),
    ...(targets && Object.keys(targets).length ? { allowedMechanicsTargetIds: targets } : {}),
    status: "open", blockingCode, severity,
  };
}

function endingHeadings(draft: DraftModuleStructure): string[] {
  const explicit = draft.sceneCandidates.filter((scene) => /(?:结局|结尾|ending)/i.test(scene.displayName)).map((scene) => scene.headingStatementId);
  return explicit.length ? explicit : draft.sceneCandidates.map((scene) => scene.headingStatementId);
}

export function buildCompilerQuestionQueue(graph: SourceFactGraph, draft: DraftModuleStructure): CompilerQuestionQueue {
  validateSourceFactGraph(graph);
  const graphIdentity = sourceFactGraphIdentity(graph);
  if (draft.documentHash !== graph.documentIdentity.documentHash || draft.sourceGraphIdentity !== graphIdentity) throw new CompilerQuestionError("draft_identity_mismatch", "draft does not match SourceFactGraph identity");
  const questions: CompilerQuestion[] = [];
  const sceneIds = draft.sceneCandidates.map((scene) => scene.id);
  for (const scene of draft.sceneCandidates) {
    questions.push(createQuestion(graph, "scene_role", [scene.headingStatementId], `scene:${scene.id}`, `Classify heading “${scene.displayName}” as a playable scene, rules section, character section, ending section, or other.`, "unresolved_scene_candidates", "publish_blocking", { candidateIds: [scene.id], subjectCandidateId: scene.id }));
    questions.push(createQuestion(graph, "connection_topology", [scene.headingStatementId], `topology:${scene.id}`, `Declare every outgoing connection from heading “${scene.displayName}”. An empty connections array explicitly declares zero outgoing edges; document order is not an edge.`, "missing_connection_topology", "publish_blocking", { candidateIds: [scene.id], subjectCandidateId: scene.id, allowedCandidateIds: sceneIds }));
  }
  const entrySources = draft.sceneCandidates.map((scene) => scene.headingStatementId);
  const fallbackEntrySources = entrySources.length ? entrySources : graph.statements[0] ? [graph.statements[0].id] : [];
  if (fallbackEntrySources.length) questions.push(createQuestion(graph, "entry_scene", fallbackEntrySources, "entry", "Select an explicit entry scene from the candidate headings; no heading is the default entry.", "missing_entry_scene", "publish_blocking", { candidateIds: sceneIds, allowedCandidateIds: sceneIds }));
  for (const clue of draft.clueCandidates) {
    const sources = [clue.markedItemStatementId, clue.bodyStatementId];
    questions.push(createQuestion(graph, "core_clue", sources, `core:${clue.id}`, `Decide whether marked item “${clue.displayName}” is required for the main path.`, "core_clue_unresolved", "draft_warning", { candidateIds: [clue.id], subjectCandidateId: clue.id }));
    questions.push(createQuestion(graph, "item_binding", sources, `item:${clue.id}`, `Decide whether marked item “${clue.displayName}” needs an explicit runtime item binding.`, "item_binding_unresolved", "draft_warning", { candidateIds: [clue.id], subjectCandidateId: clue.id }));
    questions.push(createQuestion(graph, "discovery_method", sources, `discovery:${clue.id}`, `Declare an explicit discovery method for marked item “${clue.displayName}”, or leave the compatible default observation policy in force. Location and target use separate candidate domains.`, "unresolved_discovery_method", "draft_warning", {
      candidateIds: [clue.id], subjectCandidateId: clue.id, allowedLocationCandidateIds: [clue.sceneCandidateId],
      allowedMechanicsTargetIds: { scene: [clue.sceneCandidateId], clue: [clue.id] },
    }));
  }
  for (const statementId of draft.readiness.unresolvedStatementIds) {
    const statement = graph.statements.find((candidate) => candidate.id === statementId);
    if (statement?.kind === "marked_item") questions.push(createQuestion(graph, "discovery_method", [statement.id], `unresolved-marked:${statement.id}`, "Resolve whether this marked item has an explicit discovery method; no clue is generated until it is resolved.", "unresolved_discovery_method", "draft_warning"));
  }
  for (const statement of graph.statements.filter((candidate) => candidate.kind === "paragraph" || candidate.kind === "list_item")) questions.push(createQuestion(graph, "discovery_method", [statement.id], `prose:${statement.id}`, `Decide whether this ${statement.kind} contains an explicitly modeled discovery method; it is not a clue by default.`, "unresolved_discovery_method", "draft_warning"));
  const endingSources = endingHeadings(draft);
  const fallbackEndingSources = endingSources.length ? endingSources : graph.statements[0] ? [graph.statements[0].id] : [];
  if (fallbackEndingSources.length) questions.push(createQuestion(graph, "ending_rule", fallbackEndingSources, "ending", "Declare one or more explicit ending rules and their end_game declarations; no ending condition or effect is inferred.", "missing_ending_rules", "publish_blocking", { candidateIds: sceneIds, allowedCandidateIds: [...sceneIds, ...draft.clueCandidates.map((clue) => clue.id)] }));
  const queue: CompilerQuestionQueue = { schemaVersion: COMPILER_QUESTION_QUEUE_SCHEMA_VERSION, moduleId: draft.moduleId, documentHash: draft.documentHash, sourceGraphIdentity: graphIdentity, questions: [...questions].sort((left, right) => left.id.localeCompare(right.id)), queueHash: "" };
  const completed = withQueueHash(queue);
  validateCompilerQuestionQueue(graph, completed);
  return completed;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CompilerQuestionError("invalid_hint_value", `invalid ${label} hint value`);
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: readonly string[], label: string): void { for (const key of Object.keys(value)) if (!keys.includes(key)) throw new CompilerQuestionError("invalid_hint_value", `undeclared ${label} field: ${key}`); }
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value)) throw new CompilerQuestionError("invalid_declaration", `invalid ${label} declaration`);
  return value;
}
function candidate(question: CompilerQuestion, value: unknown, label: string, allowed = question.allowedCandidateIds ?? question.candidateIds ?? []): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new CompilerQuestionError("unknown_hint_reference", `unallowed ${label} candidate`);
  return value;
}

/** The one value-semantics contract used by both hint validation and resolution. */
export function parseCompilerHintValue(question: CompilerQuestion, value: unknown): ParsedCompilerHintValue {
  const input = object(value, question.kind);
  switch (question.kind) {
    case "scene_role": {
      only(input, ["role"], "scene_role");
      if (!( ["playable_scene", "rules_section", "character_section", "ending_section", "other"] as string[]).includes(input.role as string)) throw new CompilerQuestionError("invalid_hint_value", "invalid scene role");
      return { kind: "scene_role", role: input.role as SceneRole };
    }
    case "entry_scene":
      only(input, ["sceneCandidateId"], "entry_scene");
      return { kind: "entry_scene", sceneId: candidate(question, input.sceneCandidateId, "entry scene") };
    case "core_clue": {
      only(input, ["clueCandidateId", "required"], "core_clue");
      if (typeof input.required !== "boolean") throw new CompilerQuestionError("invalid_hint_value", "core clue required must be boolean");
      if (input.clueCandidateId !== question.subjectCandidateId) throw new CompilerQuestionError("unknown_hint_reference", "unknown reference: core clue must match question subject");
      return { kind: "core_clue", clueId: candidate(question, input.clueCandidateId, "core clue", [question.subjectCandidateId!]), required: input.required };
    }
    case "connection_topology": {
      only(input, ["connections"], "connection_topology");
      if (!Array.isArray(input.connections)) throw new CompilerQuestionError("invalid_hint_value", "connections must be an array");
      if (!question.subjectCandidateId) throw new CompilerQuestionError("invalid_question", "topology question lacks source scene subject");
      const declared = new Set<string>();
      return {
        kind: "connection_topology",
        connections: input.connections.map((entry, index) => {
          const connection = object(entry, `connections[${index}]`);
          only(connection, ["toSceneCandidateId", "connectionId", "availability", "onTraverse"], `connections[${index}]`);
          const connectionId = identifier(connection.connectionId, "connectionId");
          if (declared.has(connectionId)) throw new CompilerQuestionError("duplicate_declaration", `duplicate connection declaration: ${connectionId}`);
          declared.add(connectionId);
          const spec = parseMechanicsCandidateSpec({ kind: "connection_gate", id: `hint_connection_${connectionId}`, connectionId, ...(connection.availability === undefined ? {} : { availability: connection.availability }), ...(connection.onTraverse === undefined ? {} : { onTraverse: connection.onTraverse }) });
          if (spec.kind !== "connection_gate") throw new CompilerQuestionError("invalid_hint_value", "invalid connection hint");
          return { fromSceneId: question.subjectCandidateId!, toSceneId: candidate(question, connection.toSceneCandidateId, "connection target"), connectionId, spec };
        }),
      };
    }
    case "ending_rule": {
      only(input, ["declarations"], "ending_rule");
      if (!Array.isArray(input.declarations) || input.declarations.length === 0) throw new CompilerQuestionError("invalid_hint_value", "ending declarations must be non-empty");
      const endingIds = new Set<string>();
      return {
        kind: "ending_rule",
        declarations: input.declarations.map((entry, index) => {
          const declaration = object(entry, `declarations[${index}]`);
          only(declaration, ["endingId", "spec"], `declarations[${index}]`);
          const endingId = identifier(declaration.endingId, "endingId");
          if (endingIds.has(endingId)) throw new CompilerQuestionError("duplicate_declaration", `duplicate ending declaration: ${endingId}`);
          endingIds.add(endingId);
          const spec = parseMechanicsCandidateSpec(declaration.spec);
          if (spec.kind !== "ending_rule") throw new CompilerQuestionError("invalid_hint_value", "ending hint requires EndingRuleSpec");
          const endGames = spec.effects.filter((effect) => effect.kind === "end_game");
          if (endGames.length !== 1 || endGames[0]!.endingId !== endingId) throw new CompilerQuestionError("invalid_declaration", "ending declaration must match exactly one end_game effect");
          return { endingId, spec };
        }),
      };
    }
    case "discovery_method": {
      only(input, ["clueCandidateId", "locationSceneCandidateId", "spec"], "discovery_method");
      if (!question.subjectCandidateId) throw new CompilerQuestionError("invalid_question", "discovery question has no clue subject");
      if (!question.allowedLocationCandidateIds?.length || !question.allowedMechanicsTargetIds) throw new CompilerQuestionError("invalid_question", "discovery question has no candidate domains");
      const clueId = candidate(question, input.clueCandidateId, "discovery clue", [question.subjectCandidateId]);
      const locationSceneId = candidate(question, input.locationSceneCandidateId, "discovery location", question.allowedLocationCandidateIds);
      const spec = parseMechanicsCandidateSpec(input.spec);
      if (spec.kind !== "discovery_method") throw new CompilerQuestionError("invalid_hint_value", "discovery hint requires DiscoveryMethodSpec");
      if (spec.clueId !== clueId) throw new CompilerQuestionError("unknown_hint_reference", "discovery spec must bind the question clue");
      const targetIds = question.allowedMechanicsTargetIds[spec.target];
      if (!targetIds?.includes(spec.targetId)) throw new CompilerQuestionError("unknown_hint_reference", "discovery target is outside its semantic domain");
      return { kind: "discovery_method", clueId, locationSceneId, spec };
    }
    case "check_spec":
    case "npc_binding":
    case "item_binding":
    case "state_key":
      throw new CompilerQuestionError("unsupported_hint_kind", `unsupported_hint_kind: ${question.kind}`);
  }
}

function validateResolution(question: CompilerQuestion, resolution: CompilerQuestionResolution): void {
  if (resolution.questionId !== question.id || resolution.kind !== question.kind) throw new CompilerQuestionError("kind_mismatch", `hint kind does not match question: ${resolution.questionId}`);
  if (!( ["module_explicit", "user_document", "project_original"] as string[]).includes(resolution.authority)) throw new CompilerQuestionError("invalid_authority", `hint authority is not allowed: ${resolution.questionId}`);
  if (!( ["deterministic_rule", "human", "approved_policy"] as string[]).includes(resolution.reviewerKind)) throw new CompilerQuestionError("invalid_reviewer", `hint reviewer kind is not allowed: ${resolution.questionId}`);
  if (resolution.reviewerKind !== "human" && !resolution.policyId?.trim()) throw new CompilerQuestionError("invalid_reviewer", `policy reviewer lacks policyId: ${resolution.questionId}`);
  if (!( ["unknown", "open_licensed", "project_owned", "user_provided"] as string[]).includes(resolution.rightsStatus)) throw new CompilerQuestionError("invalid_rights", `hint rights are not allowed: ${resolution.questionId}`);
  if (resolution.derivation !== "explicit") throw new CompilerQuestionError("open_question_default", `open question cannot be defaulted: ${resolution.questionId}`);
  if (!resolution.reason.trim()) throw new CompilerQuestionError("missing_reason", `hint reason is required: ${resolution.questionId}`);
  if (uniqueSorted(resolution.sourceStatementIds).join("|") !== uniqueSorted(question.sourceStatementIds).join("|")) throw new CompilerQuestionError("evidence_mismatch", `hint source statements do not match question: ${resolution.questionId}`);
  if (uniqueSorted(resolution.evidenceRefs).join("|") !== uniqueSorted(question.evidenceRefs).join("|")) throw new CompilerQuestionError("evidence_mismatch", `hint evidence does not match question: ${resolution.questionId}`);
  parseCompilerHintValue(question, resolution.value);
}

export function validateCompilerQuestionQueue(graph: SourceFactGraph, queue: CompilerQuestionQueue): void {
  validateSourceFactGraph(graph);
  if (queue.schemaVersion !== COMPILER_QUESTION_QUEUE_SCHEMA_VERSION) throw new CompilerQuestionError("schema_mismatch", "unsupported compiler question queue schema");
  if (!queue.moduleId.trim()) throw new CompilerQuestionError("identity_mismatch", "queue moduleId is required");
  if (queue.documentHash !== graph.documentIdentity.documentHash || queue.sourceGraphIdentity !== sourceFactGraphIdentity(graph)) throw new CompilerQuestionError("identity_mismatch", "queue does not match SourceFactGraph identity");
  const ids = new Set<string>();
  const equivalence = new Set<string>();
  for (const question of queue.questions) {
    if (ids.has(question.id)) throw new CompilerQuestionError("duplicate_question", `duplicate question id: ${question.id}`);
    ids.add(question.id);
    if (question.sourceStatementIds.length === 0) throw new CompilerQuestionError("missing_source", `question has no source statements: ${question.id}`);
    if (new Set(question.sourceStatementIds).size !== question.sourceStatementIds.length) throw new CompilerQuestionError("duplicate_source", `question duplicates source statements: ${question.id}`);
    const requiredRefs = refs(graph, question.sourceStatementIds);
    if (uniqueSorted(question.evidenceRefs).join("|") !== uniqueSorted(requiredRefs).join("|")) throw new CompilerQuestionError("evidence_mismatch", `question evidence does not exactly cover source statements: ${question.id}`);
    const key = `${question.kind}|${uniqueSorted(question.sourceStatementIds).join("|")}`;
    if (equivalence.has(key)) throw new CompilerQuestionError("duplicate_question", `duplicate question kind and evidence: ${question.id}`);
    equivalence.add(key);
    if (!( ["open", "answered", "rejected", "deferred"] as string[]).includes(question.status)) throw new CompilerQuestionError("resolution_status_mismatch", `unknown question status: ${question.id}`);
    if (question.status === "answered") {
      if (!question.resolution) throw new CompilerQuestionError("resolution_status_mismatch", `answered question lacks resolution: ${question.id}`);
      validateResolution(question, question.resolution);
    } else if (question.resolution) {
      throw new CompilerQuestionError("resolution_status_mismatch", `non-answered question has resolution: ${question.id}`);
    }
  }
  const expected = sha256(canonical({ ...queue, queueHash: undefined }));
  if (queue.queueHash !== expected) throw new CompilerQuestionError("hash_mismatch", "queueHash does not match canonical queue");
}

export function validateModuleCompileHints(queue: CompilerQuestionQueue, hints: ModuleCompileHints): void {
  if (hints.schemaVersion !== MODULE_COMPILE_HINTS_SCHEMA_VERSION) throw new CompilerQuestionError("schema_mismatch", "unsupported module compile hints schema");
  if (hints.moduleId !== queue.moduleId || hints.documentHash !== queue.documentHash || hints.sourceGraphIdentity !== queue.sourceGraphIdentity) throw new CompilerQuestionError("identity_mismatch", "hints do not match compiler question queue identity");
  const resolved = new Set<string>();
  for (const resolution of hints.resolutions) {
    if (resolved.has(resolution.questionId)) throw new CompilerQuestionError("conflicting_resolution", `multiple resolutions for question: ${resolution.questionId}`);
    resolved.add(resolution.questionId);
    const question = queue.questions.find((candidate) => candidate.id === resolution.questionId);
    if (!question) throw new CompilerQuestionError("unknown_question", `hint references unknown question: ${resolution.questionId}`);
    if (question.status === "rejected" || question.status === "deferred") throw new CompilerQuestionError("resolution_status_mismatch", `cannot answer ${question.status} question: ${question.id}`);
    validateResolution(question, resolution);
    if (question.status === "answered" && canonical(question.resolution) !== canonical(resolution)) throw new CompilerQuestionError("conflicting_resolution", `answered question conflict: ${question.id}`);
  }
}

export function withQueueHash(queue: Omit<CompilerQuestionQueue, "queueHash"> & { queueHash?: string }): CompilerQuestionQueue {
  return { ...queue, queueHash: sha256(canonical({ ...queue, queueHash: undefined })) };
}
