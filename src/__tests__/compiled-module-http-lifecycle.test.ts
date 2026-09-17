import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { handleCompiledModuleHttpRequest, COMPILER_HTTP_BODY_LIMIT_BYTES, type CompiledModuleHttpDependencies } from "../api/compiled-module-http";
import { prepareCompiler, resolveCompiler, type PreparedCompilerApiResult } from "../compiler/compiler-api";
import { projectResolvedCompilerArtifact, type ModuleDataPresentationMetadata } from "../compiler/compiler-module-data-projection";
import type { CompilerQuestion, CompilerQuestionResolution, ModuleCompileHints } from "../compiler/compiler-question-queue";

const PAGES = ["入口：\n▶父线索：一把档案室钥匙。\n档案室：\n▶子线索：一份必须读懂的档案。\n出口：\n▶出口说明：离开这里的旧车票。"];

function answer(question: CompilerQuestion, value: unknown): CompilerQuestionResolution {
  return { questionId: question.id, kind: question.kind, value, sourceStatementIds: [...question.sourceStatementIds], evidenceRefs: [...question.evidenceRefs], authority: "user_document", derivation: "explicit", reviewerKind: "human", rightsStatus: "user_provided", reason: "HTTP lifecycle fixture" };
}

function hints(prepared: PreparedCompilerApiResult): ModuleCompileHints {
  const { draft, preparedQueue: queue } = prepared.artifact.payload;
  const scene = (name: string) => draft.sceneCandidates.find((candidate) => candidate.displayName.startsWith(name))!;
  const clue = (name: string) => draft.clueCandidates.find((candidate) => candidate.displayName === name)!;
  const entry = scene("入口"), archive = scene("档案室"), exit = scene("出口"), parent = clue("父线索"), child = clue("子线索");
  const topology = (id: string) => queue.questions.find((question) => question.kind === "connection_topology" && question.subjectCandidateId === id)!;
  const core = (id: string) => queue.questions.find((question) => question.kind === "core_clue" && question.subjectCandidateId === id)!;
  const discovery = (id: string) => queue.questions.find((question) => question.kind === "discovery_method" && question.subjectCandidateId === id)!;
  return { schemaVersion: "1.1.0", moduleId: queue.moduleId, documentHash: queue.documentHash, sourceGraphIdentity: queue.sourceGraphIdentity, resolutions: [
    ...queue.questions.filter((question) => question.kind === "scene_role").map((question) => answer(question, { role: "playable_scene" })),
    answer(queue.questions.find((question) => question.kind === "entry_scene")!, { sceneCandidateId: entry.id }),
    answer(topology(entry.id), { connections: [{ toSceneCandidateId: archive.id, connectionId: "entry_archive", availability: { kind: "connection_unlocked", connectionId: "entry_archive" } }] }),
    answer(topology(archive.id), { connections: [{ toSceneCandidateId: exit.id, connectionId: "archive_exit" }] }), answer(topology(exit.id), { connections: [] }),
    answer(core(parent.id), { clueCandidateId: parent.id, required: false }), answer(core(child.id), { clueCandidateId: child.id, required: true }),
    answer(discovery(parent.id), { clueCandidateId: parent.id, locationSceneCandidateId: entry.id, spec: { kind: "discovery_method", id: "find_parent", clueId: parent.id, action: "search", target: "scene", targetId: entry.id, onSuccess: [{ kind: "discover_clue", clueId: parent.id }, { kind: "unlock_connection", connectionId: "entry_archive" }] } }),
    answer(discovery(child.id), { clueCandidateId: child.id, locationSceneCandidateId: archive.id, spec: { kind: "discovery_method", id: "find_child", clueId: child.id, action: "read", target: "scene", targetId: archive.id, availability: { kind: "clue_found", clueId: parent.id }, check: { kind: "skill", skill: "library_use", difficulty: "hard" }, onSuccess: [{ kind: "discover_clue", clueId: child.id }], failback: { maxFailures: 2, effects: [{ kind: "discover_clue", clueId: child.id }] } } }),
    answer(queue.questions.find((question) => question.kind === "ending_rule")!, { declarations: [
      { endingId: "clean", spec: { kind: "ending_rule", id: "rule_clean", priority: 10, when: { kind: "all", predicates: [{ kind: "clue_found", clueId: child.id }, { kind: "scene_visited", sceneId: exit.id }] }, effects: [{ kind: "end_game", endingId: "clean" }] } },
      { endingId: "hasty", spec: { kind: "ending_rule", id: "rule_hasty", priority: 20, when: { kind: "all", predicates: [{ kind: "scene_visited", sceneId: exit.id }, { kind: "not", predicate: { kind: "clue_found", clueId: child.id } }] }, effects: [{ kind: "end_game", endingId: "hasty" }] } },
    ] }),
  ] };
}

async function fixture() {
  const prepared = await prepareCompiler({ kind: "synthetic_pages", moduleId: "http-fixture", sourceDescriptor: "http-fixture", pages: PAGES });
  if (prepared.status === "refused") throw new Error(prepared.message);
  const resolved = resolveCompiler(prepared.artifact, prepared.identity.preparedQueueHash, hints(prepared));
  if (resolved.status === "refused") throw new Error(resolved.message);
  const payload: any = resolved.artifact.payload;
  const metadata: ModuleDataPresentationMetadata = {
    module: { title: "HTTP fixture", version: "1", ruleset: "cosmic-horror", era: "test", summary: "caller supplied", playerCount: "1", expectedDuration: "short", triggerWarnings: [] },
    scenes: Object.fromEntries(payload.mechanicsIR.symbols.sceneIds.map((id: string) => [id, { description: `scene:${id}` }])),
    connections: Object.fromEntries(payload.analysisInput.connections.map((connection: any) => [connection.id, { condition: `connection:${connection.id}` }])),
    clues: Object.fromEntries(payload.mechanicsIR.symbols.clueIds.map((id: string) => [id, { findMethods: [], revelation: `revelation:${id}`, unlocks: [], importance: "core" }])),
    endings: Object.fromEntries(payload.mechanicsIR.endings.map((ending: any) => [ending.effects.find((effect: any) => effect.kind === "end_game").endingId, { name: `ending:${ending.id}`, description: `ending:${ending.id}`, conditions: ["declared"] }])),
  };
  const projection = projectResolvedCompilerArtifact(payload, metadata);
  if (projection.status === "refused") throw new Error(projection.message);
  return { prepared, resolved, projection };
}

function pdf(text: string): Uint8Array {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text}) Tj\nET\n`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${stream.length} >>\nstream\n${stream}endstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = out.length; out += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function dependencies(calls = { factory: 0, registered: 0, persisted: 0 }): CompiledModuleHttpDependencies {
  return { generateId: () => "compiled1", hasSession: () => false, createSession: () => { calls.factory++; return { loadCompiledModule: (_payload: any, _projection: any) => ({ status: "loaded", compiled: { moduleId: "http-fixture", artifactHash: "artifact", mechanicsHash: "mechanics", state: {}, stateHash: "state", trace: [] } }), getCharacterSummary: () => ({ id: "p1" }), getSummary: () => ({ id: "compiled1", scene: "entry" }), getCompiledMechanicsState: () => null } as any; }, registerSession: () => { calls.registered++; }, persistSession: () => { calls.persisted++; } };
}

describe("compiled module HTTP lifecycle", () => {
  it("prepares deterministic actual PDF bytes and preserves their byte identity", async () => {
    const request = () => new Request("http://test/api/compiler/prepare?moduleId=pdf-module", { method: "POST", headers: { "Content-Type": "Application/PDF; charset=binary" }, body: pdf("Entry:") });
    const first = await handleCompiledModuleHttpRequest(request(), dependencies());
    const second = await handleCompiledModuleHttpRequest(request(), dependencies());
    expect(first?.status).toBe(201); expect(await first?.json()).toMatchObject({ status: "prepared", identity: { documentHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(await second?.text()).toBe(await (await handleCompiledModuleHttpRequest(request(), dependencies()))?.text());
  });

  it("maps media, body, JSON, and compiler refusals without throwing", async () => {
    const cases = [
      new Request("http://test/api/compiler/prepare", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf("Entry:") }),
      new Request("http://test/api/compiler/prepare?moduleId=x", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" }),
      new Request("http://test/api/compiler/prepare?moduleId=x", { method: "POST", headers: { "Content-Type": "application/pdf", "Content-Length": String(COMPILER_HTTP_BODY_LIMIT_BYTES + 1) }, body: pdf("Entry:") }),
      new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    ];
    for (const request of cases) { const response = await handleCompiledModuleHttpRequest(request, dependencies()); expect(response?.status).toBeGreaterThanOrEqual(400); expect(await response?.json()).toHaveProperty("error.stage"); }
  });

  it("resolves a JSON-round-tripped artifact and validates before injected session side effects", async () => {
    const value = await fixture();
    const resolveResponse = await handleCompiledModuleHttpRequest(new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preparedArtifact: JSON.parse(JSON.stringify(value.prepared.artifact)), preparedQueueHash: value.prepared.identity.preparedQueueHash, hints: hints(value.prepared), presentation: { module: { title: "HTTP", version: "1", ruleset: "cosmic-horror", era: "test", summary: "summary", playerCount: "1", expectedDuration: "short", triggerWarnings: [] }, scenes: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.symbols.sceneIds.map((id: string) => [id, { description: id }])), connections: Object.fromEntries((value.resolved.artifact.payload as any).analysisInput.connections.map((c: any) => [c.id, { condition: c.id }])), clues: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.symbols.clueIds.map((id: string) => [id, { findMethods: [], revelation: id, unlocks: [], importance: "core" }])), endings: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.endings.map((e: any) => [e.effects.find((x: any) => x.kind === "end_game").endingId, { name: e.id, description: e.id, conditions: ["declared"] }])) } }) }), dependencies());
    expect(resolveResponse?.status).toBe(200);
    const calls = { factory: 0, registered: 0, persisted: 0 };
    const tampered = structuredClone(value.resolved.artifact); (tampered as any).artifactHash = "tampered";
    const bad = await handleCompiledModuleHttpRequest(new Request("http://test/api/sessions/compiled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolvedArtifact: tampered, projection: value.projection, archetype: "investigator", characterName: "Ada" }) }), dependencies(calls));
    expect(bad?.status).toBe(422); expect(calls).toEqual({ factory: 0, registered: 0, persisted: 0 });
    const good = await handleCompiledModuleHttpRequest(new Request("http://test/api/sessions/compiled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolvedArtifact: value.resolved.artifact, projection: value.projection, archetype: "investigator", characterName: "Ada" }) }), dependencies(calls));
    expect(good?.status).toBe(201); expect(calls).toEqual({ factory: 1, registered: 1, persisted: 1 });
  });

  it("keeps HTTP orchestration on public boundaries, not diagnostics or a second resolver", () => {
    const source = readFileSync("src/api/compiled-module-http.ts", "utf8");
    expect(source).toContain("prepareCompiler"); expect(source).toContain("resolveCompiler"); expect(source).toContain("projectResolvedCompilerArtifact"); expect(source).toContain("GameSession");
    expect(source).not.toMatch(/diagnostics|resolveDraftModule|mechanics-reachability/i);
  });
});
