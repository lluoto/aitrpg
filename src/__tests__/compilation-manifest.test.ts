import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { assertWorldModelQueryScope, canQueryWorldModel, type CompilationManifest } from "../compiler/compilation-manifest";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { latentEvidenceIssue, type ClaimCandidate } from "../compiler/source-authority";

function manifest(overrides: Partial<CompilationManifest> = {}): CompilationManifest {
  return {
    moduleId: "premiers_barn",
    moduleHash: "module-hash",
    version: "1",
    ruleset: "cosmic-horror",
    rulesetVersion: "7e",
    allowedWorkIds: ["work-a"],
    transferPolicy: "canon_fill",
    mode: "strict",
    compilerVersion: "p0",
    artifactHashes: {},
    ...overrides,
  };
}

function latent(overrides: Partial<ClaimCandidate> = {}): ClaimCandidate {
  return {
    path: "entities.mi_go.hp",
    value: 12,
    domain: "rule_numeric",
    authority: "latent_model",
    derivation: "unknown",
    status: "candidate",
    evidenceRefs: [],
    sourceRef: null,
    confidence: null,
    reason: "model proposal",
    rightsStatus: "unknown",
    scope: {},
    ...overrides,
  };
}

describe("CompilationManifest scope", () => {
  it("empty allowedWorkIds fails closed rather than widening to the corpus", () => {
    const empty = manifest({ allowedWorkIds: [] });
    expect(canQueryWorldModel(empty)).toBe(false);
    expect(() => assertWorldModelQueryScope(empty)).toThrow("allowedWorkIds");
  });

  it("cross-work scope requires an explicit corpus and analogy_only", () => {
    expect(() => assertWorldModelQueryScope(manifest({ allowedWorkIds: ["work-a", "work-b"] }))).toThrow("corpusScopeId");
    expect(() => assertWorldModelQueryScope(manifest({
      allowedWorkIds: ["work-a", "work-b"], corpusScopeId: "pair", transferPolicy: "canon_fill",
    }))).toThrow("analogy_only");
    expect(canQueryWorldModel(manifest({
      allowedWorkIds: ["work-a", "work-b"], corpusScopeId: "pair", transferPolicy: "analogy_only",
    }))).toBe(true);
  });
});

describe("FieldEvidence", () => {
  it("latent_model retains null confidence and requires empty source provenance", () => {
    const candidate = latent();
    expect(candidate.confidence).toBeNull();
    expect(latentEvidenceIssue(candidate)).toBeUndefined();
    expect(latentEvidenceIssue(latent({ sourceRef: "invented-source" }))).toContain("sourceRef");
    expect(latentEvidenceIssue(latent({ rightsStatus: "open_licensed" }))).toContain("rightsStatus");
  });

  it("compiler contracts do not import datasets or world-model runtime code", () => {
    for (const file of ["src/compiler/source-authority.ts", "src/compiler/compilation-manifest.ts", "src/compiler/candidate-resolution.ts"]) {
      const imports = scanImports(readFileSync(file, "utf8"));
      expect(imports.some((entry) => importPointsTo(entry.path, "cthulhu-dataset"))).toBe(false);
      expect(imports.some((entry) => importPointsTo(entry.path, "world-model-loader"))).toBe(false);
    }
  });
});
