import { describe, expect, it } from "bun:test";
import { applyModuleCompileHints, parseCompilerHintValue, resolveDraftModule } from "../compiler/compile-hint-resolution";
import { buildCompilerQuestionQueue, type ModuleCompileHints } from "../compiler/compiler-question-queue";
import { compileDeterministicTemplates } from "../compiler/deterministic-template-compiler";
import { buildSourceFactGraph } from "../compiler/source-fact-graph";
import { cleanPageWithTrace, joinPagesWithTrace } from "../ingest/clean-text";
import { buildDocumentBlocks } from "../ingest/document-blocks";
import { createSyntheticDocumentIR } from "../ingest/document-ir";

function fixture() {
  const document = createSyntheticDocumentIR(["场景一：\n▶甲：正文。\n场景二：\n▶乙：正文。"], "p7-resolution-fixture");
  const blocks = buildDocumentBlocks(document, joinPagesWithTrace(document.pages.map(cleanPageWithTrace)));
  const graph = buildSourceFactGraph(document, blocks);
  const draft = compileDeterministicTemplates(graph, { moduleId: "p7-resolution-fixture" });
  return { graph, draft, queue: buildCompilerQuestionQueue(graph, draft) };
}

function hints(queue: ReturnType<typeof fixture>["queue"]): ModuleCompileHints {
  const role = queue.questions.find((question) => question.kind === "scene_role")!;
  return { schemaVersion: "1.0.0", documentHash: queue.documentHash, sourceGraphIdentity: queue.sourceGraphIdentity, resolutions: [{ questionId: role.id, kind: "scene_role", value: { role: "playable_scene" }, sourceStatementIds: [...role.sourceStatementIds], evidenceRefs: [...role.evidenceRefs], authority: "user_document", derivation: "explicit", reviewerKind: "human", reason: "synthetic explicit scene role" }] };
}

describe("compile hint resolution", () => {
  it("answers only explicitly hinted questions and leaves partial drafts draft_only", () => {
    const { graph, draft, queue } = fixture();
    const resolved = applyModuleCompileHints(graph, queue, hints(queue));
    expect(resolved.questions.filter((question) => question.status === "answered")).toHaveLength(1);
    expect(resolved.questions.some((question) => question.kind === "entry_scene" && question.status === "open")).toBe(true);
    expect(resolveDraftModule(graph, draft, queue, hints(queue)).readiness.status).toBe("draft_only");
  });

  it("allows topology targets only from the question allowlist and core only from its subject", () => {
    const { queue } = fixture();
    const topology = queue.questions.find((question) => question.kind === "connection_topology")!;
    expect(() => parseCompilerHintValue(topology, { fromSceneCandidateId: topology.subjectCandidateId, toSceneCandidateId: "invented", connectionId: "connection_x" })).toThrow("unallowed");
    const core = queue.questions.find((question) => question.kind === "core_clue")!;
    expect(() => parseCompilerHintValue(core, { clueCandidateId: "invented", required: true })).toThrow("subject");
  });

  it("rejects unsupported hint kinds before marking their questions answered", () => {
    const { graph, queue } = fixture();
    const item = queue.questions.find((question) => question.kind === "item_binding")!;
    const bad: ModuleCompileHints = {
      schemaVersion: "1.0.0", documentHash: queue.documentHash, sourceGraphIdentity: queue.sourceGraphIdentity,
      resolutions: [{ questionId: item.id, kind: "item_binding", value: { itemCandidateId: item.subjectCandidateId }, sourceStatementIds: [...item.sourceStatementIds], evidenceRefs: [...item.evidenceRefs], authority: "user_document", derivation: "explicit", reviewerKind: "human", reason: "unsupported in P8" }],
    };
    expect(() => applyModuleCompileHints(graph, queue, bad)).toThrow("unsupported_hint_kind");
  });
});
