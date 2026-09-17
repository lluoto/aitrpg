import { createResolvedCompilerArtifact, restoreCompilerArtifact, type CompilerArtifactEnvelope, type ResolvedCompilerArtifactPayload } from "../compiler/compiler-artifact";
import type { CompilerModuleDataProjection } from "../compiler/compiler-module-data-projection";

export type CompiledBundleRefusal = {
  status: "refused";
  code: "COMPILED_ARTIFACT_INVALID" | "COMPILED_PROJECTION_INVALID";
  message: string;
  causeCode?: string;
};

export type ValidatedCompiledModuleBundle = {
  status: "validated";
  artifactHash: string;
  payload: ResolvedCompilerArtifactPayload;
  projection: CompilerModuleDataProjection;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((id, index) => id === [...expected].sort()[index]);
}

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
}

function decodeProjection(value: unknown): CompilerModuleDataProjection {
  if (!isRecord(value) || value.status !== "projected" || !isRecord(value.module) || !Array.isArray(value.module.scenes) || !Array.isArray(value.module.endings) || !isRecord(value.module.meta) || !isRecord(value.artifact) || !isRecord(value.artifact.identity) || !isRecord(value.mechanics) || !isRecord(value.sourceMap) || !isRecord(value.sourceMap.scenes) || !isRecord(value.sourceMap.endings)) {
    throw new Error("compiled projection has an invalid shape");
  }
  return structuredClone(value) as unknown as CompilerModuleDataProjection;
}

function validateProjection(payload: ResolvedCompilerArtifactPayload, projection: CompilerModuleDataProjection, artifactHash: string): void {
  if (projection.artifact.artifactHash !== artifactHash || projection.artifact.identity.moduleId !== payload.identity.moduleId || projection.artifact.identity.documentHash !== payload.identity.documentHash || projection.artifact.identity.sourceGraphIdentity !== payload.identity.sourceGraphIdentity || projection.artifact.identity.preparedQueueHash !== payload.identity.preparedQueueHash || projection.artifact.identity.resolvedQueueHash !== payload.identity.resolvedQueueHash || projection.artifact.identity.mechanicsHash !== payload.identity.mechanicsHash) {
    throw new Error("compiled projection artifact identity does not match resolved artifact");
  }
  if (projection.mechanics.moduleId !== payload.mechanicsIR.moduleId || projection.mechanics.documentHash !== payload.mechanicsIR.documentHash || projection.mechanics.sourceGraphIdentity !== payload.mechanicsIR.sourceGraphIdentity || projection.mechanics.mechanicsHash !== payload.mechanicsIR.mechanicsHash) {
    throw new Error("compiled projection mechanics identity does not match resolved artifact");
  }
  if (projection.entrySceneId !== payload.analysisInput.entrySceneId || projection.module.id !== payload.identity.moduleId) throw new Error("compiled projection entry or module identity does not match resolved artifact");
  const sceneIds = payload.mechanicsIR.symbols.sceneIds;
  const clueIds = payload.mechanicsIR.symbols.clueIds;
  const endingIds = payload.mechanicsIR.endings.map((ending) => ending.effects.find((effect) => effect.kind === "end_game")?.endingId ?? "");
  if (!sameIds(projection.module.scenes.map((scene) => scene.id), sceneIds) || !sameIds(projection.module.scenes.flatMap((scene) => scene.clues.map((clue) => clue.id)), clueIds) || !sameIds(projection.module.endings.map((ending) => ending.id), endingIds)) throw new Error("compiled projection IDs do not exactly match resolved mechanics");
  requireText(projection.module.title, "compiled projection module title is required");
  requireText(projection.module.version, "compiled projection module version is required");
  requireText(projection.module.era, "compiled projection module era is required");
  requireText(projection.module.summary, "compiled projection module summary is required");
  requireText(projection.module.meta.playerCount, "compiled projection player count is required");
  requireText(projection.module.meta.expectedDuration, "compiled projection expected duration is required");
  if (!Array.isArray(projection.module.meta.triggerWarnings) || projection.module.meta.triggerWarnings.some((warning) => typeof warning !== "string" || !warning.trim())) throw new Error("compiled projection trigger warnings contain blank text");
  if (!sameIds(Object.keys(projection.sourceMap.scenes), sceneIds) || !sameIds(Object.keys(projection.sourceMap.endings), endingIds)) throw new Error("compiled projection source map does not exactly match resolved mechanics");
  for (const scene of projection.module.scenes) {
    if (!isRecord(scene) || !Array.isArray(scene.clues) || !Array.isArray(scene.connections)) throw new Error("compiled projection scene has an invalid shape");
    requireText(scene.name, `compiled projection scene name is required: ${scene.id}`);
    requireText(scene.description, `compiled projection scene description is required: ${scene.id}`);
    const expected = payload.analysisInput.connections.filter((connection) => connection.fromSceneId === scene.id);
    if (!sameIds(scene.connections.map((connection) => connection.targetSceneId), expected.map((connection) => connection.toSceneId)) || scene.connections.some((connection) => !connection.condition?.trim())) throw new Error(`compiled projection topology does not match resolved mechanics: ${scene.id}`);
    const map = projection.sourceMap.scenes[scene.id];
    if (!map || !isRecord(map) || !isRecord(map.clues) || !isRecord(map.connections) || !sameIds(Object.keys(map.clues), scene.clues.map((clue) => clue.id)) || !sameIds(Object.keys(map.connections), expected.map((connection) => connection.id))) throw new Error(`compiled projection source map is incomplete: ${scene.id}`);
    for (const clue of scene.clues) {
      if (!isRecord(clue)) throw new Error("compiled projection clue has an invalid shape");
      requireText(clue.name, `compiled projection clue name is required: ${clue.id}`);
      requireText(clue.description, `compiled projection clue description is required: ${clue.id}`);
      requireText(clue.revelation, `compiled projection clue revelation is required: ${clue.id}`);
    }
  }
  for (const ending of projection.module.endings) {
    if (!isRecord(ending) || !Array.isArray(ending.conditions)) throw new Error("compiled projection ending has an invalid shape");
    requireText(ending.name, `compiled projection ending name is required: ${ending.id}`);
    requireText(ending.description, `compiled projection ending description is required: ${ending.id}`);
    if (ending.conditions.some((condition) => typeof condition !== "string" || !condition.trim()) || !projection.sourceMap.endings[ending.id]) throw new Error(`compiled projection ending metadata is incomplete: ${ending.id}`);
  }
}

/** Restores a resolved artifact and validates its presentation bundle before any runtime host is constructed. */
export function validateCompiledModuleBundle(artifactValue: unknown, projectionValue: unknown): ValidatedCompiledModuleBundle | CompiledBundleRefusal {
  let restored;
  try {
    const envelope = isRecord(artifactValue) && "artifactHash" in artifactValue && "stage" in artifactValue
      ? artifactValue as unknown as CompilerArtifactEnvelope
      : createResolvedCompilerArtifact(artifactValue as ResolvedCompilerArtifactPayload);
    restored = restoreCompilerArtifact(envelope);
  } catch (error) {
    return { status: "refused", code: "COMPILED_ARTIFACT_INVALID", message: error instanceof Error ? error.message : String(error), ...(typeof (error as { code?: unknown })?.code === "string" ? { causeCode: (error as { code: string }).code } : {}) };
  }
  if (restored.status === "refused") return { status: "refused", code: "COMPILED_ARTIFACT_INVALID", message: restored.message, causeCode: restored.code };
  if (restored.stage !== "resolved") return { status: "refused", code: "COMPILED_ARTIFACT_INVALID", message: "compiled sessions require a resolved artifact" };
  try {
    const projection = decodeProjection(projectionValue);
    validateProjection(restored.payload, projection, restored.artifactHash);
    return { status: "validated", artifactHash: restored.artifactHash, payload: structuredClone(restored.payload), projection };
  } catch (error) {
    return { status: "refused", code: "COMPILED_PROJECTION_INVALID", message: error instanceof Error ? error.message : String(error) };
  }
}
