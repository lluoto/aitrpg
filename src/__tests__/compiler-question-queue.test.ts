import { describe, expect, it } from "bun:test";
import {
  buildCompilerQuestionQueue,
  validateCompilerQuestionQueue,
  validateModuleCompileHints,
  type ModuleCompileHints,
} from "../compiler/compiler-question-queue";
import { compileDeterministicTemplates } from "../compiler/deterministic-template-compiler";
import { buildSourceFactGraph } from "../compiler/source-fact-graph";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { readFileSync } from "fs";
import { cleanPageWithTrace, joinPagesWithTrace } from "../ingest/clean-text";
import { buildDocumentBlocks } from "../ingest/document-blocks";
import { createSyntheticDocumentIR } from "../ingest/document-ir";

function graphFor(pages: string[]) {
  const document = createSyntheticDocumentIR(pages, "compiler-question-queue-test");
  const blocks = buildDocumentBlocks(document, joinPagesWithTrace(document.pages.map(cleanPageWithTrace)));
  return buildSourceFactGraph(document, blocks);
}

function fixture() {
  const graph = graphFor(["场景：\n普通段落。\n▶钥匙：桌上有一把钥匙。"]);
  const draft = compileDeterministicTemplates(graph, { moduleId: "question-fixture" });
  return { graph, draft, queue: buildCompilerQuestionQueue(graph, draft) };
}

function validHints(): { queue: ReturnType<typeof fixture>["queue"]; hints: ModuleCompileHints } {
  const { queue } = fixture();
  const question = queue.questions.find((entry) => entry.kind === "core_clue")!;
  return {
    queue,
    hints: {
      schemaVersion: "1.0.0",
      documentHash: queue.documentHash,
      sourceGraphIdentity: queue.sourceGraphIdentity,
      resolutions: [{
        questionId: question.id,
        kind: question.kind,
        value: { clueCandidateId: question.subjectCandidateId, required: true },
        sourceStatementIds: [...question.sourceStatementIds],
        evidenceRefs: [...question.evidenceRefs],
        authority: "user_document",
        derivation: "explicit",
        reviewerKind: "human",
        reason: "synthetic explicit answer",
      }],
    },
  };
}

describe("CompilerQuestionQueue", () => {
  it("creates evidence-bound scene, entry, topology, core, and ending questions without answering them", () => {
    const { graph, draft, queue } = fixture();
    expect(queue.questions.filter((question) => question.kind === "scene_role")).toHaveLength(draft.sceneCandidates.length);
    expect(queue.questions.some((question) => question.kind === "entry_scene" && question.severity === "publish_blocking")).toBe(true);
    expect(queue.questions.some((question) => question.kind === "connection_topology" && question.severity === "publish_blocking")).toBe(true);
    expect(queue.questions.filter((question) => question.kind === "core_clue")).toHaveLength(draft.clueCandidates.length);
    expect(queue.questions.some((question) => question.kind === "ending_rule" && question.severity === "publish_blocking")).toBe(true);
    expect(queue.questions.every((question) => question.status === "open")).toBe(true);
    expect(draft.readiness.questionQueueHash).toBe(queue.queueHash);
    expect(draft.readiness.publishBlockingQuestionIds.length).toBeGreaterThan(0);
    expect(queue.questions.find((question) => question.kind === "entry_scene")?.sourceStatementIds).toEqual(draft.sceneCandidates.map((scene) => scene.headingStatementId).sort());
    expect(queue.questions.filter((question) => question.kind === "connection_topology").every((question) => question.candidateIds?.length === 1)).toBe(true);
    expect(queue.questions.filter((question) => question.kind === "core_clue").every((question) => question.status === "open" && question.severity === "draft_warning")).toBe(true);
    for (const code of draft.readiness.blockingCodes) expect(queue.questions.some((question) => question.blockingCode === code)).toBe(true);
    validateCompilerQuestionQueue(graph, queue);
  });

  it("records unresolved marked items and prose as questions without making them clues", () => {
    const graph = graphFor(["场景：\n普通段落。\n▶：无名正文。"]);
    const draft = compileDeterministicTemplates(graph, { moduleId: "question-fixture" });
    const queue = buildCompilerQuestionQueue(graph, draft);
    expect(draft.clueCandidates).toEqual([]);
    expect(queue.questions.some((question) => question.kind === "discovery_method" && question.prompt.includes("paragraph"))).toBe(true);
    expect(queue.questions.some((question) => question.kind === "discovery_method" && question.prompt.includes("marked item"))).toBe(true);
  });

  it("does not default the first heading when multiple scene candidates exist", () => {
    const graph = graphFor(["场景一：\n▶甲：正文。\n场景二：\n▶乙：正文。"]);
    const draft = compileDeterministicTemplates(graph, { moduleId: "question-fixture" });
    const queue = buildCompilerQuestionQueue(graph, draft);
    expect(queue.questions.find((question) => question.kind === "entry_scene")?.sourceStatementIds).toEqual(draft.sceneCandidates.map((scene) => scene.headingStatementId).sort());
    expect(queue.questions.filter((question) => question.kind === "connection_topology").every((question) => question.candidateIds?.length === 1)).toBe(true);
  });

  it("preserves exact statement evidence and creates distinct IDs for distinct evidence", () => {
    const graph = graphFor(["场景：\n▶钥匙：正文。\n▶钥匙：正文。"]);
    const draft = compileDeterministicTemplates(graph, { moduleId: "question-fixture" });
    const queue = buildCompilerQuestionQueue(graph, draft);
    const core = queue.questions.filter((question) => question.kind === "core_clue");
    expect(core).toHaveLength(2);
    expect(core[0]?.id).not.toBe(core[1]?.id);
    const statements = new Map(graph.statements.map((statement) => [statement.id, statement]));
    for (const question of queue.questions) for (const sourceId of question.sourceStatementIds) {
      const statement = statements.get(sourceId);
      if (!statement) throw new Error(`missing question source: ${sourceId}`);
      expect(question.evidenceRefs).toContain(statement.evidenceRefId);
    }
  });

  it("keeps question IDs stable when an unrelated block is added to the same document", () => {
    const document = createSyntheticDocumentIR(["场景：\n▶无关：正文。\n▶钥匙：正文。"], "compiler-question-queue-test");
    const blocks = buildDocumentBlocks(document, joinPagesWithTrace(document.pages.map(cleanPageWithTrace)));
    const firstGraph = buildSourceFactGraph(document, blocks.filter((block) => block.kind !== "marked_item" || block.text.startsWith("钥匙")));
    const fullGraph = buildSourceFactGraph(document, blocks);
    const firstDraft = compileDeterministicTemplates(firstGraph, { moduleId: "question-fixture" });
    const fullDraft = compileDeterministicTemplates(fullGraph, { moduleId: "question-fixture" });
    const first = buildCompilerQuestionQueue(firstGraph, firstDraft).questions.find((question) => question.kind === "core_clue")!;
    const full = buildCompilerQuestionQueue(fullGraph, fullDraft).questions.find((question) => question.kind === "core_clue" && question.candidateIds?.includes(fullDraft.clueCandidates.find((clue) => clue.displayName === "钥匙")!.id))!;
    expect(full.id).toBe(first.id);
  });

  it("fails closed for duplicate questions, dangling evidence, and invalid hints", () => {
    const { graph, queue } = fixture();
    const duplicate = structuredClone(queue);
    duplicate.questions.push(structuredClone(duplicate.questions[0]!));
    expect(() => validateCompilerQuestionQueue(graph, duplicate)).toThrow("duplicate question");
    const danglingEvidence = structuredClone(queue);
    danglingEvidence.questions[0]!.evidenceRefs = [];
    expect(() => validateCompilerQuestionQueue(graph, danglingEvidence)).toThrow("evidence");
    const { hints } = validHints();
    expect(() => validateModuleCompileHints(queue, hints)).not.toThrow();
    const wrongEvidence = structuredClone(hints);
    wrongEvidence.resolutions[0]!.evidenceRefs = [queue.questions.find((entry) => entry.kind === "entry_scene")!.evidenceRefs[0]!];
    expect(() => validateModuleCompileHints(queue, wrongEvidence)).toThrow("evidence");
    const wrongHash = structuredClone(hints);
    wrongHash.sourceGraphIdentity = "wrong";
    expect(() => validateModuleCompileHints(queue, wrongHash)).toThrow("identity");
    const unknownReference = structuredClone(hints);
    unknownReference.resolutions[0]!.value = { clueCandidateId: "invented", required: true };
    expect(() => validateModuleCompileHints(queue, unknownReference)).toThrow("unknown reference");
  });

  it("rejects conflicting resolutions and never defaults an open question", () => {
    const { queue, hints } = validHints();
    const conflict = structuredClone(hints);
    conflict.resolutions.push({ ...conflict.resolutions[0]!, value: false });
    expect(() => validateModuleCompileHints(queue, conflict)).toThrow("multiple resolutions");
    const defaulted = structuredClone(hints);
    defaulted.resolutions[0]!.derivation = "default";
    expect(() => validateModuleCompileHints(queue, defaulted)).toThrow("cannot be defaulted");
  });

  it("does not import world-model, runtime, dataset, or ModuleData loaders", () => {
    const imports = scanImports(readFileSync("src/compiler/compiler-question-queue.ts", "utf8"));
    for (const forbidden of ["world-model-loader", "cthulhu-dataset", "game-session", "module-data-runtime-loader", "mythos-module"]) {
      expect(imports.some((entry) => importPointsTo(entry.path, forbidden))).toBe(false);
    }
  });
});
