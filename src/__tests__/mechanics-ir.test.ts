import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import {
  compileMechanics,
  type MechanicsCandidateSpec,
  type MechanicsCompilationInput,
} from "../compiler/mechanics-ir";
import {
  applyFactInterpretationReviews,
  buildSourceFactGraph,
  sourceStatementEvidenceRefId,
  type FactInterpretationCandidate,
} from "../compiler/source-fact-graph";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { cleanPageWithTrace, joinPagesWithTrace } from "../ingest/clean-text";
import { buildDocumentBlocks } from "../ingest/document-blocks";
import { createSyntheticDocumentIR } from "../ingest/document-ir";

const symbols = {
  clueIds: ["clue_parent", "clue_child", "clue_observe", "clue_skill", "clue_core"],
  sceneIds: ["scene_library"],
  itemIds: ["item_key"],
  npcIds: ["npc_curator"],
  connectionIds: ["connection_archive"],
  encounterIds: ["encounter_guard"],
  endingIds: ["ending_escape", "ending_trapped"],
  rewardIds: ["reward_archive"],
  declaredStateKeys: ["archive_open"],
};

function input(acceptedInterpretationIds: string[], overrides: Partial<MechanicsCompilationInput> = {}): MechanicsCompilationInput {
  return {
    moduleId: "synthetic-mechanics-fixture",
    documentHash: null,
    sourceGraphSchemaVersion: "1.0.0",
    symbols,
    acceptedInterpretationIds,
    ...overrides,
  };
}

function candidate(id: string, statementId: string, value: MechanicsCandidateSpec): FactInterpretationCandidate<MechanicsCandidateSpec> {
  return {
    id,
    sourceStatementIds: [statementId],
    claim: {
      path: `mechanics.${value.kind}.${value.id}`,
      value,
      domain: "gameplay_mechanic",
      authority: "module_explicit",
      derivation: "explicit",
      status: "candidate",
      evidenceRefs: [sourceStatementEvidenceRefId(statementId)],
      sourceRef: null,
      confidence: null,
      reason: "synthetic accepted interpretation",
      rightsStatus: "user_provided",
      scope: { moduleId: "synthetic-mechanics-fixture" },
    },
    interpretationStatus: "candidate",
  };
}

function fixture() {
  const document = createSyntheticDocumentIR([
    "父线索开放后续调查。\n跨页证据没有结束",
    "，在这一页结束。\n观察、检定、状态和终局。",
  ], "mechanics-ir-fixture");
  const blocks = buildDocumentBlocks(document, joinPagesWithTrace(document.pages.map(cleanPageWithTrace)));
  const graph = buildSourceFactGraph(document, blocks);
  const crossPage = graph.statements.find((statement) => statement.evidence.spans.length > 1)!;
  const sourceIds = graph.statements.map((statement) => statement.id);
  const specs: MechanicsCandidateSpec[] = [
    {
      kind: "discovery_method", id: "discover_parent", clueId: "clue_parent", action: "observe", target: "scene", targetId: "scene_library",
      onSuccess: [{ kind: "discover_clue", clueId: "clue_parent" }],
    },
    {
      kind: "discovery_method", id: "discover_child", clueId: "clue_child", action: "search", target: "scene", targetId: "scene_library",
      availability: { kind: "clue_found", clueId: "clue_parent" },
      onSuccess: [{ kind: "discover_clue", clueId: "clue_child" }],
    },
    {
      kind: "discovery_method", id: "discover_observe", clueId: "clue_observe", action: "observe", target: "npc", targetId: "npc_curator",
      onSuccess: [{ kind: "discover_clue", clueId: "clue_observe" }],
    },
    {
      kind: "discovery_method", id: "discover_skill", clueId: "clue_skill", action: "talk", target: "npc", targetId: "npc_curator",
      check: { kind: "skill", skill: "library_use", difficulty: "hard" },
      onSuccess: [{ kind: "discover_clue", clueId: "clue_skill" }],
    },
    {
      kind: "discovery_method", id: "discover_core", clueId: "clue_core", action: "use_item", target: "item", targetId: "item_key",
      onSuccess: [{ kind: "discover_clue", clueId: "clue_core" }],
      failback: { maxFailures: 2, effects: [{ kind: "discover_clue", clueId: "clue_core" }] },
    },
    {
      kind: "state_transition", id: "open_archive", when: { kind: "clue_found", clueId: "clue_child" },
      effects: [{ kind: "set_state", stateKey: "archive_open", value: true }, { kind: "unlock_connection", connectionId: "connection_archive" }],
    },
    {
      kind: "ending_rule", id: "ending_escape", priority: 10, when: { kind: "state_eq", stateKey: "archive_open", value: true },
      effects: [{ kind: "end_game", endingId: "ending_escape" }],
    },
    {
      kind: "ending_rule", id: "ending_trapped", priority: 20, when: { kind: "not", predicate: { kind: "state_eq", stateKey: "archive_open", value: true } },
      effects: [{ kind: "end_game", endingId: "ending_trapped" }],
    },
  ];
  const accepted = specs.map((spec, index) => candidate(`accepted:${spec.id}`, index === 0 ? crossPage.id : sourceIds[index % sourceIds.length]!, spec));
  const pending = candidate("candidate:unreviewed", sourceIds[0]!, {
    kind: "connection_gate", id: "candidate_connection", connectionId: "connection_archive",
  });
  const withCandidates = { ...graph, interpretations: [...accepted, pending] };
  const reviewed = applyFactInterpretationReviews(withCandidates, accepted.map((entry) => ({
    interpretationId: entry.id,
    decision: "accept" as const,
    reason: "synthetic policy accepts explicit mechanic",
    reviewerKind: "deterministic_rule" as const,
    policyId: "synthetic-mechanics-policy-v1",
    reviewEvidenceStatementIds: [...entry.sourceStatementIds],
  })));
  return { graph: reviewed, acceptedIds: accepted.map((entry) => entry.id), pendingId: pending.id, crossPage };
}

describe("MechanicsIR", () => {
  it("compiles accepted interpretations to evidence-bound mechanics", () => {
    const { graph, acceptedIds, crossPage } = fixture();
    const ir = compileMechanics(graph, input(acceptedIds));
    expect(ir.discoveryMethods).toHaveLength(5);
    expect(ir.transitions).toHaveLength(1);
    expect(ir.endings).toHaveLength(2);
    expect(ir.sourceInterpretationIds).toEqual([...acceptedIds].sort());
    expect(graph.interpretations.find((entry) => entry.id === ir.discoveryMethods[0]?.sourceInterpretationIds[0])?.claim.evidenceRefs).toBeDefined();
    expect(crossPage.evidence.spans.length).toBeGreaterThan(1);
  });

  it("keeps parent availability separate from automatic child discovery", () => {
    const { graph, acceptedIds } = fixture();
    const ir = compileMechanics(graph, input(acceptedIds));
    const parent = ir.discoveryMethods.find((entry) => entry.id === "discover_parent")!;
    const child = ir.discoveryMethods.find((entry) => entry.id === "discover_child")!;
    expect(child.availability).toEqual({ kind: "clue_found", clueId: "clue_parent" });
    expect(parent.onSuccess.some((effect) => effect.kind === "discover_clue" && effect.clueId === "clue_child")).toBe(false);
    expect(child.onSuccess).toEqual([{ kind: "discover_clue", clueId: "clue_child" }]);
  });

  it("keeps explicit onSuccess discoveries and hashes identical input stably", () => {
    const { graph, acceptedIds } = fixture();
    const first = compileMechanics(graph, input(acceptedIds));
    const second = compileMechanics(graph, input([...acceptedIds].reverse()));
    expect(first.discoveryMethods.find((entry) => entry.id === "discover_child")?.onSuccess).toEqual([{ kind: "discover_clue", clueId: "clue_child" }]);
    expect(first.mechanicsHash).toBe(second.mechanicsHash);
  });

  it("rejects candidate, rejected, and deferred interpretations", () => {
    const { graph, pendingId } = fixture();
    expect(() => compileMechanics(graph, input([pendingId]))).toThrow("not accepted");
    for (const status of ["rejected", "deferred"] as const) {
      const mutated = structuredClone(graph);
      const entry = mutated.interpretations.find((candidate) => candidate.id === "accepted:discover_parent")!;
      entry.interpretationStatus = status;
      expect(() => compileMechanics(mutated, input([entry.id]))).toThrow("not accepted");
    }
  });

  it("fails closed for missing source statements and mismatched evidence", () => {
    const { graph } = fixture();
    const missingSource = structuredClone(graph);
    missingSource.interpretations[0]!.sourceStatementIds = [];
    expect(() => compileMechanics(missingSource, input(["accepted:discover_parent"]))).toThrow("no source statements");
    const mismatchedEvidence = structuredClone(graph);
    mismatchedEvidence.interpretations[0]!.claim.evidenceRefs = [];
    expect(() => compileMechanics(mismatchedEvidence, input(["accepted:discover_parent"]))).toThrow("evidence does not reference");
  });

  it("rejects undeclared symbols, duplicate terminal priority, and missing required mechanics", () => {
    const { graph, acceptedIds } = fixture();
    const undeclaredState = structuredClone(graph);
    (undeclaredState.interpretations.find((entry) => entry.id === "accepted:open_archive")!.claim.value as { effects: Array<{ stateKey?: string }> }).effects[0]!.stateKey = "undeclared";
    expect(() => compileMechanics(undeclaredState, input(acceptedIds))).toThrow("unknown state key");
    const duplicatePriority = structuredClone(graph);
    (duplicatePriority.interpretations.find((entry) => entry.id === "accepted:ending_trapped")!.claim.value as { priority: number }).priority = 10;
    expect(() => compileMechanics(duplicatePriority, input(acceptedIds))).toThrow("duplicate ending priority");
    expect(() => compileMechanics(graph, input(acceptedIds, { requiredMechanicIds: ["missing"] }))).toThrow("required mechanic");
  });

  it("does not import world-model, runtime, dataset, or ModuleData loaders", () => {
    const imports = scanImports(readFileSync("src/compiler/mechanics-ir.ts", "utf8"));
    for (const forbidden of ["world-model-loader", "cthulhu-dataset", "game-session", "module-data-runtime-loader", "mythos-module"]) {
      expect(imports.some((entry) => importPointsTo(entry.path, forbidden))).toBe(false);
    }
  });
});
