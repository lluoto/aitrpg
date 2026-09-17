import { createResolvedCompilerArtifact, type CompilerArtifactEnvelope, type CompilerArtifactRefusal, type ResolvedCompilerArtifactIdentity, type ResolvedCompilerArtifactPayload } from "./compiler-artifact";
import type { EvidenceRef } from "../ingest/document-ir";
import type { MechanicsIR } from "./mechanics-ir";
import type { Clue, Ending, ModuleData, Scene, SceneConnection } from "../module/types";

export interface ModuleDataPresentationMetadata {
  module: {
    title: string;
    version: string;
    ruleset: ModuleData["ruleset"];
    era: string;
    summary: string;
    playerCount: string;
    expectedDuration: string;
    triggerWarnings: string[];
  };
  scenes: Record<string, { description: string }>;
  connections: Record<string, { condition: string }>;
  clues: Record<string, { findMethods: Clue["findMethods"]; revelation: string; unlocks: string[]; importance: Clue["importance"] }>;
  endings: Record<string, { name: string; description: string; conditions: string[] }>;
}

export interface ProjectionStatementEvidence {
  statementId: string;
  evidenceRefId: string;
  evidence: EvidenceRef;
}

export type ProjectionFieldOrigin =
  | { kind: "source_exact"; statements: ProjectionStatementEvidence[] }
  | { kind: "resolved_interpretation"; interpretationIds: string[]; statements: ProjectionStatementEvidence[] }
  | { kind: "artifact"; artifactPath: string }
  | { kind: "caller_metadata"; metadataPath: string };

export interface ModuleDataProjectionSourceMap {
  scenes: Record<string, {
    fields: Record<string, ProjectionFieldOrigin>;
    clues: Record<string, { fields: Record<string, ProjectionFieldOrigin> }>;
    connections: Record<string, { fields: Record<string, ProjectionFieldOrigin> }>;
  }>;
  endings: Record<string, { fields: Record<string, ProjectionFieldOrigin> }>;
}

export interface CompilerModuleDataProjection {
  status: "projected";
  module: ModuleData;
  entrySceneId: string;
  artifact: { artifactHash: string; identity: ResolvedCompilerArtifactIdentity };
  mechanics: Pick<MechanicsIR, "moduleId" | "documentHash" | "sourceGraphIdentity" | "mechanicsHash">;
  sourceMap: ModuleDataProjectionSourceMap;
}

export type CompilerModuleDataProjectionRefusalCode = "ARTIFACT_INVALID" | "MECHANICS_IDENTITY_MISMATCH" | "PRESENTATION_METADATA_INVALID";
export interface CompilerModuleDataProjectionRefusal {
  status: "refused";
  code: CompilerModuleDataProjectionRefusalCode;
  message: string;
  artifactCode?: CompilerArtifactRefusal["code"];
}

class ProjectionDataError extends Error {
  constructor(message: string) { super(message); this.name = "ProjectionDataError"; }
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new ProjectionDataError(`${label} metadata keys must exactly match compiler IDs`);
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new ProjectionDataError(`${label} is required presentation metadata`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertFindMethods(value: unknown, label: string): asserts value is Clue["findMethods"] {
  if (!Array.isArray(value) || value.some((method) => !isRecord(method)
    || !["skill", "observation", "npc_dialogue", "item", "automatic"].includes(method.type as string)
    || typeof method.description !== "string" || !method.description.trim()
    || (method.skillName !== undefined && typeof method.skillName !== "string")
    || (method.difficulty !== undefined && !["regular", "hard", "extreme"].includes(method.difficulty as string)))) {
    throw new ProjectionDataError(`${label} has an invalid findMethods value`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new ProjectionDataError(`${label} must be a non-blank string array`);
  }
}

function sourceEvidence(payload: ResolvedCompilerArtifactPayload, statementIds: readonly string[]): ProjectionStatementEvidence[] {
  return statementIds.map((statementId) => {
    const statement = payload.graph.statements.find((candidate) => candidate.id === statementId);
    if (!statement) throw new ProjectionDataError(`missing source statement: ${statementId}`);
    return { statementId, evidenceRefId: statement.evidenceRefId, evidence: statement.evidence };
  });
}

function interpretationEvidence(payload: ResolvedCompilerArtifactPayload, interpretationIds: readonly string[]): ProjectionFieldOrigin {
  const statementIds = [...new Set(interpretationIds.flatMap((id) => {
    const interpretation = payload.acceptedInterpretations.find((candidate) => candidate.id === id);
    if (!interpretation) throw new ProjectionDataError(`missing accepted interpretation: ${id}`);
    return interpretation.sourceStatementIds;
  }))].sort();
  return { kind: "resolved_interpretation", interpretationIds: [...interpretationIds].sort(), statements: sourceEvidence(payload, statementIds) };
}

function artifactOrigin(path: string): ProjectionFieldOrigin { return { kind: "artifact", artifactPath: path }; }
function metadataOrigin(path: string): ProjectionFieldOrigin { return { kind: "caller_metadata", metadataPath: path }; }
function sourceOrigin(payload: ResolvedCompilerArtifactPayload, statementIds: readonly string[]): ProjectionFieldOrigin { return { kind: "source_exact", statements: sourceEvidence(payload, statementIds) }; }

function refusal(code: CompilerModuleDataProjectionRefusalCode, error: unknown, artifactCode?: CompilerArtifactRefusal["code"]): CompilerModuleDataProjectionRefusal {
  return { status: "refused", code, message: error instanceof Error ? error.message : String(error), ...(artifactCode ? { artifactCode } : {}) };
}

/** Project a complete resolved artifact into presentation data without making ModuleData authoritative mechanics. */
export function projectResolvedCompilerArtifact(
  payload: ResolvedCompilerArtifactPayload,
  presentation: ModuleDataPresentationMetadata,
): CompilerModuleDataProjection | CompilerModuleDataProjectionRefusal {
  let envelope: CompilerArtifactEnvelope;
  try {
    envelope = createResolvedCompilerArtifact(payload);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return refusal("ARTIFACT_INVALID", error, typeof code === "string" ? code as CompilerArtifactRefusal["code"] : undefined);
  }
  const resolved = envelope.payload as ResolvedCompilerArtifactPayload;
  if (resolved.identity.mechanicsHash !== resolved.mechanicsIR.mechanicsHash || resolved.identity.moduleId !== resolved.mechanicsIR.moduleId || resolved.identity.documentHash !== resolved.mechanicsIR.documentHash || resolved.identity.sourceGraphIdentity !== resolved.mechanicsIR.sourceGraphIdentity) {
    return refusal("MECHANICS_IDENTITY_MISMATCH", "artifact and MechanicsIR identities do not agree");
  }
  try {
    if (presentation.module.ruleset !== "cosmic-horror") throw new ProjectionDataError("compiled modules require the cosmic-horror ruleset");
    const playableIds = [...resolved.mechanicsIR.symbols.sceneIds].sort();
    const clueIds = [...resolved.mechanicsIR.symbols.clueIds].sort();
    const connectionIds = [...resolved.analysisInput.connections.map((connection) => connection.id)].sort();
    const endingById = new Map(resolved.mechanicsIR.endings.map((ending) => {
      const effect = ending.effects.find((candidate) => candidate.kind === "end_game");
      if (!effect) throw new ProjectionDataError(`ending lacks end_game: ${ending.id}`);
      return [effect.endingId, ending] as const;
    }));
    const endingIds = [...endingById.keys()].sort();
    assertExactKeys(presentation.scenes, playableIds, "scene");
    assertExactKeys(presentation.clues, clueIds, "clue");
    assertExactKeys(presentation.connections, connectionIds, "connection");
    assertExactKeys(presentation.endings, endingIds, "ending");
    for (const [label, value] of Object.entries(presentation.module)) {
      if (typeof value === "string") requiredText(value, `module.${label}`);
      if (Array.isArray(value) && value.some((entry) => !entry.trim())) throw new ProjectionDataError(`module.${label} contains blank metadata`);
    }
    const sourceMap: ModuleDataProjectionSourceMap = { scenes: Object.create(null), endings: Object.create(null) };
    const connectionsByScene = new Map(playableIds.map((id) => [id, [] as typeof resolved.analysisInput.connections]));
    for (const connection of resolved.analysisInput.connections) connectionsByScene.get(connection.fromSceneId)?.push(connection);
    const cluesByScene = new Map(playableIds.map((id) => [id, [] as typeof resolved.draft.clueCandidates]));
    for (const clue of resolved.draft.clueCandidates) {
      if (!clueIds.includes(clue.id)) continue;
      cluesByScene.get(clue.sceneCandidateId)?.push(clue);
    }
    const scenes: Scene[] = playableIds.map((sceneId) => {
      const candidate = resolved.draft.sceneCandidates.find((scene) => scene.id === sceneId);
      if (!candidate) throw new ProjectionDataError(`playable scene candidate missing: ${sceneId}`);
      const heading = resolved.graph.statements.find((statement) => statement.id === candidate.headingStatementId);
      if (!heading) throw new ProjectionDataError(`scene heading statement missing: ${sceneId}`);
      const sceneMetadata = presentation.scenes[sceneId]!;
      requiredText(sceneMetadata.description, `scenes.${sceneId}.description`);
      const map = { fields: Object.create(null) as Record<string, ProjectionFieldOrigin>, clues: Object.create(null) as Record<string, { fields: Record<string, ProjectionFieldOrigin> }>, connections: Object.create(null) as Record<string, { fields: Record<string, ProjectionFieldOrigin> }> };
      map.fields.id = artifactOrigin(`draft.sceneCandidates[${sceneId}].id`);
      map.fields.name = sourceOrigin(resolved, [heading.id]);
      map.fields.description = metadataOrigin(`scenes.${sceneId}.description`);
      const clues: Clue[] = (cluesByScene.get(sceneId) ?? []).sort((left, right) => left.id.localeCompare(right.id)).map((clue) => {
        const metadata = presentation.clues[clue.id]!;
        requiredText(metadata.revelation, `clues.${clue.id}.revelation`);
        assertFindMethods(metadata.findMethods, `clues.${clue.id}`);
        assertStringArray(metadata.unlocks, `clues.${clue.id}.unlocks`);
        if (!["core", "bonus", "color"].includes(metadata.importance)) throw new ProjectionDataError(`clues.${clue.id}.importance is invalid`);
        const nameStatement = clue.nameStatementId && resolved.graph.statements.find((statement) => statement.id === clue.nameStatementId);
        const bodyStatement = resolved.graph.statements.find((statement) => statement.id === clue.bodyStatementId);
        if (!nameStatement || !bodyStatement) throw new ProjectionDataError(`clue source statements missing: ${clue.id}`);
        map.clues[clue.id] = { fields: {
          id: artifactOrigin(`draft.clueCandidates[${clue.id}].id`),
          name: sourceOrigin(resolved, [nameStatement.id]),
          description: sourceOrigin(resolved, [bodyStatement.id]),
          findMethods: metadataOrigin(`clues.${clue.id}.findMethods`),
          revelation: metadataOrigin(`clues.${clue.id}.revelation`),
          unlocks: metadataOrigin(`clues.${clue.id}.unlocks`),
          importance: metadataOrigin(`clues.${clue.id}.importance`),
        } };
        return { id: clue.id, name: nameStatement.text, description: bodyStatement.text, findMethods: structuredClone(metadata.findMethods), revelation: metadata.revelation, unlocks: [...metadata.unlocks], found: false, importance: metadata.importance };
      });
      const connections: SceneConnection[] = (connectionsByScene.get(sceneId) ?? []).sort((left, right) => left.id.localeCompare(right.id)).map((connection) => {
        const metadata = presentation.connections[connection.id]!;
        requiredText(metadata.condition, `connections.${connection.id}.condition`);
        const gate = resolved.mechanicsIR.connections.find((candidate) => candidate.connectionId === connection.id);
        if (!gate) throw new ProjectionDataError(`connection mechanism missing: ${connection.id}`);
        map.connections[connection.id] = { fields: { targetSceneId: interpretationEvidence(resolved, gate.sourceInterpretationIds), condition: metadataOrigin(`connections.${connection.id}.condition`) } };
        return { targetSceneId: connection.toSceneId, condition: metadata.condition };
      });
      sourceMap.scenes[sceneId] = map;
      return { id: sceneId, name: heading.text, description: sceneMetadata.description, clues, npcIds: [], connections };
    });
      const endings: Ending[] = endingIds.map((endingId) => {
      const metadata = presentation.endings[endingId]!;
      requiredText(metadata.name, `endings.${endingId}.name`);
      requiredText(metadata.description, `endings.${endingId}.description`);
      assertStringArray(metadata.conditions, `endings.${endingId}.conditions`);
      if (metadata.conditions.some((condition) => !condition.trim())) throw new ProjectionDataError(`endings.${endingId}.conditions contains blank metadata`);
      const ending = endingById.get(endingId)!;
      sourceMap.endings[endingId] = { fields: { id: interpretationEvidence(resolved, ending.sourceInterpretationIds), name: metadataOrigin(`endings.${endingId}.name`), description: metadataOrigin(`endings.${endingId}.description`), conditions: metadataOrigin(`endings.${endingId}.conditions`) } };
      return { id: endingId, name: metadata.name, description: metadata.description, conditions: [...metadata.conditions] };
    });
    const module: ModuleData = { id: resolved.identity.moduleId, title: presentation.module.title, version: presentation.module.version, ruleset: presentation.module.ruleset, era: presentation.module.era, summary: presentation.module.summary, scenes, npcs: [], meta: { playerCount: presentation.module.playerCount, expectedDuration: presentation.module.expectedDuration, triggerWarnings: [...presentation.module.triggerWarnings] }, endings, items: [] };
    return { status: "projected", module, entrySceneId: resolved.analysisInput.entrySceneId, artifact: { artifactHash: envelope.artifactHash, identity: resolved.identity }, mechanics: { moduleId: resolved.mechanicsIR.moduleId, documentHash: resolved.mechanicsIR.documentHash, sourceGraphIdentity: resolved.mechanicsIR.sourceGraphIdentity, mechanicsHash: resolved.mechanicsIR.mechanicsHash }, sourceMap };
  } catch (error) {
    if (error instanceof ProjectionDataError) return refusal("PRESENTATION_METADATA_INVALID", error);
    throw error;
  }
}

function presentationFromProjection(payload: ResolvedCompilerArtifactPayload, value: unknown): ModuleDataPresentationMetadata {
  if (!isRecord(value) || value.status !== "projected" || !isRecord(value.module)) throw new ProjectionDataError("compiled projection has an invalid shape");
  const module = value.module;
  if (!Array.isArray(module.scenes) || !Array.isArray(module.endings) || !isRecord(module.meta)) throw new ProjectionDataError("compiled projection module has an invalid shape");
  const asText = (input: unknown, label: string): string => {
    if (typeof input !== "string") throw new ProjectionDataError(`${label} must be text`);
    return input;
  };
  const scenes = Object.fromEntries(module.scenes.map((scene) => {
    if (!isRecord(scene)) throw new ProjectionDataError("compiled projection scene has an invalid shape");
    return [asText(scene.id, "scene ID"), { description: asText(scene.description, `scenes.${String(scene.id)}.description`) }];
  }));
  const clues = Object.fromEntries(module.scenes.flatMap((scene) => {
    if (!isRecord(scene) || !Array.isArray(scene.clues)) throw new ProjectionDataError("compiled projection clues have an invalid shape");
    return scene.clues.map((clue) => {
      if (!isRecord(clue)) throw new ProjectionDataError("compiled projection clue has an invalid shape");
      const clueId = asText(clue.id, "clue ID");
      assertFindMethods(clue.findMethods, `clues.${clueId}`);
      assertStringArray(clue.unlocks, `clues.${clueId}.unlocks`);
      if (typeof clue.revelation !== "string" || !["core", "bonus", "color"].includes(clue.importance as string)) throw new ProjectionDataError(`clues.${clueId} has invalid metadata`);
      return [clueId, { findMethods: clue.findMethods, revelation: clue.revelation, unlocks: clue.unlocks, importance: clue.importance as Clue["importance"] }];
    });
  }));
  const sceneById = new Map(module.scenes.map((scene) => [isRecord(scene) ? scene.id : "", scene]));
  const connections = Object.fromEntries(payload.analysisInput.connections.map((connection) => {
    const scene = sceneById.get(connection.fromSceneId);
    if (!isRecord(scene) || !Array.isArray(scene.connections)) throw new ProjectionDataError(`compiled projection lacks scene connections: ${connection.fromSceneId}`);
    const matching = scene.connections.filter((candidate) => isRecord(candidate) && candidate.targetSceneId === connection.toSceneId);
    if (matching.length !== 1 || typeof matching[0]!.condition !== "string") throw new ProjectionDataError(`compiled projection connection metadata is invalid: ${connection.id}`);
    return [connection.id, { condition: matching[0]!.condition as string }];
  }));
  const endings = Object.fromEntries(module.endings.map((ending) => {
    if (!isRecord(ending)) throw new ProjectionDataError("compiled projection ending has an invalid shape");
    const endingId = asText(ending.id, "ending ID");
    assertStringArray(ending.conditions, `endings.${endingId}.conditions`);
    return [endingId, { name: asText(ending.name, `endings.${endingId}.name`), description: asText(ending.description, `endings.${endingId}.description`), conditions: ending.conditions }];
  }));
  assertStringArray(module.meta.triggerWarnings, "module.triggerWarnings");
  return {
    module: {
      title: asText(module.title, "module.title"), version: asText(module.version, "module.version"), ruleset: asText(module.ruleset, "module.ruleset") as ModuleData["ruleset"], era: asText(module.era, "module.era"), summary: asText(module.summary, "module.summary"),
      playerCount: asText(module.meta.playerCount, "module.meta.playerCount"), expectedDuration: asText(module.meta.expectedDuration, "module.meta.expectedDuration"), triggerWarnings: module.meta.triggerWarnings,
    },
    scenes,
    connections,
    clues,
    endings,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ProjectionDataError("compiled projection contains a non-plain value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function normalizeGeneratedOrder(value: unknown): unknown {
  const result = structuredClone(value) as unknown;
  if (!isRecord(result) || !isRecord(result.module) || !Array.isArray(result.module.scenes) || !Array.isArray(result.module.endings)) return result;
  result.module.scenes.sort((left, right) => String((left as Record<string, unknown>).id).localeCompare(String((right as Record<string, unknown>).id)));
  for (const scene of result.module.scenes) {
    if (!isRecord(scene)) continue;
    if (Array.isArray(scene.clues)) scene.clues.sort((left, right) => String((left as Record<string, unknown>).id).localeCompare(String((right as Record<string, unknown>).id)));
    if (Array.isArray(scene.connections)) scene.connections.sort((left, right) => String((left as Record<string, unknown>).targetSceneId).localeCompare(String((right as Record<string, unknown>).targetSceneId)));
  }
  result.module.endings.sort((left, right) => String((left as Record<string, unknown>).id).localeCompare(String((right as Record<string, unknown>).id)));
  return result;
}

/** Reprojects permitted presentation metadata and compares the full canonical result. */
export function validateCanonicalCompilerModuleProjection(
  payload: ResolvedCompilerArtifactPayload,
  value: unknown,
): CompilerModuleDataProjection | CompilerModuleDataProjectionRefusal {
  try {
    const expected = projectResolvedCompilerArtifact(payload, presentationFromProjection(payload, value));
    if (expected.status === "refused") return expected;
    if (canonicalJson(normalizeGeneratedOrder(value)) !== canonicalJson(normalizeGeneratedOrder(expected))) throw new ProjectionDataError("compiled projection does not match the canonical artifact projection");
    return structuredClone(expected);
  } catch (error) {
    return refusal("PRESENTATION_METADATA_INVALID", error);
  }
}
