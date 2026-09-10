import { describe, expect, it } from "bun:test";
import { type CompilationManifest } from "../compiler/compilation-manifest";
import { resolveCandidates } from "../compiler/candidate-resolution";
import { type Authority, type ClaimCandidate, type ClaimDomain } from "../compiler/source-authority";

function manifest(overrides: Partial<CompilationManifest> = {}): CompilationManifest {
  return {
    moduleId: "premiers_barn",
    moduleHash: "hash",
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

function candidate<T>(value: T | undefined, authority: Authority, domain: ClaimDomain, overrides: Partial<ClaimCandidate<T>> = {}): ClaimCandidate<T> {
  return {
    path: "npcs.mi_go.hp",
    value,
    domain,
    authority,
    derivation: authority === "module_explicit" ? "explicit" : "inferred",
    status: "candidate",
    evidenceRefs: ["evidence-1"],
    sourceRef: authority === "latent_model" ? null : "source-1",
    confidence: null,
    reason: "fixture",
    rightsStatus: authority === "latent_model" ? "unknown" : "project_owned",
    scope: authority === "declared_canon_corpus" ? { workId: "work-a", transferUse: "entity_general" } : {},
    ...overrides,
  };
}

describe("resolveCandidates scoped authority", () => {
  it("module explicit HP 11 and AC 10 outrank generic project values", () => {
    const hp = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(11, "module_explicit", "rule_numeric"), candidate(12, "project_original", "rule_numeric"),
    ], manifest());
    const ac = resolveCandidates("npcs.mi_go.ac", "rule_numeric", [
      candidate(10, "module_explicit", "rule_numeric", { path: "npcs.mi_go.ac" }),
      candidate(14, "project_original", "rule_numeric", { path: "npcs.mi_go.ac" }),
    ], manifest());
    expect(hp.value).toBe(11);
    expect(ac.value).toBe(10);
  });

  it("a lower project source fills only a missing module field", () => {
    const resolution = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(undefined, "module_explicit", "rule_numeric"), candidate(12, "project_original", "rule_numeric"),
    ], manifest());
    expect(resolution.status).toBe("accepted");
    expect(resolution.value).toBe(12);
  });

  it("same-precedence values conflict instead of using input order", () => {
    const resolution = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(11, "module_explicit", "rule_numeric"), candidate(12, "module_explicit", "rule_numeric"),
    ], manifest());
    expect(resolution.status).toBe("conflicted");
    expect(resolution.value).toBeUndefined();
    expect(resolution.conflicted).toHaveLength(2);
  });

  it("high confidence cannot elevate a lower authority", () => {
    const resolution = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(11, "module_explicit", "rule_numeric", { confidence: null }),
      candidate(99, "project_original", "rule_numeric", { confidence: 0.99 }),
    ], manifest());
    expect(resolution.value).toBe(11);
    expect(resolution.rejected[0]?.confidence).toBe(0.99);
  });

  it("each domain applies its declared authority order", () => {
    const plot = resolveCandidates("plot.secret", "plot_fact", [
      candidate("module", "module_explicit", "plot_fact", { path: "plot.secret" }),
      candidate("user", "user_document", "plot_fact", { path: "plot.secret" }),
    ], manifest());
    const behavior = resolveCandidates("npcs.mi_go.behavior", "behavior_prior", [
      candidate("canon", "declared_canon_corpus", "behavior_prior", {
        path: "npcs.mi_go.behavior", scope: { workId: "work-a", transferUse: "entity_general" },
      }),
      candidate("pattern", "worldview_pattern", "behavior_prior", { path: "npcs.mi_go.behavior" }),
      candidate("policy", "engine_policy", "behavior_prior", { path: "npcs.mi_go.behavior" }),
    ], manifest());
    const mechanic = resolveCandidates("npcs.mi_go.attack", "gameplay_mechanic", [
      candidate("inferred", "worldview_pattern", "gameplay_mechanic", { path: "npcs.mi_go.attack", derivation: "inferred" }),
      candidate("policy", "engine_policy", "gameplay_mechanic", { path: "npcs.mi_go.attack" }),
      candidate("latent", "latent_model", "gameplay_mechanic", {
        path: "npcs.mi_go.attack", sourceRef: null, rightsStatus: "unknown", derivation: "unknown",
      }),
    ], manifest({ mode: "latent", transferPolicy: "mechanic_only" }));
    expect(plot.value).toBe("module");
    expect(behavior.value).toBe("canon");
    expect(mechanic.value).toBe("inferred");
  });

  it("rejected sources cannot directly enter the accepted runtime result", () => {
    const resolution = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(99, "module_explicit", "rule_numeric", { status: "rejected" }),
      candidate(12, "project_original", "rule_numeric"),
    ], manifest());
    expect(resolution.value).toBe(12);
    expect(resolution.rejected.find((entry) => entry.value === 99)?.reason).toContain("source status");
  });

  it("mechanic_only cannot fill plot facts and analogy_only cannot auto accept", () => {
    const plot = resolveCandidates("plot.secret", "plot_fact", [
      candidate("secret", "declared_canon_corpus", "plot_fact", { path: "plot.secret", scope: { workId: "work-a", transferUse: "plot_fact" } }),
    ], manifest({ transferPolicy: "mechanic_only" }));
    const analogy = resolveCandidates("npcs.mi_go.behavior", "behavior_prior", [
      candidate("avoid fire", "declared_canon_corpus", "behavior_prior", {
        path: "npcs.mi_go.behavior", scope: { workId: "work-a", transferUse: "entity_general" },
      }),
    ], manifest({ transferPolicy: "analogy_only" }));
    expect(plot.status).toBe("unresolved");
    expect(plot.rejected[0]?.reason).toContain("mechanic_only");
    expect(analogy.status).toBe("unresolved");
    expect(analogy.rejected[0]?.reason).toContain("analogy_only");
  });

  it("empty work scope rejects corpus candidates instead of querying every work", () => {
    const resolution = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(12, "declared_canon_corpus", "rule_numeric"),
    ], manifest({ allowedWorkIds: [] }));
    expect(resolution.status).toBe("unresolved");
    expect(resolution.rejected[0]?.reason).toContain("allowedWorkIds");
  });

  it("latent candidates retain null provenance and accepted results retain all decisions", () => {
    const resolution = resolveCandidates("npcs.mi_go.hp", "rule_numeric", [
      candidate(11, "module_explicit", "rule_numeric"),
      candidate(12, "latent_model", "rule_numeric", { confidence: null, sourceRef: null, rightsStatus: "unknown" }),
    ], manifest({ mode: "latent", transferPolicy: "mechanic_only" }));
    expect(resolution.status).toBe("accepted");
    expect(resolution.accepted).toHaveLength(1);
    expect(resolution.rejected).toHaveLength(1);
    expect(resolution.rejected[0]?.sourceRef).toBeNull();
    expect(resolution.rejected[0]?.rightsStatus).toBe("unknown");
    expect(resolution.rejected[0]?.confidence).toBeNull();
    expect(resolution.rejected[0]?.reason).toContain("lower precedence");
  });
});
