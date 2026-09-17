import { createResolvedCompilerArtifact, restoreCompilerArtifact, type CompilerArtifactEnvelope, type ResolvedCompilerArtifactPayload } from "../compiler/compiler-artifact";
import { validateCanonicalCompilerModuleProjection, type CompilerModuleDataProjection } from "../compiler/compiler-module-data-projection";

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

/** Restores the sealed artifact then delegates complete projection authenticity to its owner. */
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
  const projection = validateCanonicalCompilerModuleProjection(restored.payload, projectionValue);
  if (projection.status === "refused") return { status: "refused", code: "COMPILED_PROJECTION_INVALID", message: projection.message, causeCode: projection.code };
  return { status: "validated", artifactHash: restored.artifactHash, payload: structuredClone(restored.payload), projection };
}
