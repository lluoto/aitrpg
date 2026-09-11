import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { compileMechanics, type MechanicsCandidateSpec, type MechanicsCompilationInput, type MechanicsSymbols } from "../compiler/mechanics-ir";
import { analyzeMechanicsReachability, mechanicsStateHash, type MechanicsAnalysisInput } from "../compiler/mechanics-reachability";
import { applyFactInterpretationReviews, buildSourceFactGraph, sourceStatementEvidenceRefId, type FactInterpretationCandidate } from "../compiler/source-fact-graph";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { cleanPageWithTrace, joinPagesWithTrace } from "../ingest/clean-text";
import { buildDocumentBlocks } from "../ingest/document-blocks";
import { createSyntheticDocumentIR } from "../ingest/document-ir";

const symbols: MechanicsSymbols = {
  clueIds: ["clue_parent", "clue_child"],
  sceneIds: ["scene_foyer", "scene_archive"],
  itemIds: [],
  npcIds: [],
  connectionIds: ["connection_archive"],
  encounterIds: [],
  endingIds: ["ending_escape", "ending_trapped"],
  rewardIds: [],
  declaredStateKeys: ["archive_open"],
};

function compileFixture(specs: MechanicsCandidateSpec[], overrideSymbols = symbols) {
  const document = createSyntheticDocumentIR(["合成机制来源。"], "mechanics-reachability-fixture");
  const blocks = buildDocumentBlocks(document, joinPagesWithTrace(document.pages.map(cleanPageWithTrace)));
  const sourceGraph = buildSourceFactGraph(document, blocks);
  const statementId = sourceGraph.statements[0]!.id;
  const candidates: FactInterpretationCandidate<MechanicsCandidateSpec>[] = specs.map((value) => ({
    id: `accepted:${value.id}`,
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
      reason: "synthetic reachability mechanic",
      rightsStatus: "user_provided",
      scope: { moduleId: "mechanics-reachability-fixture" },
    },
    interpretationStatus: "candidate",
  }));
  const reviewed = applyFactInterpretationReviews({ ...sourceGraph, interpretations: candidates }, candidates.map((candidate) => ({
    interpretationId: candidate.id,
    decision: "accept" as const,
    reason: "synthetic deterministic policy",
    reviewerKind: "deterministic_rule" as const,
    policyId: "mechanics-reachability-fixture-v1",
    reviewEvidenceStatementIds: [statementId],
  })));
  const input: MechanicsCompilationInput = {
    moduleId: "mechanics-reachability-fixture",
    documentHash: null,
    sourceGraphSchemaVersion: "1.0.0",
    symbols: overrideSymbols,
    acceptedInterpretationIds: candidates.map((candidate) => candidate.id),
  };
  return compileMechanics(reviewed, input);
}

function fixture() {
  const specs: MechanicsCandidateSpec[] = [
    {
      kind: "discovery_method", id: "discover_parent", clueId: "clue_parent", action: "observe", target: "scene", targetId: "scene_foyer",
      onSuccess: [{ kind: "discover_clue", clueId: "clue_parent" }],
    },
    {
      kind: "discovery_method", id: "discover_child", clueId: "clue_child", action: "search", target: "scene", targetId: "scene_foyer",
      availability: { kind: "clue_found", clueId: "clue_parent" },
      check: { kind: "skill", skill: "library_use", difficulty: "hard" },
      onSuccess: [{ kind: "discover_clue", clueId: "clue_child" }],
      failback: { maxFailures: 2, effects: [{ kind: "discover_clue", clueId: "clue_child" }] },
    },
    {
      kind: "state_transition", id: "open_archive", when: { kind: "clue_found", clueId: "clue_child" },
      effects: [{ kind: "set_state", stateKey: "archive_open", value: true }, { kind: "unlock_connection", connectionId: "connection_archive" }],
    },
    {
      kind: "connection_gate", id: "traverse_archive", connectionId: "connection_archive",
      availability: { kind: "state_eq", stateKey: "archive_open", value: true },
    },
    {
      kind: "ending_rule", id: "ending_escape", priority: 10, when: { kind: "scene_visited", sceneId: "scene_archive" },
      effects: [{ kind: "end_game", endingId: "ending_escape" }],
    },
    {
      kind: "ending_rule", id: "ending_trapped", priority: 20, when: { kind: "scene_visited", sceneId: "scene_archive" },
      effects: [{ kind: "end_game", endingId: "ending_trapped" }],
    },
  ];
  const ir = compileFixture(specs);
  const input: MechanicsAnalysisInput = {
    entrySceneId: "scene_foyer",
    initialState: { foundClueIds: [], visitedSceneIds: [], ownedItemIds: [], stateValues: {}, npcStates: {} },
    coreClueIds: ["clue_child"],
    connections: [{ id: "connection_archive", fromSceneId: "scene_foyer", toSceneId: "scene_archive" }],
    discoveryLocations: { discover_parent: "scene_foyer", discover_child: "scene_foyer" },
    maxStates: 100,
  };
  return { specs, ir, input };
}

describe("Mechanics reachability", () => {
  it("produces shortest witnesses from entry through core, transition, traverse, and selected ending", () => {
    const { ir, input } = fixture();
    const report = analyzeMechanicsReachability(ir, input);
    expect(report.analysisScope).toBe("closed_world");
    expect(report.unreachableCoreClueIds).toEqual([]);
    expect(report.selectedTerminalEndingIds).toEqual(["ending_escape"]);
    expect(report.unreachableEndingIds).toEqual(["ending_trapped"]);
    expect(report.coreClueWitnesses.clue_child?.steps.map((step) => step.mechanismId)).toEqual(["discover_parent", "discover_child"]);
    expect(report.endingWitnesses.ending_escape?.steps.map((step) => step.mechanismId)).toEqual(["discover_parent", "discover_child", "open_archive", "traverse_archive", "ending_escape"]);
  });

  it("does not allow child discovery at the entry before its parent availability", () => {
    const { ir, input } = fixture();
    const report = analyzeMechanicsReachability(ir, input);
    const initialHash = mechanicsStateHash({
      currentSceneId: "scene_foyer", foundClueIds: [], visitedSceneIds: ["scene_foyer"], ownedItemIds: [], stateValues: {}, npcStates: {},
      unlockedConnectionIds: [], failureCounts: {}, startedEncounterIds: [], rewardIds: [],
    });
    expect(report.edges.some((edge) => edge.mechanismId === "discover_child" && edge.beforeStateHash === initialHash)).toBe(false);
  });

  it("records a bounded failure path whose failback discovers the core clue", () => {
    const { ir, input } = fixture();
    const report = analyzeMechanicsReachability(ir, input);
    const witness = report.failbackWitnesses.discover_child!;
    expect(witness.steps.slice(-3).map((step) => step.outcome)).toEqual(["failure", "failure", "failback"]);
    expect(witness.final).toMatchObject({ kind: "clue", id: "clue_child" });
  });

  it("reports checked core methods without failback and unreachable declared mechanisms", () => {
    const { specs, input } = fixture();
    const noFailback = specs.map((spec) => spec.kind === "discovery_method" && spec.id === "discover_child" ? { ...spec, failback: undefined } : spec) as MechanicsCandidateSpec[];
    const report = analyzeMechanicsReachability(compileFixture(noFailback), input);
    expect(report.failureDeadlockMethodIds).toEqual(["discover_child"]);
    expect(report.edges.some((edge) => edge.mechanismId === "discover_child" && edge.outcome === "failure")).toBe(false);
    expect(report.issues.some((issue) => issue.code === "unreachable_ending" && issue.id === "ending_trapped")).toBe(true);
    const noChild = specs.filter((spec) => !(spec.kind === "discovery_method" && spec.id === "discover_child"));
    const unreachable = analyzeMechanicsReachability(compileFixture(noChild), { ...input, discoveryLocations: { discover_parent: "scene_foyer" } });
    expect(unreachable.unreachableCoreClueIds).toEqual(["clue_child"]);
  });

  it("reports closed-world deadlocks and ignores no-change failure edges", () => {
    const deadlockSymbols: MechanicsSymbols = { ...symbols, clueIds: [], connectionIds: [], endingIds: ["ending_never"] };
    const deadlock = compileFixture([{
      kind: "ending_rule", id: "ending_never", priority: 1, when: { kind: "state_eq", stateKey: "archive_open", value: true },
      effects: [{ kind: "end_game", endingId: "ending_never" }],
    }], deadlockSymbols);
    const report = analyzeMechanicsReachability(deadlock, {
      entrySceneId: "scene_foyer",
      initialState: { foundClueIds: [], visitedSceneIds: [], ownedItemIds: [], stateValues: {}, npcStates: {} },
      coreClueIds: [], connections: [], discoveryLocations: {}, maxStates: 10,
    });
    expect(report.deadlockWitnesses).toHaveLength(1);
    expect(report.deadlockWitnesses[0]?.final.kind).toBe("deadlock");
  });

  it("fails closed for state limits, missing locations, bad connection targets, and duplicate ending priority", () => {
    const { specs, ir, input } = fixture();
    expect(() => analyzeMechanicsReachability(ir, { ...input, maxStates: 1 })).toThrow("state limit");
    expect(() => analyzeMechanicsReachability(ir, { ...input, discoveryLocations: { discover_parent: "scene_foyer" } })).toThrow("location is missing");
    expect(() => analyzeMechanicsReachability(ir, { ...input, connections: [{ id: "connection_archive", fromSceneId: "scene_foyer", toSceneId: "missing" }] })).toThrow("unknown connection target scene");
    const duplicatePriority = specs.map((spec) => spec.kind === "ending_rule" && spec.id === "ending_trapped" ? { ...spec, priority: 10 } : spec) as MechanicsCandidateSpec[];
    expect(() => compileFixture(duplicatePriority)).toThrow("duplicate ending priority");
  });

  it("does not import world-model, runtime, dataset, or ModuleData loaders", () => {
    const imports = scanImports(readFileSync("src/compiler/mechanics-reachability.ts", "utf8"));
    for (const forbidden of ["world-model-loader", "cthulhu-dataset", "game-session", "module-data-runtime-loader", "mythos-module"]) {
      expect(imports.some((entry) => importPointsTo(entry.path, forbidden))).toBe(false);
    }
  });
});
