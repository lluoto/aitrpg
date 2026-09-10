export type TransferPolicy = "canon_fill" | "mechanic_only" | "analogy_only" | "no_transfer";
export type CompilationMode = "strict" | "compatible" | "latent";

/**
 * Immutable compiler input scope. It authorizes candidate consideration; it
 * never supplies a module plot fact by itself.
 */
export interface CompilationManifest {
  moduleId: string;
  moduleHash: string;
  version: string;
  ruleset: string;
  rulesetVersion: string;
  allowedWorkIds: string[];
  corpusScopeId?: string;
  transferPolicy: TransferPolicy;
  mode: CompilationMode;
  compilerVersion: string;
  artifactHashes: Record<string, string>;
  era?: string;
}

export class CompilationScopeError extends Error {}

/** Empty work scope is a fail-closed state, never a request for the full corpus. */
export function assertWorldModelQueryScope(manifest: CompilationManifest): void {
  if (manifest.allowedWorkIds.length === 0) {
    throw new CompilationScopeError("allowedWorkIds must not be empty for a world-model query");
  }
  if (manifest.allowedWorkIds.length > 1 && !manifest.corpusScopeId) {
    throw new CompilationScopeError("cross-work query requires corpusScopeId");
  }
  if (manifest.allowedWorkIds.length > 1 && manifest.transferPolicy !== "analogy_only") {
    throw new CompilationScopeError("cross-work query requires analogy_only transferPolicy");
  }
}

export function canQueryWorldModel(manifest: CompilationManifest): boolean {
  try {
    assertWorldModelQueryScope(manifest);
    return true;
  } catch (error) {
    if (error instanceof CompilationScopeError) return false;
    throw error;
  }
}
