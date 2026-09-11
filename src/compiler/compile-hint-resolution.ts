import { sha256 } from "../ingest/document-ir";
import { analyzeMechanicsReachability, type MechanicsAnalysisInput, type MechanicsReachabilityReport } from "./mechanics-reachability";
import { compileMechanics, parseMechanicsCandidateSpec, type CheckSpec, type ConnectionGateSpec, type MechanicsCandidateSpec, type MechanicsIR, type MechanicsSymbols } from "./mechanics-ir";
import { validateCompilerQuestionQueue, validateModuleCompileHints, type CompilerQuestion, type CompilerQuestionQueue, type CompilerQuestionResolution, type ModuleCompileHints } from "./compiler-question-queue";
import type { DraftModuleStructure } from "./deterministic-template-compiler";
import { validateSourceFactGraph, type FactInterpretationCandidate, type SourceFactGraph } from "./source-fact-graph";

export interface ResolvedDraftModule {
  resolvedQueue: CompilerQuestionQueue;
  acceptedInterpretations: FactInterpretationCandidate<MechanicsCandidateSpec>[];
  mechanicsIR?: MechanicsIR;
  analysisInput?: MechanicsAnalysisInput;
  reachabilityReport?: MechanicsReachabilityReport;
  readiness: DraftModuleStructure["readiness"];
  substitutedEnginePolicyInterpretationIds: string[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${label} hint value`);
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`undeclared ${label} field: ${key}`);
}

function candidate(question: CompilerQuestion, id: unknown, label: string): string {
  if (typeof id !== "string" || !(question.allowedCandidateIds ?? question.candidateIds ?? []).includes(id)) throw new Error(`unallowed ${label} candidate`);
  return id;
}

export function parseCompilerHintValue(question: CompilerQuestion, value: unknown): unknown {
  const input = object(value, question.kind);
  switch (question.kind) {
    case "scene_role": {
      only(input, ["role"], "scene_role");
      if (!(["playable_scene", "rules_section", "character_section", "ending_section", "other"] as string[]).includes(input.role as string)) throw new Error("invalid scene role");
      return { role: input.role };
    }
    case "entry_scene": only(input, ["sceneId"], "entry_scene"); return { sceneId: candidate(question, input.sceneId, "entry scene") };
    case "core_clue": {
      only(input, ["clueId", "required"], "core_clue");
      if (typeof input.required !== "boolean") throw new Error("core clue required must be boolean");
      if (input.clueId !== question.subjectCandidateId) throw new Error("core clue must match question subject");
      return { clueId: candidate(question, input.clueId, "core clue"), required: input.required };
    }
    case "connection_topology": {
      only(input, ["fromSceneId", "toSceneId", "connectionId", "availability", "onTraverse"], "connection_topology");
      if (input.fromSceneId !== question.subjectCandidateId) throw new Error("connection source must match question subject");
      const spec = parseMechanicsCandidateSpec({ kind: "connection_gate", id: `hint_connection_${String(input.connectionId)}`, connectionId: input.connectionId, ...(input.availability === undefined ? {} : { availability: input.availability }), ...(input.onTraverse === undefined ? {} : { onTraverse: input.onTraverse }) });
      if (spec.kind !== "connection_gate") throw new Error("invalid connection hint");
      return { fromSceneId: candidate(question, input.fromSceneId, "connection source"), toSceneId: candidate(question, input.toSceneId, "connection target"), connectionId: String(input.connectionId), spec };
    }
    case "ending_rule": {
      only(input, ["spec"], "ending_rule");
      const spec = parseMechanicsCandidateSpec(input.spec);
      if (spec.kind !== "ending_rule") throw new Error("ending hint requires EndingRuleSpec");
      return { spec };
    }
    case "check_spec": {
      only(input, ["discoveryMethodId", "check"], "check_spec");
      return { discoveryMethodId: String(input.discoveryMethodId), check: input.check as CheckSpec };
    }
    case "discovery_method": {
      only(input, ["spec"], "discovery_method");
      const spec = parseMechanicsCandidateSpec(input.spec);
      if (spec.kind !== "discovery_method") throw new Error("discovery hint requires DiscoveryMethodSpec");
      return { spec };
    }
    default: return input;
  }
}

export function applyModuleCompileHints(graph: SourceFactGraph, queue: CompilerQuestionQueue, hints: ModuleCompileHints): CompilerQuestionQueue {
  validateSourceFactGraph(graph);
  validateCompilerQuestionQueue(graph, queue);
  validateModuleCompileHints(queue, hints);
  const byId = new Map(hints.resolutions.map((resolution) => [resolution.questionId, resolution]));
  const questions = queue.questions.map((question) => {
    const resolution = byId.get(question.id);
    if (!resolution) return structuredClone(question);
    if (question.status === "answered" && JSON.stringify(question.resolution?.value) !== JSON.stringify(resolution.value)) throw new Error(`answered question conflict: ${question.id}`);
    return { ...structuredClone(question), status: "answered" as const, resolution: structuredClone(resolution) };
  });
  const next = { ...queue, questions, queueHash: "" };
  return withQueueHash(next);
}

function withQueueHash(queue: Omit<CompilerQuestionQueue, "queueHash"> & { queueHash: string }): CompilerQuestionQueue {
  const canonical = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return { ...queue, queueHash: sha256(canonical({ ...queue, queueHash: undefined })) };
}

function interpretation(question: CompilerQuestion, resolution: CompilerQuestionResolution, spec: MechanicsCandidateSpec): FactInterpretationCandidate<MechanicsCandidateSpec> {
  const id = `hint:${question.id}`;
  return { id, sourceStatementIds: [...question.sourceStatementIds], claim: { path: `mechanics.${spec.kind}.${spec.id}`, value: spec, domain: "gameplay_mechanic", authority: resolution.authority, derivation: "explicit", status: "accepted", evidenceRefs: [...question.evidenceRefs], sourceRef: null, confidence: null, reason: resolution.reason, rightsStatus: "user_provided", scope: {} }, interpretationStatus: "accepted", review: { interpretationId: id, decision: "accept", reason: resolution.reason, reviewerKind: resolution.reviewerKind, ...(resolution.policyId ? { policyId: resolution.policyId } : {}), reviewEvidenceStatementIds: [...question.sourceStatementIds] } };
}

export function resolveDraftModule(graph: SourceFactGraph, draft: DraftModuleStructure, queue: CompilerQuestionQueue, hints: ModuleCompileHints): ResolvedDraftModule {
  const resolvedQueue = applyModuleCompileHints(graph, queue, hints);
  const answered = resolvedQueue.questions.filter((question) => question.status === "answered" && question.resolution).map((question) => ({ question, resolution: question.resolution!, value: parseCompilerHintValue(question, question.resolution!.value) }));
  const playable = new Set(answered.filter((entry) => entry.question.kind === "scene_role" && (entry.value as { role: string }).role === "playable_scene").map((entry) => entry.question.subjectCandidateId).filter((id): id is string => id !== undefined));
  const entry = answered.find((item) => item.question.kind === "entry_scene")?.value as { sceneId: string } | undefined;
  const topology = answered.filter((item) => item.question.kind === "connection_topology").map((item) => item.value as { fromSceneId: string; toSceneId: string; connectionId: string; spec: ConnectionGateSpec });
  const core = answered.filter((item) => item.question.kind === "core_clue").map((item) => item.value as { clueId: string; required: boolean }).filter((item) => item.required).map((item) => item.clueId);
  const hintInterpretations = answered.filter((item) => item.question.kind === "connection_topology" || item.question.kind === "ending_rule" || item.question.kind === "discovery_method").map((item) => interpretation(item.question, item.resolution, (item.value as { spec: MechanicsCandidateSpec }).spec));
  const blocking = [...resolvedQueue.questions.filter((question) => question.severity === "publish_blocking" && question.status !== "answered").map((question) => question.blockingCode)];
  if (!entry || !playable.has(entry.sceneId) || topology.some((item) => !playable.has(item.fromSceneId) || !playable.has(item.toSceneId))) blocking.push("invalid_scene_resolution");
  const endingIds: string[] = [];
  for (const item of hintInterpretations) {
    const spec = item.claim.value as MechanicsCandidateSpec;
    if (spec.kind === "ending_rule") endingIds.push(...spec.effects.filter((effect) => effect.kind === "end_game").map((effect) => effect.endingId));
  }
  const symbols: MechanicsSymbols = { clueIds: draft.clueCandidates.map((clue) => clue.id), sceneIds: [...playable], itemIds: [], npcIds: [], connectionIds: topology.map((item) => item.connectionId), encounterIds: [], endingIds, rewardIds: [], declaredStateKeys: [] };
  const acceptedInterpretations = [...draft.interpretations, ...hintInterpretations];
  if (blocking.length || !entry || symbols.endingIds.length === 0) return { resolvedQueue, acceptedInterpretations, readiness: { ...draft.readiness, status: "draft_only", blockingCodes: [...new Set([...draft.readiness.blockingCodes, ...blocking, "missing_resolution"])] }, substitutedEnginePolicyInterpretationIds: [] };
  const mechanicsIR = compileMechanics({ ...graph, interpretations: acceptedInterpretations }, { moduleId: draft.moduleId, documentHash: draft.documentHash, sourceGraphSchemaVersion: graph.schemaVersion, symbols, acceptedInterpretationIds: acceptedInterpretations.map((item) => item.id), compilationMode: "compatible", allowedEnginePolicyIds: ["marked-item-observation-v1"] });
  const analysisInput: MechanicsAnalysisInput = { entrySceneId: entry.sceneId, initialState: { foundClueIds: [], visitedSceneIds: [], ownedItemIds: [], stateValues: {}, npcStates: {} }, coreClueIds: core, connections: topology.map((item) => ({ id: item.connectionId, fromSceneId: item.fromSceneId, toSceneId: item.toSceneId })), discoveryLocations: Object.fromEntries(mechanicsIR.discoveryMethods.map((method) => [method.id, method.targetId])), maxStates: 500 };
  const reachabilityReport = analyzeMechanicsReachability(mechanicsIR, analysisInput);
  const clean = !reachabilityReport.unreachableCoreClueIds.length && !reachabilityReport.unreachableEndingIds.length && !reachabilityReport.deadlockWitnesses.length && !reachabilityReport.failureDeadlockMethodIds.length && reachabilityReport.selectedTerminalEndingIds.length > 0;
  return { resolvedQueue, acceptedInterpretations, mechanicsIR, analysisInput, reachabilityReport, readiness: { ...draft.readiness, status: clean ? "mechanically_closed" : "draft_only", blockingCodes: clean ? [] : [...draft.readiness.blockingCodes, "reachability_incomplete"] }, substitutedEnginePolicyInterpretationIds: [] };
}
