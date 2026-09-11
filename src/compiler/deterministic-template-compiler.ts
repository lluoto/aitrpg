import { sha256, type EvidenceRef } from "../ingest/document-ir";
import { compileMechanics, sourceFactGraphIdentity, type MechanicsCandidateSpec, type MechanicsIR } from "./mechanics-ir";
import { validateSourceFactGraph, type FactInterpretationCandidate, type SourceFactGraph, type SourceStatement } from "./source-fact-graph";

export const DRAFT_MODULE_STRUCTURE_SCHEMA_VERSION = "1.0.0";
export const MARKED_ITEM_OBSERVATION_POLICY_ID = "marked-item-observation-v1";

export interface DraftSceneCandidate {
  id: string;
  headingStatementId: string;
  displayName: string;
  evidence: EvidenceRef;
  status: "candidate";
}

export interface DraftClueCandidate {
  id: string;
  markedItemStatementId: string;
  nameStatementId?: string;
  bodyStatementId: string;
  sceneCandidateId: string;
  displayName: string;
  importance: "unknown";
  evidence: EvidenceRef;
  status: "candidate";
}

export interface DraftReadinessReport {
  status: "draft_only" | "mechanically_closed";
  blockingCodes: string[];
  unresolvedStatementIds: string[];
  generatedMechanicIds: string[];
}

export interface DraftModuleStructure {
  schemaVersion: typeof DRAFT_MODULE_STRUCTURE_SCHEMA_VERSION;
  moduleId: string;
  documentHash: string | null;
  sourceGraphIdentity: string;
  sceneCandidates: DraftSceneCandidate[];
  clueCandidates: DraftClueCandidate[];
  interpretations: FactInterpretationCandidate<MechanicsCandidateSpec>[];
  mechanicsIR?: MechanicsIR;
  readiness: DraftReadinessReport;
}

export interface DeterministicTemplateCompilationInput {
  moduleId: string;
}

function documentIdentity(graph: SourceFactGraph): string {
  return graph.documentIdentity.documentHash ?? `synthetic:${graph.documentIdentity.sourceDescriptor ?? "unspecified"}`;
}

function evidenceLocations(evidence: EvidenceRef): string {
  return evidence.spans.map((span) => `${span.pageNumber}:${span.rawStart}:${span.rawEnd}`).join("|");
}

function draftId(graph: SourceFactGraph, evidence: EvidenceRef, role: "scene" | "clue" | "mechanic" | "interpretation"): string {
  return `draft_${role}_${sha256(`${documentIdentity(graph)}|${role}|${evidenceLocations(evidence)}`).slice(0, 24)}`;
}

function relationTarget(graph: SourceFactGraph, from: string, kind: "marked_item_name" | "marked_item_body" | "heading_scopes"): SourceStatement | undefined {
  const relation = graph.relations.find((candidate) => candidate.kind === kind && candidate.to === from);
  if (kind === "heading_scopes") return relation ? graph.statements.find((statement) => statement.id === relation.from) : undefined;
  return relation ? graph.statements.find((statement) => statement.id === relation.to) : undefined;
}

function childStatement(graph: SourceFactGraph, parentId: string, kind: "marked_item_name" | "marked_item_body"): SourceStatement | undefined {
  const relation = graph.relations.find((candidate) => candidate.kind === kind && candidate.from === parentId);
  return relation ? graph.statements.find((statement) => statement.id === relation.to) : undefined;
}

function statementRefs(statements: SourceStatement[]): string[] {
  return statements.map((statement) => statement.evidenceRefId);
}

function templateInterpretation(
  graph: SourceFactGraph,
  moduleId: string,
  clue: DraftClueCandidate,
  heading: SourceStatement,
  whole: SourceStatement,
  name: SourceStatement,
  body: SourceStatement,
): FactInterpretationCandidate<MechanicsCandidateSpec> {
  const id = draftId(graph, whole.evidence, "interpretation");
  const mechanicId = draftId(graph, whole.evidence, "mechanic");
  const sources = [whole, body, heading, name];
  const sourceStatementIds = [...new Set(sources.map((statement) => statement.id))];
  const value: MechanicsCandidateSpec = {
    kind: "discovery_method",
    id: mechanicId,
    clueId: clue.id,
    action: "observe",
    target: "scene",
    targetId: clue.sceneCandidateId,
    check: { kind: "none" },
    onSuccess: [{ kind: "discover_clue", clueId: clue.id }],
  };
  return {
    id,
    sourceStatementIds,
    claim: {
      path: `mechanics.discovery_method.${mechanicId}`,
      value,
      domain: "gameplay_mechanic",
      authority: "engine_policy",
      derivation: "default",
      status: "accepted",
      evidenceRefs: statementRefs(sources),
      sourceRef: null,
      confidence: null,
      reason: "Engine default observation mechanism for an explicit marked item; not a source claim about checks or importance.",
      rightsStatus: "project_owned",
      scope: { moduleId },
    },
    interpretationStatus: "accepted",
    review: {
      interpretationId: id,
      decision: "accept",
      reason: "Approved deterministic default for a named marked item under an explicit heading scope.",
      reviewerKind: "approved_policy",
      policyId: MARKED_ITEM_OBSERVATION_POLICY_ID,
      reviewEvidenceStatementIds: sourceStatementIds,
    },
  };
}

/**
 * Compiles only explicit marked-item structure into draft candidates. It never
 * derives gameplay facts from prose or creates a publishable module topology.
 */
export function compileDeterministicTemplates(
  graph: SourceFactGraph,
  input: DeterministicTemplateCompilationInput,
): DraftModuleStructure {
  validateSourceFactGraph(graph);
  if (!input.moduleId.trim()) throw new Error("template moduleId is required");
  const sourceGraphId = sourceFactGraphIdentity(graph);
  const headingStatements = graph.statements.filter((statement) => statement.kind === "heading");
  const sceneCandidates = headingStatements.map((heading) => ({
    id: draftId(graph, heading.evidence, "scene"),
    headingStatementId: heading.id,
    displayName: heading.text.trim(),
    evidence: heading.evidence,
    status: "candidate" as const,
  }));
  const scenesByHeading = new Map(sceneCandidates.map((scene) => [scene.headingStatementId, scene]));
  const clueCandidates: DraftClueCandidate[] = [];
  const interpretations: FactInterpretationCandidate<MechanicsCandidateSpec>[] = [];
  const unresolvedStatementIds = new Set<string>();

  for (const whole of graph.statements.filter((statement) => statement.kind === "marked_item")) {
    const heading = relationTarget(graph, whole.id, "heading_scopes");
    const name = childStatement(graph, whole.id, "marked_item_name");
    const body = childStatement(graph, whole.id, "marked_item_body");
    if (!heading || !scenesByHeading.has(heading.id)) {
      unresolvedStatementIds.add(whole.id);
      continue;
    }
    if (!name || !name.text.trim()) {
      unresolvedStatementIds.add(whole.id);
      continue;
    }
    if (!body || !body.text.trim() || body.evidence.spans.length === 0) {
      unresolvedStatementIds.add(whole.id);
      continue;
    }
    const scene = scenesByHeading.get(heading.id)!;
    const clue: DraftClueCandidate = {
      id: draftId(graph, whole.evidence, "clue"),
      markedItemStatementId: whole.id,
      nameStatementId: name.id,
      bodyStatementId: body.id,
      sceneCandidateId: scene.id,
      displayName: name.text.trim(),
      importance: "unknown",
      evidence: whole.evidence,
      status: "candidate",
    };
    clueCandidates.push(clue);
    interpretations.push(templateInterpretation(graph, input.moduleId, clue, heading, whole, name, body));
  }

  const symbols = {
    clueIds: clueCandidates.map((clue) => clue.id),
    sceneIds: sceneCandidates.map((scene) => scene.id),
    itemIds: [], npcIds: [], connectionIds: [], encounterIds: [], endingIds: [], rewardIds: [], declaredStateKeys: [],
  };
  const mechanicsIR = interpretations.length === 0 ? undefined : compileMechanics(
    { ...graph, interpretations },
    {
      moduleId: input.moduleId,
      documentHash: graph.documentIdentity.documentHash,
      sourceGraphSchemaVersion: graph.schemaVersion,
      symbols,
      acceptedInterpretationIds: interpretations.map((interpretation) => interpretation.id),
      compilationMode: "compatible",
      allowedEnginePolicyIds: [MARKED_ITEM_OBSERVATION_POLICY_ID],
    },
  );
  const generatedMechanicIds = mechanicsIR?.discoveryMethods.map((method) => method.id).sort() ?? [];
  return {
    schemaVersion: DRAFT_MODULE_STRUCTURE_SCHEMA_VERSION,
    moduleId: input.moduleId,
    documentHash: graph.documentIdentity.documentHash,
    sourceGraphIdentity: sourceGraphId,
    sceneCandidates,
    clueCandidates,
    interpretations,
    ...(mechanicsIR ? { mechanicsIR } : {}),
    readiness: {
      status: "draft_only",
      blockingCodes: ["unresolved_scene_candidates", "missing_entry_scene", "missing_ending_rules", "missing_connection_topology"],
      unresolvedStatementIds: [...unresolvedStatementIds].sort(),
      generatedMechanicIds,
    },
  };
}
