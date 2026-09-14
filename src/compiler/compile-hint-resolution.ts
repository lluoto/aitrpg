import { analyzeMechanicsReachability, type MechanicsAnalysisInput, type MechanicsReachabilityReport } from "./mechanics-reachability";
import { compileMechanics, type MechanicsCandidateSpec, type MechanicsIR, type MechanicsSymbols } from "./mechanics-ir";
import { buildCompilerQuestionQueue, parseCompilerHintValue, validateCompilerQuestionQueue, validateModuleCompileHints, withQueueHash, type CompilerQuestion, type CompilerQuestionQueue, type CompilerQuestionResolution, type ModuleCompileHints, type ParsedCompilerHintValue } from "./compiler-question-queue";
import { compileDeterministicTemplates, type DraftModuleStructure, type DraftReadinessReport } from "./deterministic-template-compiler";
import { validateSourceFactGraph, type FactInterpretationCandidate, type SourceFactGraph } from "./source-fact-graph";

export { parseCompilerHintValue } from "./compiler-question-queue";

export interface ResolvedDraftModule {
  resolvedQueue: CompilerQuestionQueue;
  acceptedInterpretations: FactInterpretationCandidate<MechanicsCandidateSpec>[];
  mechanicsIR?: MechanicsIR;
  analysisInput?: MechanicsAnalysisInput;
  reachabilityReport?: MechanicsReachabilityReport;
  readiness: DraftReadinessReport;
  substitutedEnginePolicyInterpretationIds: string[];
}

function uniqueSorted(values: readonly string[]): string[] { return [...new Set(values)].sort(); }

export function applyModuleCompileHints(graph: SourceFactGraph, queue: CompilerQuestionQueue, hints: ModuleCompileHints): CompilerQuestionQueue {
  validateSourceFactGraph(graph);
  validateCompilerQuestionQueue(graph, queue);
  validateModuleCompileHints(queue, hints);
  const byId = new Map(hints.resolutions.map((resolution) => [resolution.questionId, resolution]));
  const questions = queue.questions.map((question) => {
    const resolution = byId.get(question.id);
    if (!resolution) return structuredClone(question);
    return { ...structuredClone(question), status: "answered" as const, resolution: structuredClone(resolution) };
  });
  const next = withQueueHash({ ...queue, questions });
  validateCompilerQuestionQueue(graph, next);
  return next;
}

function interpretation(question: CompilerQuestion, resolution: CompilerQuestionResolution, spec: MechanicsCandidateSpec, suffix: string): FactInterpretationCandidate<MechanicsCandidateSpec> {
  const id = `hint:${question.id}:${suffix}`;
  return {
    id,
    sourceStatementIds: [...question.sourceStatementIds],
    claim: {
      path: `mechanics.${spec.kind}.${spec.id}`,
      value: spec,
      domain: "gameplay_mechanic",
      authority: resolution.authority,
      derivation: resolution.derivation,
      status: "accepted",
      evidenceRefs: [...question.evidenceRefs],
      sourceRef: null,
      confidence: null,
      reason: resolution.reason,
      rightsStatus: resolution.rightsStatus,
      scope: { moduleId: "" },
    },
    interpretationStatus: "accepted",
    review: {
      interpretationId: id,
      decision: "accept",
      reason: resolution.reason,
      reviewerKind: resolution.reviewerKind,
      ...(resolution.policyId ? { policyId: resolution.policyId } : {}),
      reviewEvidenceStatementIds: [...question.sourceStatementIds],
    },
  };
}

function withModuleScope(moduleId: string, candidate: FactInterpretationCandidate<MechanicsCandidateSpec>): FactInterpretationCandidate<MechanicsCandidateSpec> {
  return { ...candidate, sourceStatementIds: [...candidate.sourceStatementIds], claim: { ...candidate.claim, evidenceRefs: [...candidate.claim.evidenceRefs], scope: { moduleId } }, review: candidate.review && { ...candidate.review, reviewEvidenceStatementIds: [...candidate.review.reviewEvidenceStatementIds!] } };
}


function mechanismIds(ir: MechanicsIR): string[] { return [...ir.discoveryMethods, ...ir.connections, ...ir.transitions, ...ir.endings].map((node) => node.id).sort(); }

function deriveReadiness(draft: DraftModuleStructure, queue: CompilerQuestionQueue, status: DraftReadinessReport["status"], generatedMechanicIds: string[], extraBlockingCodes: string[] = []): DraftReadinessReport {
  const open = queue.questions.filter((question) => question.status === "open").map((question) => question.id).sort();
  const publishBlocking = queue.questions.filter((question) => question.severity === "publish_blocking" && question.status !== "answered").map((question) => question.id).sort();
  const blockingCodes = queue.questions.filter((question) => question.severity === "publish_blocking" && question.status !== "answered").map((question) => question.blockingCode);
  return {
    status,
    blockingCodes: uniqueSorted([...blockingCodes, ...extraBlockingCodes]),
    unresolvedStatementIds: [...draft.readiness.unresolvedStatementIds].sort(),
    generatedMechanicIds: uniqueSorted(generatedMechanicIds),
    questionQueueHash: queue.queueHash,
    openQuestionIds: open,
    publishBlockingQuestionIds: publishBlocking,
  };
}

function assertDraftIdentity(graph: SourceFactGraph, draft: DraftModuleStructure, queue: CompilerQuestionQueue): void {
  if (!draft.moduleId.trim() || queue.moduleId !== draft.moduleId) throw new Error("draft_queue_module_mismatch");
  if (draft.documentHash !== graph.documentIdentity.documentHash || draft.sourceGraphIdentity !== queue.sourceGraphIdentity) throw new Error("draft_queue_identity_mismatch");
  const generated = buildCompilerQuestionQueue(graph, draft);
  if (queue.queueHash !== draft.readiness.questionQueueHash || queue.queueHash !== generated.queueHash) throw new Error("draft_queue_semantic_mismatch");
}

interface DefaultDiscoveryBinding { interpretationId: string; methodId: string; clueId: string; locationSceneId: string; }

/**
 * Default observation is located by the marked item's graph heading scope.
 * Its mechanics target is independently validated and never supplies location.
 */
function defaultDiscoveryBinding(graph: SourceFactGraph, draft: DraftModuleStructure, canonical: DraftModuleStructure, candidate: FactInterpretationCandidate<MechanicsCandidateSpec>): DefaultDiscoveryBinding | undefined {
  if (candidate.claim.authority !== "engine_policy") return undefined;
  const spec = candidate.claim.value;
  if (!spec || spec.kind !== "discovery_method") return undefined;
  const clue = draft.clueCandidates.find((entry) => entry.id === spec.clueId);
  if (!clue) return undefined;
  const scene = draft.sceneCandidates.find((entry) => entry.id === clue.sceneCandidateId);
  if (!scene || candidate.claim.scope.moduleId !== draft.moduleId || spec.target !== "scene" || spec.targetId !== scene.id) return undefined;
  const originalClue = canonical.clueCandidates.find((entry) => entry.markedItemStatementId === clue.markedItemStatementId);
  const originalScene = canonical.sceneCandidates.find((entry) => entry.id === scene.id);
  const originalPolicy = canonical.interpretations.find((entry) => entry.id === candidate.id);
  const originalSpec = originalPolicy?.claim.value;
  if (!originalSpec || originalSpec.kind !== "discovery_method" || !originalClue || originalClue.id !== clue.id || originalClue.nameStatementId !== clue.nameStatementId || originalClue.bodyStatementId !== clue.bodyStatementId || originalClue.sceneCandidateId !== scene.id || originalScene?.headingStatementId !== scene.headingStatementId || originalSpec.id !== spec.id || originalSpec.clueId !== clue.id) return undefined;
  const scoped = graph.relations.some((relation) => relation.kind === "heading_scopes" && relation.from === scene.headingStatementId && relation.to === clue.markedItemStatementId);
  const heading = graph.statements.find((statement) => statement.id === scene.headingStatementId);
  const marked = graph.statements.find((statement) => statement.id === clue.markedItemStatementId);
  const children = [[clue.nameStatementId, "marked_item_name"], [clue.bodyStatementId, "marked_item_body"]] as const;
  if (heading?.kind !== "heading" || marked?.kind !== "marked_item" || marked.parentStatementId !== heading.id || !children.every(([id, kind]) => {
    const statement = graph.statements.find((statement) => statement.id === id);
    return statement?.kind === kind && statement.parentStatementId === marked.id && graph.relations.some((relation) => relation.kind === kind && relation.from === marked.id && relation.to === id);
  })) return undefined;
  const requiredStatements = [scene.headingStatementId, clue.markedItemStatementId, clue.bodyStatementId, clue.nameStatementId].filter((id): id is string => Boolean(id));
  const requiredEvidence = requiredStatements.map((id) => graph.statements.find((statement) => statement.id === id)?.evidenceRefId).filter((id): id is string => Boolean(id));
  if (!scoped || !requiredStatements.every((id) => candidate.sourceStatementIds.includes(id) && candidate.review?.reviewEvidenceStatementIds?.includes(id)) || !requiredEvidence.every((id) => candidate.claim.evidenceRefs.includes(id))) return undefined;
  return { interpretationId: candidate.id, methodId: spec.id, clueId: clue.id, locationSceneId: scene.id };
}

export function resolveDraftModule(graph: SourceFactGraph, draft: DraftModuleStructure, queue: CompilerQuestionQueue, hints: ModuleCompileHints): ResolvedDraftModule {
  validateSourceFactGraph(graph);
  assertDraftIdentity(graph, draft, queue);
  // Audit original candidates before replacement, without replacement-only symbols or claims.
  const draftGraph = { ...graph, interpretations: draft.interpretations };
  validateSourceFactGraph(draftGraph);
  const canonical = compileDeterministicTemplates(graph, { moduleId: draft.moduleId });
  const originalSymbols: MechanicsSymbols = {
    clueIds: canonical.clueCandidates.map((clue) => clue.id), sceneIds: canonical.sceneCandidates.map((scene) => scene.id),
    itemIds: [], npcIds: [], connectionIds: [], encounterIds: [], endingIds: [], rewardIds: [], declaredStateKeys: [],
  };
  for (const candidate of draft.interpretations) {
    if (candidate.claim.authority === "engine_policy") compileMechanics({ ...draftGraph, interpretations: [candidate] }, {
      moduleId: draft.moduleId, documentHash: draft.documentHash, sourceGraphSchemaVersion: graph.schemaVersion,
      symbols: originalSymbols, acceptedInterpretationIds: [candidate.id], compilationMode: "compatible", allowedEnginePolicyIds: ["marked-item-observation-v1"],
    });
  }
  const resolvedQueue = applyModuleCompileHints(graph, queue, hints);
  const answered = resolvedQueue.questions
    .filter((question) => question.status === "answered" && question.resolution)
    .map((question) => ({ question, resolution: question.resolution!, value: parseCompilerHintValue(question, question.resolution!.value) }));
  const playable = new Set(answered.filter((entry) => entry.value.kind === "scene_role" && entry.value.role === "playable_scene").map((entry) => entry.question.subjectCandidateId).filter((id): id is string => id !== undefined));
  const entry = answered.find((entry): entry is typeof entry & { value: Extract<ParsedCompilerHintValue, { kind: "entry_scene" }> } => entry.value.kind === "entry_scene")?.value;
  const topology = answered.filter((entry): entry is typeof entry & { value: Extract<ParsedCompilerHintValue, { kind: "connection_topology" }> } => entry.value.kind === "connection_topology").flatMap((entry) => entry.value.connections);
  const core = answered.filter((entry): entry is typeof entry & { value: Extract<ParsedCompilerHintValue, { kind: "core_clue" }> } => entry.value.kind === "core_clue" && entry.value.required).map((entry) => entry.value.clueId);
  const endingDeclarations = answered.filter((entry): entry is typeof entry & { value: Extract<ParsedCompilerHintValue, { kind: "ending_rule" }> } => entry.value.kind === "ending_rule").flatMap((entry) => entry.value.declarations.map((declaration) => ({ ...declaration, question: entry.question, resolution: entry.resolution })));
  const discoveries = answered.filter((entry): entry is typeof entry & { value: Extract<ParsedCompilerHintValue, { kind: "discovery_method" }> } => entry.value.kind === "discovery_method");
  const blocking: string[] = [];
  if (!entry || !playable.has(entry.sceneId)) blocking.push("invalid_scene_resolution");
  if (discoveries.some((entry) => !playable.has(entry.value.locationSceneId))) blocking.push("invalid_scene_resolution");
  if (topology.some((item) => !playable.has(item.fromSceneId) || !playable.has(item.toSceneId))) blocking.push("invalid_scene_resolution");
  if (new Set(topology.map((item) => item.connectionId)).size !== topology.length) blocking.push("duplicate_connection_declaration");
  if (new Set(endingDeclarations.map((item) => item.endingId)).size !== endingDeclarations.length) blocking.push("duplicate_ending_declaration");
  const defaultBindings = new Map<string, DefaultDiscoveryBinding>();
  const invalidDefaultInterpretationIds: string[] = [];
  for (const candidate of draft.interpretations) {
    if (candidate.claim.authority !== "engine_policy" || !candidate.claim.value || candidate.claim.value.kind !== "discovery_method") continue;
    const binding = defaultDiscoveryBinding(graph, draft, canonical, candidate);
    if (!binding) invalidDefaultInterpretationIds.push(candidate.id);
    else defaultBindings.set(candidate.id, binding);
  }
  if (invalidDefaultInterpretationIds.length) blocking.push("invalid_default_discovery_binding");
  const hintInterpretations = [
    ...answered.filter((entry): entry is typeof entry & { value: Extract<ParsedCompilerHintValue, { kind: "connection_topology" }> } => entry.value.kind === "connection_topology").flatMap((entry) => entry.value.connections.map((connection) => withModuleScope(draft.moduleId, interpretation(entry.question, entry.resolution, connection.spec, `connection:${connection.connectionId}`)))),
    ...endingDeclarations.map((declaration) => withModuleScope(draft.moduleId, interpretation(declaration.question, declaration.resolution, declaration.spec, `ending:${declaration.endingId}`))),
    ...discoveries.map((entry) => withModuleScope(draft.moduleId, interpretation(entry.question, entry.resolution, entry.value.spec, `discovery:${entry.value.spec.id}`))),
  ];
  const hintedLocations = new Map(discoveries.map((entry) => [entry.value.spec.id, entry.value.locationSceneId]));
  const explicitDiscoveryBindings = new Set(discoveries.map((entry) => `${entry.value.clueId}:${entry.value.locationSceneId}`));
  const substitutedEnginePolicyInterpretationIds = draft.interpretations.filter((candidate) => {
    const binding = defaultBindings.get(candidate.id);
    return binding !== undefined && explicitDiscoveryBindings.has(`${binding.clueId}:${binding.locationSceneId}`);
  }).map((candidate) => candidate.id).sort();
  const acceptedDefaults = draft.interpretations.filter((candidate) => !substitutedEnginePolicyInterpretationIds.includes(candidate.id)).filter((candidate) => {
    if (candidate.claim.authority !== "engine_policy" || !candidate.claim.value || candidate.claim.value.kind !== "discovery_method") return true;
    const binding = defaultBindings.get(candidate.id);
    if (!binding || !playable.has(binding.locationSceneId)) {
      blocking.push("invalid_default_discovery_binding");
      return false;
    }
    return true;
  });
  const acceptedInterpretations = structuredClone([...acceptedDefaults, ...hintInterpretations]);
  const symbols: MechanicsSymbols = {
    clueIds: draft.clueCandidates.map((clue) => clue.id).sort(),
    sceneIds: [...playable].sort(),
    itemIds: [], npcIds: [],
    connectionIds: topology.map((item) => item.connectionId).sort(),
    encounterIds: [],
    endingIds: endingDeclarations.map((item) => item.endingId).sort(),
    rewardIds: [],
    // state_key remains unsupported: reference never grants write authority.
    declaredStateKeys: [],
  };
  const baseReadiness = deriveReadiness(draft, resolvedQueue, "draft_only", [], blocking);
  if (baseReadiness.publishBlockingQuestionIds.length || blocking.length || !entry || symbols.endingIds.length === 0) {
    return { resolvedQueue, acceptedInterpretations, readiness: deriveReadiness(draft, resolvedQueue, "draft_only", [], [...blocking, ...(symbols.endingIds.length ? [] : ["missing_ending_rules"])]), substitutedEnginePolicyInterpretationIds };
  }
  const mechanicsIR = compileMechanics({ ...graph, interpretations: acceptedInterpretations }, {
    moduleId: draft.moduleId,
    documentHash: draft.documentHash,
    sourceGraphSchemaVersion: graph.schemaVersion,
    symbols,
    acceptedInterpretationIds: acceptedInterpretations.map((candidate) => candidate.id),
    compilationMode: "compatible",
    allowedEnginePolicyIds: ["marked-item-observation-v1"],
  });
  const retainedDefaultBindings = [...defaultBindings.values()].filter((binding) => acceptedDefaults.some((candidate) => candidate.id === binding.interpretationId));
  const discoveryLocations: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const method of mechanicsIR.discoveryMethods) {
    const binding = retainedDefaultBindings.find((binding) => binding.methodId === method.id && binding.clueId === method.clueId && method.sourceInterpretationIds.length === 1 && method.sourceInterpretationIds[0] === binding.interpretationId);
    const location = hintedLocations.get(method.id) ?? binding?.locationSceneId;
    if (!location) {
      return { resolvedQueue, acceptedInterpretations, readiness: deriveReadiness(draft, resolvedQueue, "draft_only", [], ["missing_verified_discovery_location"]), substitutedEnginePolicyInterpretationIds };
    }
    discoveryLocations[method.id] = location;
  }
  const analysisInput: MechanicsAnalysisInput = {
    entrySceneId: entry.sceneId,
    initialState: { foundClueIds: [], visitedSceneIds: [], ownedItemIds: [], stateValues: {}, npcStates: {} },
    coreClueIds: uniqueSorted(core),
    connections: topology.map((item) => ({ id: item.connectionId, fromSceneId: item.fromSceneId, toSceneId: item.toSceneId })),
    discoveryLocations,
    maxStates: 500,
  };
  const reachabilityReport = analyzeMechanicsReachability(mechanicsIR, analysisInput);
  const clean = !reachabilityReport.unreachableCoreClueIds.length && !reachabilityReport.unreachableEndingIds.length && !reachabilityReport.deadlockWitnesses.length && !reachabilityReport.failurePolicyRiskMethodIds.length && reachabilityReport.selectedTerminalEndingIds.length > 0;
  return {
    resolvedQueue,
    acceptedInterpretations,
    mechanicsIR,
    analysisInput,
    reachabilityReport,
    readiness: deriveReadiness(draft, resolvedQueue, clean ? "mechanically_closed" : "draft_only", mechanismIds(mechanicsIR), clean ? [] : ["reachability_incomplete"]),
    substitutedEnginePolicyInterpretationIds,
  };
}
