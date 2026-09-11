import { sha256 } from "../ingest/document-ir";
import { sourceFactGraphIdentity } from "./mechanics-ir";
import type { DraftModuleStructure } from "./deterministic-template-compiler";
import { validateSourceFactGraph, type SourceFactGraph, type SourceStatement } from "./source-fact-graph";

export const COMPILER_QUESTION_QUEUE_SCHEMA_VERSION = "1.0.0";
export const MODULE_COMPILE_HINTS_SCHEMA_VERSION = "1.0.0";

export type CompilerQuestionKind = "scene_role" | "entry_scene" | "connection_topology" | "core_clue" | "ending_rule" | "discovery_method" | "check_spec" | "npc_binding" | "item_binding" | "state_key";
export type CompilerQuestionStatus = "open" | "answered" | "rejected" | "deferred";
export type CompilerQuestionSeverity = "publish_blocking" | "draft_warning";

export interface CompilerQuestion {
  id: string;
  kind: CompilerQuestionKind;
  prompt: string;
  sourceStatementIds: string[];
  evidenceRefs: string[];
  candidateIds?: string[];
  subjectCandidateId?: string;
  allowedCandidateIds?: string[];
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
  derivation: "explicit" | "default";
  reviewerKind: "deterministic_rule" | "human" | "approved_policy";
  policyId?: string;
  reason: string;
}

export interface ModuleCompileHints {
  schemaVersion: typeof MODULE_COMPILE_HINTS_SCHEMA_VERSION;
  documentHash: string | null;
  sourceGraphIdentity: string;
  resolutions: CompilerQuestionResolution[];
}

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

function documentIdentity(graph: SourceFactGraph): string {
  return graph.documentIdentity.documentHash ?? `synthetic:${graph.documentIdentity.sourceDescriptor ?? "unspecified"}`;
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function questionId(graph: SourceFactGraph, kind: CompilerQuestionKind, sourceStatementIds: string[], role: string): string {
  return `question_${sha256(`${documentIdentity(graph)}|${kind}|${uniqueSorted(sourceStatementIds).join("|")}|${role}`).slice(0, 24)}`;
}

function statements(graph: SourceFactGraph, ids: readonly string[]): SourceStatement[] {
  return ids.map((id) => {
    const statement = graph.statements.find((candidate) => candidate.id === id);
    if (!statement) throw new CompilerQuestionError("missing_statement", `question source statement is missing: ${id}`);
    return statement;
  });
}

function refs(graph: SourceFactGraph, ids: readonly string[]): string[] {
  return statements(graph, ids).map((statement) => statement.evidenceRefId);
}

function createQuestion(
  graph: SourceFactGraph,
  kind: CompilerQuestionKind,
  sourceStatementIds: string[],
  role: string,
  prompt: string,
  blockingCode: string,
  severity: CompilerQuestionSeverity,
  candidateIds?: string[], subjectCandidateId?: string, allowedCandidateIds?: string[],
): CompilerQuestion {
  const sources = uniqueSorted(sourceStatementIds);
  if (sources.length === 0) throw new CompilerQuestionError("missing_source", `question ${kind} has no source statements`);
  return {
    id: questionId(graph, kind, sources, role),
    kind,
    prompt,
    sourceStatementIds: sources,
    evidenceRefs: refs(graph, sources),
    ...(candidateIds?.length ? { candidateIds: uniqueSorted(candidateIds) } : {}),
    ...(subjectCandidateId ? { subjectCandidateId } : {}),
    ...(allowedCandidateIds?.length ? { allowedCandidateIds: uniqueSorted(allowedCandidateIds) } : {}),
    status: "open",
    blockingCode,
    severity,
  };
}

function endingHeadings(draft: DraftModuleStructure): string[] {
  const explicit = draft.sceneCandidates.filter((scene) => /(?:结局|结尾|ending)/i.test(scene.displayName)).map((scene) => scene.headingStatementId);
  return explicit.length ? explicit : draft.sceneCandidates.map((scene) => scene.headingStatementId);
}

export function buildCompilerQuestionQueue(graph: SourceFactGraph, draft: DraftModuleStructure): CompilerQuestionQueue {
  validateSourceFactGraph(graph);
  const graphIdentity = sourceFactGraphIdentity(graph);
  if (draft.documentHash !== graph.documentIdentity.documentHash || draft.sourceGraphIdentity !== graphIdentity) {
    throw new CompilerQuestionError("draft_identity_mismatch", "draft does not match SourceFactGraph identity");
  }
  const questions: CompilerQuestion[] = [];
  for (const scene of draft.sceneCandidates) {
    questions.push(createQuestion(graph, "scene_role", [scene.headingStatementId], `scene:${scene.id}`, `Classify heading “${scene.displayName}” as a playable scene, rules section, character section, ending section, or other.`, "unresolved_scene_candidates", "publish_blocking", [scene.id], scene.id));
    questions.push(createQuestion(graph, "connection_topology", [scene.headingStatementId], `topology:${scene.id}`, `Resolve declared connection topology involving heading “${scene.displayName}”; do not infer an edge from document order.`, "missing_connection_topology", "publish_blocking", [scene.id], scene.id, draft.sceneCandidates.map((candidate) => candidate.id)));
  }
  const entrySources = draft.sceneCandidates.map((scene) => scene.headingStatementId);
  const fallbackEntrySources = entrySources.length ? entrySources : graph.statements[0] ? [graph.statements[0].id] : [];
  if (fallbackEntrySources.length > 0) questions.push(createQuestion(graph, "entry_scene", fallbackEntrySources, "entry", "Select an explicit entry scene from the candidate headings; no heading is the default entry.", "missing_entry_scene", "publish_blocking", draft.sceneCandidates.map((scene) => scene.id), undefined, draft.sceneCandidates.map((scene) => scene.id)));
  for (const clue of draft.clueCandidates) {
    questions.push(createQuestion(graph, "core_clue", [clue.markedItemStatementId, clue.bodyStatementId], `core:${clue.id}`, `Decide whether marked item “${clue.displayName}” is required for the main path.`, "core_clue_unresolved", "draft_warning", [clue.id], clue.id));
    questions.push(createQuestion(graph, "item_binding", [clue.markedItemStatementId, clue.bodyStatementId], `item:${clue.id}`, `Decide whether marked item “${clue.displayName}” needs an explicit runtime item binding.`, "item_binding_unresolved", "draft_warning", [clue.id]));
  }
  for (const statementId of draft.readiness.unresolvedStatementIds) {
    const statement = graph.statements.find((candidate) => candidate.id === statementId);
    if (!statement || statement.kind !== "marked_item") continue;
    questions.push(createQuestion(graph, "discovery_method", [statement.id], `unresolved-marked:${statement.id}`, `Resolve whether this marked item has an explicit discovery method; no clue is generated until it is resolved.`, "unresolved_discovery_method", "draft_warning"));
  }
  for (const statement of graph.statements.filter((candidate) => candidate.kind === "paragraph" || candidate.kind === "list_item")) {
    questions.push(createQuestion(graph, "discovery_method", [statement.id], `prose:${statement.id}`, `Decide whether this ${statement.kind} contains an explicitly modeled discovery method; it is not a clue by default.`, "unresolved_discovery_method", "draft_warning"));
  }
  if (draft.mechanicsIR?.endings.length !== 0 || endingHeadings(draft).length === 0) {
    const fallback = graph.statements[0];
    if (fallback) questions.push(createQuestion(graph, "ending_rule", [fallback.id], "ending", "Provide an explicit ending rule; no ending condition or effect is inferred.", "missing_ending_rules", "publish_blocking"));
  } else {
    questions.push(createQuestion(graph, "ending_rule", endingHeadings(draft), "ending", "Provide an explicit ending rule using the cited heading scope; no ending condition or effect is inferred.", "missing_ending_rules", "publish_blocking", draft.sceneCandidates.filter((scene) => endingHeadings(draft).includes(scene.headingStatementId)).map((scene) => scene.id), undefined, [...draft.sceneCandidates.map((scene) => scene.id), ...draft.clueCandidates.map((clue) => clue.id)]));
  }
  const sortedQuestions = [...questions].sort((left, right) => left.id.localeCompare(right.id));
  const queue: CompilerQuestionQueue = {
    schemaVersion: COMPILER_QUESTION_QUEUE_SCHEMA_VERSION,
    moduleId: draft.moduleId,
    documentHash: draft.documentHash,
    sourceGraphIdentity: graphIdentity,
    questions: sortedQuestions,
    queueHash: "",
  };
  const completed = { ...queue, queueHash: sha256(canonical({ ...queue, queueHash: undefined })) };
  validateCompilerQuestionQueue(graph, completed);
  return completed;
}

export function validateCompilerQuestionQueue(graph: SourceFactGraph, queue: CompilerQuestionQueue): void {
  validateSourceFactGraph(graph);
  if (queue.schemaVersion !== COMPILER_QUESTION_QUEUE_SCHEMA_VERSION) throw new CompilerQuestionError("schema_mismatch", "unsupported compiler question queue schema");
  if (queue.documentHash !== graph.documentIdentity.documentHash || queue.sourceGraphIdentity !== sourceFactGraphIdentity(graph)) throw new CompilerQuestionError("identity_mismatch", "queue does not match SourceFactGraph identity");
  const ids = new Set<string>();
  const equivalence = new Set<string>();
  for (const question of queue.questions) {
    if (ids.has(question.id)) throw new CompilerQuestionError("duplicate_question", `duplicate question id: ${question.id}`);
    ids.add(question.id);
    if (question.sourceStatementIds.length === 0) throw new CompilerQuestionError("missing_source", `question has no source statements: ${question.id}`);
    if (new Set(question.sourceStatementIds).size !== question.sourceStatementIds.length) throw new CompilerQuestionError("duplicate_source", `question duplicates source statements: ${question.id}`);
    const requiredRefs = refs(graph, question.sourceStatementIds);
    for (const ref of requiredRefs) if (!question.evidenceRefs.includes(ref)) throw new CompilerQuestionError("evidence_mismatch", `question evidence does not cover source statement: ${question.id}`);
    const key = `${question.kind}|${uniqueSorted(question.sourceStatementIds).join("|")}`;
    if (equivalence.has(key)) throw new CompilerQuestionError("duplicate_question", `duplicate question kind and evidence: ${question.id}`);
    equivalence.add(key);
  }
  const expected = sha256(canonical({ ...queue, queueHash: undefined }));
  if (queue.queueHash !== expected) throw new CompilerQuestionError("hash_mismatch", "queueHash does not match canonical queue");
}

function valueReferences(value: unknown, key = ""): Array<{ key: string; id: string }> {
  if (Array.isArray(value)) return value.flatMap((entry) => valueReferences(entry, key));
  if (!value || typeof value !== "object") return typeof value === "string" ? [{ key, id: value }] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, childValue]) => valueReferences(childValue, childKey));
}

function validateHintReferences(question: CompilerQuestion, value: unknown): void {
  const candidates = new Set(question.candidateIds ?? []);
  for (const reference of valueReferences(value)) {
    if (!/(?:scene|clue|connection|state|ending)Ids?$/i.test(reference.key)) continue;
    if (!candidates.has(reference.id)) throw new CompilerQuestionError("unknown_hint_reference", `hint introduces unknown reference: ${reference.id}`);
  }
}

export function validateModuleCompileHints(queue: CompilerQuestionQueue, hints: ModuleCompileHints): void {
  if (hints.schemaVersion !== MODULE_COMPILE_HINTS_SCHEMA_VERSION) throw new CompilerQuestionError("schema_mismatch", "unsupported module compile hints schema");
  if (hints.documentHash !== queue.documentHash || hints.sourceGraphIdentity !== queue.sourceGraphIdentity) throw new CompilerQuestionError("identity_mismatch", "hints do not match compiler question queue identity");
  const resolved = new Set<string>();
  for (const resolution of hints.resolutions) {
    if (resolved.has(resolution.questionId)) throw new CompilerQuestionError("conflicting_resolution", `multiple resolutions for question: ${resolution.questionId}`);
    resolved.add(resolution.questionId);
    const question = queue.questions.find((candidate) => candidate.id === resolution.questionId);
    if (!question) throw new CompilerQuestionError("unknown_question", `hint references unknown question: ${resolution.questionId}`);
    if (resolution.kind !== question.kind) throw new CompilerQuestionError("kind_mismatch", `hint kind does not match question: ${resolution.questionId}`);
    if (!(["module_explicit", "user_document", "project_original"] as string[]).includes(resolution.authority)) throw new CompilerQuestionError("invalid_authority", `hint authority is not allowed: ${resolution.questionId}`);
    if (!(["deterministic_rule", "human", "approved_policy"] as string[]).includes(resolution.reviewerKind)) throw new CompilerQuestionError("invalid_reviewer", `hint reviewer kind is not allowed: ${resolution.questionId}`);
    if (resolution.derivation !== "explicit") throw new CompilerQuestionError("open_question_default", `open question cannot be defaulted: ${resolution.questionId}`);
    if (!resolution.reason.trim()) throw new CompilerQuestionError("missing_reason", `hint reason is required: ${resolution.questionId}`);
    if (uniqueSorted(resolution.sourceStatementIds).join("|") !== uniqueSorted(question.sourceStatementIds).join("|")) throw new CompilerQuestionError("evidence_mismatch", `hint source statements do not match question: ${resolution.questionId}`);
    if (uniqueSorted(resolution.evidenceRefs).join("|") !== uniqueSorted(question.evidenceRefs).join("|")) throw new CompilerQuestionError("evidence_mismatch", `hint evidence does not match question: ${resolution.questionId}`);
    validateHintReferences(question, resolution.value);
  }
}
