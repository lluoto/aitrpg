import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createPreparedCompilerArtifact,
  createResolvedCompilerArtifact,
  resolvePreparedCompilerArtifact,
  restoreCompilerArtifact,
  sealCompilerArtifact,
  type CompilerArtifactEnvelope,
  type PreparedCompilerArtifactPayload,
  type ResolvedCompilerArtifactPayload,
} from "../compiler/compiler-artifact";
import { compilerArtifactNodeFileOps, loadCompilerArtifact, saveCompilerArtifact } from "../compiler/compiler-artifact-store";
import { type CompilerQuestion, type CompilerQuestionResolution, type ModuleCompileHints } from "../compiler/compiler-question-queue";
import {
  prepareCompilerProcessSimulation,
  resolveCompilerProcessSimulation,
  type PreparedCompilerProcessSimulation,
} from "../diagnostics/compiler-process-simulation";

const dirs: string[] = [];
const INPUT = {
  moduleId: "compiler-artifact-fixture",
  sourceDescriptor: "compiler-artifact-fixture",
  rawPages: ["入口：\n▶父线索：一把刻有档案室标记的钥匙。\n档案室：\n▶子线索：一份需要检定才能读懂的档案。\n出口：\n▶出口说明：离开这里的旧车票。"],
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function prepared(): PreparedCompilerProcessSimulation {
  const value = prepareCompilerProcessSimulation(INPUT);
  if ("status" in value) throw new Error(value.message);
  return value;
}

function resolution(question: CompilerQuestion, value: unknown): CompilerQuestionResolution {
  return {
    questionId: question.id,
    kind: question.kind,
    value,
    sourceStatementIds: [...question.sourceStatementIds],
    evidenceRefs: [...question.evidenceRefs],
    authority: "user_document",
    derivation: "explicit",
    reviewerKind: "human",
    rightsStatus: "user_provided",
    reason: "explicit artifact fixture declaration bound to this queue evidence",
  };
}

function hints(value: PreparedCompilerProcessSimulation): ModuleCompileHints {
  const { draft, queue } = value;
  const scene = (name: string) => draft.sceneCandidates.find((candidate) => candidate.displayName.startsWith(name))!;
  const clue = (name: string) => draft.clueCandidates.find((candidate) => candidate.displayName === name)!;
  const entry = scene("入口");
  const archive = scene("档案室");
  const exit = scene("出口");
  const parent = clue("父线索");
  const child = clue("子线索");
  const topology = (sceneId: string) => queue.questions.find((question) => question.kind === "connection_topology" && question.subjectCandidateId === sceneId)!;
  const core = (clueId: string) => queue.questions.find((question) => question.kind === "core_clue" && question.subjectCandidateId === clueId)!;
  const discovery = (clueId: string) => queue.questions.find((question) => question.kind === "discovery_method" && question.subjectCandidateId === clueId)!;
  const entryQuestion = queue.questions.find((question) => question.kind === "entry_scene")!;
  const endingQuestion = queue.questions.find((question) => question.kind === "ending_rule")!;
  return {
    schemaVersion: "1.1.0",
    moduleId: queue.moduleId,
    documentHash: queue.documentHash,
    sourceGraphIdentity: queue.sourceGraphIdentity,
    resolutions: [
      ...queue.questions.filter((question) => question.kind === "scene_role").map((question) => resolution(question, { role: "playable_scene" })),
      resolution(entryQuestion, { sceneCandidateId: entry.id }),
      resolution(topology(entry.id), { connections: [{ toSceneCandidateId: archive.id, connectionId: "connection_entry_archive" }, { toSceneCandidateId: exit.id, connectionId: "connection_entry_exit" }] }),
      resolution(topology(archive.id), { connections: [{ toSceneCandidateId: entry.id, connectionId: "connection_archive_entry" }, { toSceneCandidateId: exit.id, connectionId: "connection_archive_exit", availability: { kind: "connection_unlocked", connectionId: "connection_archive_exit" } }] }),
      resolution(topology(exit.id), { connections: [] }),
      resolution(core(parent.id), { clueCandidateId: parent.id, required: false }),
      resolution(core(child.id), { clueCandidateId: child.id, required: true }),
      resolution(discovery(parent.id), { clueCandidateId: parent.id, locationSceneCandidateId: entry.id, spec: { kind: "discovery_method", id: "discover_parent_explicit", clueId: parent.id, action: "search", target: "scene", targetId: entry.id, onSuccess: [{ kind: "discover_clue", clueId: parent.id }] } }),
      resolution(discovery(child.id), { clueCandidateId: child.id, locationSceneCandidateId: archive.id, spec: { kind: "discovery_method", id: "discover_child_checked", clueId: child.id, action: "read", target: "scene", targetId: archive.id, availability: { kind: "clue_found", clueId: parent.id }, check: { kind: "skill", skill: "library_use", difficulty: "hard" }, onSuccess: [{ kind: "discover_clue", clueId: child.id }, { kind: "unlock_connection", connectionId: "connection_archive_exit" }], failback: { maxFailures: 2, effects: [{ kind: "discover_clue", clueId: child.id }, { kind: "unlock_connection", connectionId: "connection_archive_exit" }] } } }),
      resolution(endingQuestion, { declarations: [
        { endingId: "ending_clean_escape", spec: { kind: "ending_rule", id: "rule_clean_escape", priority: 10, when: { kind: "all", predicates: [{ kind: "clue_found", clueId: child.id }, { kind: "scene_visited", sceneId: exit.id }] }, effects: [{ kind: "end_game", endingId: "ending_clean_escape" }] } },
        { endingId: "ending_hasty_exit", spec: { kind: "ending_rule", id: "rule_hasty_exit", priority: 20, when: { kind: "all", predicates: [{ kind: "scene_visited", sceneId: exit.id }, { kind: "not", predicate: { kind: "clue_found", clueId: child.id } }] }, effects: [{ kind: "end_game", endingId: "ending_hasty_exit" }] } },
      ] }),
    ],
  };
}

function artifactPrepared(value = prepared()): PreparedCompilerArtifactPayload {
  return { identity: structuredClone(value.identity), graph: structuredClone(value.graph), draft: structuredClone(value.draft), preparedQueue: structuredClone(value.queue) };
}

function artifactResolved(): ResolvedCompilerArtifactPayload {
  const source = prepared();
  return resolvePreparedCompilerArtifact(artifactPrepared(source), hints(source));
}

function reseal(envelope: CompilerArtifactEnvelope, mutate: (copy: any) => void): CompilerArtifactEnvelope {
  const copy = structuredClone(envelope) as any;
  mutate(copy);
  delete copy.artifactHash;
  return sealCompilerArtifact(copy);
}

function expectRefusal(value: unknown, code: string): void {
  expect(value).toMatchObject({ status: "refused", code });
}

describe("compiler artifact persistence", () => {
  it("round trips prepared JSON through atomic local storage", () => {
    const envelope = createPreparedCompilerArtifact(artifactPrepared());
    const dir = mkdtempSync(join(tmpdir(), "compiler-artifact-"));
    dirs.push(dir);
    const path = join(dir, "prepared.json");
    saveCompilerArtifact(path, envelope);
    const loaded = loadCompilerArtifact(path);
    if (loaded.status === "refused") throw new Error(loaded.message);
    expect(loaded.stage).toBe("prepared");
    expect(loaded.artifactHash).toBe(envelope.artifactHash);
    expect(loaded.payload.preparedQueue).toEqual(envelope.payload.preparedQueue);
  });

  it("round trips resolved JSON and resumed prepared output equals fresh complete re-resolution", () => {
    const resolved = artifactResolved();
    const envelope = createResolvedCompilerArtifact(resolved);
    const dir = mkdtempSync(join(tmpdir(), "compiler-artifact-"));
    dirs.push(dir);
    const path = join(dir, "resolved.json");
    saveCompilerArtifact(path, envelope);
    const loaded = loadCompilerArtifact(path);
    if (loaded.status === "refused") throw new Error(loaded.message);
    expect(loaded.stage).toBe("resolved");
    if (loaded.stage !== "resolved") throw new Error("expected resolved artifact");
    const fresh = resolvePreparedCompilerArtifact(loaded.payload, loaded.payload.hints);
    expect(loaded.payload).toEqual(fresh);
    expect(loaded.payload.acceptedInterpretations).toEqual(resolved.acceptedInterpretations);
    expect(loaded.payload.mechanicsIR.mechanicsHash).toBe(resolved.mechanicsIR.mechanicsHash);
  });

  it("rejects rehashed changes to source, scope, graph, queue, review, accepted, and mechanics components", () => {
    const envelope = createResolvedCompilerArtifact(artifactResolved());
    const changes: Array<[string, (copy: any) => void]> = [
      ["page", (copy) => { copy.payload.graph.documentIdentity.pages[0].rawText = "changed"; }],
      ["scope", (copy) => { copy.payload.draft.moduleId = "foreign"; }],
      ["graph", (copy) => { copy.payload.identity.sourceGraphIdentity = "0".repeat(64); }],
      ["queue", (copy) => { copy.payload.preparedQueue.queueHash = "0".repeat(64); }],
      ["review", (copy) => { copy.payload.acceptedInterpretations[0].review.reviewEvidenceStatementIds = []; }],
      ["accepted", (copy) => { copy.payload.acceptedInterpretations.pop(); }],
      ["mechanics", (copy) => { copy.payload.mechanicsIR.mechanicsHash = "0".repeat(64); }],
    ];
    for (const [_label, mutate] of changes) {
      const result = restoreCompilerArtifact(reseal(envelope, mutate));
      expect(result.status).toBe("refused");
    }
  });

  it("rejects unknown root/component versions and identity substitution", () => {
    const preparedEnvelope = createPreparedCompilerArtifact(artifactPrepared());
    expectRefusal(restoreCompilerArtifact(reseal(preparedEnvelope, (copy) => { copy.schemaVersion = "unknown"; })), "ARTIFACT_SCHEMA_MISMATCH");
    expectRefusal(restoreCompilerArtifact(reseal(preparedEnvelope, (copy) => { copy.componentVersions.preparedQueue = "unknown"; })), "ARTIFACT_COMPONENT_VERSION_MISMATCH");
    const queueSubstitution = structuredClone(preparedEnvelope);
    queueSubstitution.artifactHash = queueSubstitution.payload.identity.preparedQueueHash;
    expectRefusal(restoreCompilerArtifact(queueSubstitution), "ARTIFACT_HASH_MISMATCH");
    const resolvedEnvelope = createResolvedCompilerArtifact(artifactResolved());
    const mechanicsSubstitution = structuredClone(resolvedEnvelope);
    mechanicsSubstitution.artifactHash = (mechanicsSubstitution.payload as ResolvedCompilerArtifactPayload).identity.mechanicsHash;
    expectRefusal(restoreCompilerArtifact(mechanicsSubstitution), "ARTIFACT_HASH_MISMATCH");
  });

  it("preserves the previous valid artifact when atomic replacement fails", () => {
    const first = createPreparedCompilerArtifact(artifactPrepared());
    const second = createPreparedCompilerArtifact(artifactPrepared());
    const dir = mkdtempSync(join(tmpdir(), "compiler-artifact-"));
    dirs.push(dir);
    const path = join(dir, "atomic.json");
    saveCompilerArtifact(path, first);
    const previous = readFileSync(path, "utf8");
    const failing = { ...compilerArtifactNodeFileOps, replace: () => { throw new Error("replace failed"); } };
    expect(() => saveCompilerArtifact(path, second, failing)).toThrow("replace failed");
    expect(readFileSync(path, "utf8")).toBe(previous);
  });

  it("does not relax diagnostics detached-clone refusal", () => {
    const source = prepared();
    const detached = structuredClone(source);
    const result = resolveCompilerProcessSimulation(detached, { preparedQueueHash: detached.identity.preparedQueueHash, hints: hints(detached) });
    expect(result).toMatchObject({ status: "refused", stage: "questions", code: "QUESTIONS_IDENTITY_MISMATCH" });
  });
});
