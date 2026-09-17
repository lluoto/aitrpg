import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { projectResolvedCompilerArtifact, type ModuleDataPresentationMetadata } from "../compiler/compiler-module-data-projection";
import { prepareCompiler, resolveCompiler, type PreparedCompilerApiResult } from "../compiler/compiler-api";
import { type CompilerQuestion, type CompilerQuestionResolution, type ModuleCompileHints } from "../compiler/compiler-question-queue";

const PAGES = ["入口：\n普通叙述不能凭空绑定线索。\n▶父线索：一把刻有档案室标记的钥匙。\n档案室：\n▶子线索：一份需要检定才能读懂的档案。\n出口：\n▶出口说明：离开这里的旧车票。\n规则：\n这不是可玩场景。"];

function answer(question: CompilerQuestion, value: unknown): CompilerQuestionResolution {
  return { questionId: question.id, kind: question.kind, value, sourceStatementIds: [...question.sourceStatementIds], evidenceRefs: [...question.evidenceRefs], authority: "user_document", derivation: "explicit", reviewerKind: "human", rightsStatus: "user_provided", reason: "projection fixture declaration" };
}

function hints(prepared: PreparedCompilerApiResult): ModuleCompileHints {
  const { draft, preparedQueue: queue } = prepared.artifact.payload;
  const scene = (name: string) => draft.sceneCandidates.find((candidate) => candidate.displayName.startsWith(name))!;
  const clue = (name: string) => draft.clueCandidates.find((candidate) => candidate.displayName === name)!;
  const entry = scene("入口"), archive = scene("档案室"), exit = scene("出口"), rules = scene("规则"), parent = clue("父线索"), child = clue("子线索");
  const topology = (id: string) => queue.questions.find((question) => question.kind === "connection_topology" && question.subjectCandidateId === id)!;
  const core = (id: string) => queue.questions.find((question) => question.kind === "core_clue" && question.subjectCandidateId === id)!;
  const discovery = (id: string) => queue.questions.find((question) => question.kind === "discovery_method" && question.subjectCandidateId === id)!;
  const entryQuestion = queue.questions.find((question) => question.kind === "entry_scene")!;
  const endingQuestion = queue.questions.find((question) => question.kind === "ending_rule")!;
  return { schemaVersion: "1.1.0", moduleId: queue.moduleId, documentHash: queue.documentHash, sourceGraphIdentity: queue.sourceGraphIdentity, resolutions: [
    ...queue.questions.filter((question) => question.kind === "scene_role").map((question) => answer(question, { role: question.subjectCandidateId === rules.id ? "rules_section" : "playable_scene" })),
    answer(entryQuestion, { sceneCandidateId: entry.id }),
    answer(topology(entry.id), { connections: [{ toSceneCandidateId: archive.id, connectionId: "entry_archive" }, { toSceneCandidateId: exit.id, connectionId: "entry_exit" }] }),
    answer(topology(archive.id), { connections: [{ toSceneCandidateId: entry.id, connectionId: "archive_entry" }, { toSceneCandidateId: exit.id, connectionId: "archive_exit", availability: { kind: "connection_unlocked", connectionId: "archive_exit" } }] }),
    answer(topology(exit.id), { connections: [] }),
    answer(topology(rules.id), { connections: [] }),
    answer(core(parent.id), { clueCandidateId: parent.id, required: false }),
    answer(core(child.id), { clueCandidateId: child.id, required: true }),
    answer(discovery(parent.id), { clueCandidateId: parent.id, locationSceneCandidateId: entry.id, spec: { kind: "discovery_method", id: "find_parent", clueId: parent.id, action: "search", target: "scene", targetId: entry.id, onSuccess: [{ kind: "discover_clue", clueId: parent.id }] } }),
    answer(discovery(child.id), { clueCandidateId: child.id, locationSceneCandidateId: archive.id, spec: { kind: "discovery_method", id: "find_child", clueId: child.id, action: "read", target: "scene", targetId: archive.id, availability: { kind: "clue_found", clueId: parent.id }, onSuccess: [{ kind: "discover_clue", clueId: child.id }, { kind: "unlock_connection", connectionId: "archive_exit" }] } }),
    answer(endingQuestion, { declarations: [
      { endingId: "clean", spec: { kind: "ending_rule", id: "rule_clean", priority: 10, when: { kind: "all", predicates: [{ kind: "clue_found", clueId: child.id }, { kind: "scene_visited", sceneId: exit.id }] }, effects: [{ kind: "end_game", endingId: "clean" }] } },
      { endingId: "hasty", spec: { kind: "ending_rule", id: "rule_hasty", priority: 20, when: { kind: "all", predicates: [{ kind: "scene_visited", sceneId: exit.id }, { kind: "not", predicate: { kind: "clue_found", clueId: child.id } }] }, effects: [{ kind: "end_game", endingId: "hasty" }] } },
    ] }),
  ] };
}

async function resolved() {
  const prepared = await prepareCompiler({ kind: "synthetic_pages", moduleId: "projection-fixture", sourceDescriptor: "projection-fixture", pages: PAGES });
  if (prepared.status === "refused") throw new Error(prepared.message);
  const result = resolveCompiler(prepared.artifact, prepared.identity.preparedQueueHash, hints(prepared));
  if (result.status === "refused") throw new Error(result.message);
  return result.artifact.payload as any;
}

function metadata(payload: Awaited<ReturnType<typeof resolved>>): ModuleDataPresentationMetadata {
  return {
    module: { title: "Projection fixture", version: "1", ruleset: "cosmic-horror", era: "test", summary: "caller supplied", playerCount: "2", expectedDuration: "short", triggerWarnings: [] },
    scenes: Object.fromEntries(payload.mechanicsIR.symbols.sceneIds.map((id: string) => [id, { description: `description:${id}` }])),
    connections: Object.fromEntries(payload.analysisInput.connections.map((connection: { id: string }) => [connection.id, { condition: `condition:${connection.id}` }])),
    clues: Object.fromEntries(payload.mechanicsIR.symbols.clueIds.map((id: string) => [id, { findMethods: [], revelation: `revelation:${id}`, unlocks: [], importance: "core" }])),
    endings: Object.fromEntries(payload.mechanicsIR.endings.map((ending: any) => [ending.effects.find((effect: any) => effect.kind === "end_game").endingId, { name: `name:${ending.id}`, description: `description:${ending.id}`, conditions: [`condition:${ending.id}`] }])),
  };
}

describe("compiler ModuleData projection", () => {
  it("projects only playable scenes with explicit entry, zero/multiple topology, and source-exact clue text", async () => {
    const payload = await resolved();
    const result = projectResolvedCompilerArtifact(payload, metadata(payload));
    if (result.status === "refused") throw new Error(result.message);
    expect(result.module.scenes.map((scene) => scene.name)).not.toContain("规则：");
    expect(result.entrySceneId).toBe(payload.analysisInput.entrySceneId);
    const entry = result.module.scenes.find((scene) => scene.id === result.entrySceneId)!;
    expect(entry.connections).toHaveLength(2);
    expect(result.module.scenes.find((scene) => scene.name === "出口：")!.connections).toEqual([]);
    const clue = entry.clues[0]!;
    const candidate = payload.draft.clueCandidates.find((item: any) => item.id === clue.id)!;
    const name = payload.graph.statements.find((statement: any) => statement.id === candidate.nameStatementId)!;
    const body = payload.graph.statements.find((statement: any) => statement.id === candidate.bodyStatementId)!;
    expect(clue.name).toBe(name.text);
    expect(clue.description).toBe(body.text);
    expect(result.sourceMap.scenes[entry.id]!.clues[clue.id]!.fields.name).toMatchObject({ kind: "source_exact", statements: [{ statementId: name.id }] });
  });

  it("keeps entry independent of presentation scene ordering and projection deterministic", async () => {
    const payload = await resolved();
    const data = metadata(payload);
    const first = projectResolvedCompilerArtifact(payload, data);
    const second = projectResolvedCompilerArtifact(payload, structuredClone(data));
    if (first.status === "refused" || second.status === "refused") throw new Error("expected projection");
    const reordered = structuredClone(first.module);
    reordered.scenes.reverse();
    expect(first.entrySceneId).toBe(payload.analysisInput.entrySceneId);
    expect(first.entrySceneId).not.toBe(reordered.scenes[0]!.id);
    expect(first).toEqual(second);
  });

  it("fails closed for missing presentation fields and artifact/mechanics identity mismatch", async () => {
    const payload = await resolved();
    const missingScene = metadata(payload);
    delete missingScene.scenes[payload.mechanicsIR.symbols.sceneIds[0]!];
    expect(projectResolvedCompilerArtifact(payload, missingScene)).toMatchObject({ status: "refused", code: "PRESENTATION_METADATA_INVALID" });
    const missingLabel = metadata(payload);
    missingLabel.connections[payload.analysisInput.connections[0]!.id]!.condition = "";
    expect(projectResolvedCompilerArtifact(payload, missingLabel)).toMatchObject({ status: "refused", code: "PRESENTATION_METADATA_INVALID" });
    const badArtifact = structuredClone(payload);
    badArtifact.identity.mechanicsHash = "tampered";
    expect(projectResolvedCompilerArtifact(badArtifact, metadata(payload))).toMatchObject({ status: "refused", code: "ARTIFACT_INVALID" });
  });

  it("does not import runtime, Barn, GameSession, or execution paths", () => {
    const source = readFileSync("src/compiler/compiler-module-data-projection.ts", "utf8");
    expect(source).not.toMatch(/game-session|barn-of-premier|module-data-runtime-loader|play-module|world-model|mechanics-execution/i);
  });
});
