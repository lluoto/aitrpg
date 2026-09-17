import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleCompiledModuleHttpRequest, COMPILER_HTTP_BODY_LIMIT_BYTES, type CompiledModuleHttpDependencies } from "../api/compiled-module-http";
import { prepareCompiler, resolveCompiler, type PreparedCompilerApiResult } from "../compiler/compiler-api";
import { projectResolvedCompilerArtifact, type ModuleDataPresentationMetadata } from "../compiler/compiler-module-data-projection";
import type { CompilerQuestion, CompilerQuestionResolution, ModuleCompileHints } from "../compiler/compiler-question-queue";
import { CompilerArtifactCatalog } from "../compiler/compiler-artifact-catalog";
import { mechanicsStateHash } from "../compiler/mechanics-execution";
import { handleRequest } from "../api/server";

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

function firstPathHints(prepared: PreparedCompilerApiResult): ModuleCompileHints {
  const { draft, preparedQueue: queue } = prepared.artifact.payload;
  const [entry, archive, exit] = draft.sceneCandidates;
  const [parent, child] = draft.clueCandidates;
  if (!entry || !archive || !exit || !parent || !child) throw new Error("real PDF fixture did not produce the required path candidates");
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

export async function compiledModuleHttpFixture() {
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
  const hex = (value: string) => [...value].map((character) => character.codePointAt(0)!.toString(16).padStart(4, "0")).join("");
  const lines = text.split("\n").map((line) => `<${hex(line)}> Tj\nT*`).join("\n");
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n20 TL\n${lines}\nET\n`;
  const byteLength = (value: string) => new TextEncoder().encode(value).length;
  const cmap = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 /CIDToGIDMap /Identity >>",
    `<< /Length ${byteLength(cmap)} >>\nstream\n${cmap}endstream`,
    "<< /Type /FontDescriptor /FontName /Helvetica /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
  ];
  let out = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(byteLength(out)); out += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = byteLength(out); out += `xref\n0 9\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function stream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function dependencies(calls = { factory: 0, registered: 0, persisted: 0 }, catalog = new CompilerArtifactCatalog({ root: join(tmpdir(), `compiled-http-${crypto.randomUUID()}`) })): CompiledModuleHttpDependencies {
  return { generateId: () => "compiled1", hasSession: () => false, createSession: () => { calls.factory++; return { loadCompiledModule: (_payload: any, _projection: any) => ({ status: "loaded", compiled: { moduleId: "http-fixture", artifactHash: "artifact", mechanicsHash: "mechanics", state: {}, stateHash: "state", trace: [] } }), getCharacterSummary: () => ({ id: "p1" }), getSummary: () => ({ id: "compiled1", scene: "entry" }), getCompiledMechanicsState: () => null } as any; }, registerSession: () => { calls.registered++; }, persistSession: () => { calls.persisted++; }, catalog };
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

  it("bounds unknown-length streams at the exact compiler limit and classifies Content-Length", async () => {
    const exact = new Uint8Array(COMPILER_HTTP_BODY_LIMIT_BYTES); exact.fill(0x20);
    const accepted = await handleCompiledModuleHttpRequest(new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream(exact) }), dependencies());
    expect(accepted?.status).toBe(400);
    expect(await accepted?.json()).toMatchObject({ error: { code: "JSON_INVALID" } });
    const rejected = await handleCompiledModuleHttpRequest(new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream(new Uint8Array(COMPILER_HTTP_BODY_LIMIT_BYTES), new Uint8Array([0x20])) }), dependencies());
    expect(rejected?.status).toBe(413);
    expect(await rejected?.json()).toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
    const malformed = await handleCompiledModuleHttpRequest(new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "-1" }, body: "{}" }), dependencies());
    expect(malformed?.status).toBe(400);
    expect(await malformed?.json()).toMatchObject({ error: { code: "CONTENT_LENGTH_INVALID" } });
  });

  it("resolves a JSON-round-tripped artifact and validates before injected session side effects", async () => {
    const value = await compiledModuleHttpFixture();
    const resolveResponse = await handleCompiledModuleHttpRequest(new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preparedArtifact: JSON.parse(JSON.stringify(value.prepared.artifact)), preparedQueueHash: value.prepared.identity.preparedQueueHash, hints: hints(value.prepared), presentation: { module: { title: "HTTP", version: "1", ruleset: "cosmic-horror", era: "test", summary: "summary", playerCount: "1", expectedDuration: "short", triggerWarnings: [] }, scenes: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.symbols.sceneIds.map((id: string) => [id, { description: id }])), connections: Object.fromEntries((value.resolved.artifact.payload as any).analysisInput.connections.map((c: any) => [c.id, { condition: c.id }])), clues: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.symbols.clueIds.map((id: string) => [id, { findMethods: [], revelation: id, unlocks: [], importance: "core" }])), endings: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.endings.map((e: any) => [e.effects.find((x: any) => x.kind === "end_game").endingId, { name: e.id, description: e.id, conditions: ["declared"] }])) } }) }), dependencies());
    expect(resolveResponse?.status).toBe(200);
    const calls = { factory: 0, registered: 0, persisted: 0 };
    const tampered = structuredClone(value.resolved.artifact); (tampered as any).artifactHash = "tampered";
    const bad = await handleCompiledModuleHttpRequest(new Request("http://test/api/sessions/compiled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolvedArtifact: tampered, projection: value.projection, archetype: "investigator", characterName: "Ada" }) }), dependencies(calls));
    expect(bad?.status).toBe(422); expect(calls).toEqual({ factory: 0, registered: 0, persisted: 0 });
    const good = await handleCompiledModuleHttpRequest(new Request("http://test/api/sessions/compiled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolvedArtifact: value.resolved.artifact, projection: value.projection, archetype: "investigator", characterName: "Ada" }) }), dependencies(calls));
    expect(good?.status).toBe(201); expect(calls).toEqual({ factory: 1, registered: 1, persisted: 1 });
  });

  it("normalizes valid archetypes and rolls back failed compiled-session commits", async () => {
    const value = await compiledModuleHttpFixture();
    const request = (archetype = " investigator ") => new Request("http://test/api/sessions/compiled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolvedArtifact: value.resolved.artifact, projection: value.projection, archetype, characterName: " Ada " }) });
    const seen: string[] = [];
    const good = await handleCompiledModuleHttpRequest(request(), { ...dependencies(), createSession: (_id, archetype, name) => {
      seen.push(`${archetype}/${name}`);
      return dependencies().createSession("compiled1", archetype, name, {});
    } });
    expect(good?.status).toBe(201);
    expect(seen).toEqual(["investigator/Ada"]);
    const unknown = await handleCompiledModuleHttpRequest(request("not-an-archetype"), dependencies());
    expect(unknown?.status).toBe(422);
    expect(await unknown?.json()).toMatchObject({ error: { code: "ARCHETYPE_UNKNOWN" } });

    const calls = { factory: 0, registered: 0, persisted: 0, rolledBack: 0, unregistered: 0 };
    const failedPersistence = await handleCompiledModuleHttpRequest(request("investigator"), {
      ...dependencies(calls),
      persistSession: () => { calls.persisted++; throw new Error("disk full"); },
      rollbackSessionStorage: () => { calls.rolledBack++; },
      unregisterSession: () => { calls.unregistered++; },
    });
    expect(failedPersistence?.status).toBe(500);
    expect(calls).toMatchObject({ factory: 1, persisted: 1, registered: 0, rolledBack: 1, unregistered: 1 });

    const failedRegistration = await handleCompiledModuleHttpRequest(request("investigator"), {
      ...dependencies(calls),
      registerSession: () => { calls.registered++; throw new Error("registry failure"); },
      rollbackSessionStorage: () => { calls.rolledBack++; },
      unregisterSession: () => { calls.unregistered++; },
    });
    expect(failedRegistration?.status).toBe(500);
    expect(calls).toMatchObject({ registered: 1, rolledBack: 2, unregistered: 2 });
  });

  it("applies production CORS to compiled refusals over an ephemeral Bun server", async () => {
    const root = mkdtempSync(join(tmpdir(), "compiled-http-server-"));
    const catalog = new CompilerArtifactCatalog({ root });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handleRequest(request, catalog) });
    try {
      const semantic = await fetch(`http://127.0.0.1:${server.port}/api/compiler/prepare?moduleId=x`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
      expect(semantic.status).toBe(415);
      expect(semantic.headers.get("access-control-allow-origin")).toBe("*");
      const oversized = await fetch(`http://127.0.0.1:${server.port}/api/compiler/prepare?moduleId=x`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(COMPILER_HTTP_BODY_LIMIT_BYTES + 1) });
      expect(oversized.status).toBe(413);
      expect(oversized.headers.get("access-control-allow-origin")).toBe("*");
      const options = await fetch(`http://127.0.0.1:${server.port}/api/compiler/prepare`, { method: "OPTIONS" });
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-origin")).toBe("*");
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs the real HTTP PDF-to-terminal-compiled-session chain", async () => {
    const root = mkdtempSync(join(tmpdir(), "compiled-http-chain-"));
    const catalog = new CompilerArtifactCatalog({ root });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handleRequest(request, catalog) });
    let sessionId: string | undefined;
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const preparedResponse = await fetch(`${base}/api/compiler/prepare?moduleId=real-http-fixture`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf(PAGES[0]!) });
      expect(preparedResponse.status).toBe(201);
      const prepared = await preparedResponse.json() as PreparedCompilerApiResult & { preparedArtifactId: string };
      const resolvedHints = firstPathHints(prepared);
      const localResolved = resolveCompiler(prepared.artifact, prepared.identity.preparedQueueHash, resolvedHints);
      if (localResolved.status === "refused") throw new Error(localResolved.message);
      const payload: any = localResolved.artifact.payload;
      const presentation = {
        module: { title: "HTTP chain", version: "1", ruleset: "cosmic-horror", era: "test", summary: "network", playerCount: "1", expectedDuration: "short", triggerWarnings: [] },
        scenes: Object.fromEntries(payload.mechanicsIR.symbols.sceneIds.map((id: string) => [id, { description: `scene:${id}` }])),
        connections: Object.fromEntries(payload.analysisInput.connections.map((connection: any) => [connection.id, { condition: `connection:${connection.id}` }])),
        clues: Object.fromEntries(payload.mechanicsIR.symbols.clueIds.map((id: string) => [id, { findMethods: [], revelation: `revelation:${id}`, unlocks: [], importance: "core" }])),
        endings: Object.fromEntries(payload.mechanicsIR.endings.map((ending: any) => [ending.effects.find((effect: any) => effect.kind === "end_game").endingId, { name: `ending:${ending.id}`, description: `ending:${ending.id}`, conditions: ["declared"] }])),
      };
      const resolvedResponse = await fetch(`${base}/api/compiler/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preparedArtifactId: prepared.preparedArtifactId, preparedQueueHash: prepared.identity.preparedQueueHash, hints: resolvedHints, presentation }) });
      expect(resolvedResponse.status).toBe(200);
      const resolved = await resolvedResponse.json() as { bundleId: string; artifact: { artifactHash: string }; identity: { mechanicsHash: string } };
      expect(resolved.artifact.artifactHash).toBe(localResolved.artifact.artifactHash);
      expect(resolved.identity.mechanicsHash).toBe((localResolved.artifact.payload as any).identity.mechanicsHash);
      const sessionResponse = await fetch(`${base}/api/sessions/compiled`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bundleId: resolved.bundleId, archetype: "investigator", characterName: "Ada" }) });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json() as { sessionId: string; compiled: { artifactHash: string; mechanicsHash: string } };
      sessionId = session.sessionId;
      expect(session.compiled).toMatchObject({ artifactHash: resolved.artifact.artifactHash, mechanicsHash: resolved.identity.mechanicsHash });
      const action = async (input: string) => {
        const response = await fetch(`${base}/api/sessions/${session.sessionId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
        expect(response.status).toBe(200);
        return response.json() as Promise<{ compiled: { terminalEnding?: { id: string }; state: any; stateHash: string } }>;
      };
      const methods = payload.mechanicsIR.discoveryMethods;
      const parent = methods.find((method: any) => method.id === "find_parent")!;
      const child = methods.find((method: any) => method.id === "find_child")!;
      const entry = payload.mechanicsIR.connections.find((connection: any) => connection.connectionId === "entry_archive")!;
      const exit = payload.mechanicsIR.connections.find((connection: any) => connection.connectionId === "archive_exit")!;
      await action(`@compiled ${parent.id}`);
      await action(`@compiled ${entry.id}`);
      const firstChild = await action(`@compiled ${child.id}`);
      if (!firstChild.compiled.state.foundClueIds.includes(child.clueId)) await action(`@compiled ${child.id}`);
      const ending = await action(`@compiled ${exit.id}`);
      expect(ending.compiled.terminalEnding).toBeDefined();
      expect(ending.compiled.stateHash).toBe(mechanicsStateHash(ending.compiled.state));
    } finally {
      server.stop(true);
      if (sessionId) rmSync(join("data", "careers", sessionId), { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps HTTP orchestration on public boundaries, not diagnostics or a second resolver", () => {
    const source = readFileSync("src/api/compiled-module-http.ts", "utf8");
    expect(source).toContain("prepareCompiler"); expect(source).toContain("resolveCompiler"); expect(source).toContain("projectResolvedCompilerArtifact"); expect(source).toContain("GameSession");
    expect(source).not.toMatch(/diagnostics|resolveDraftModule|mechanics-reachability/i);
  });

  it("resolves catalog IDs, creates sessions from bundle IDs, and retains object-form compatibility", async () => {
    const value = await compiledModuleHttpFixture();
    const catalog = new CompilerArtifactCatalog({ root: join(tmpdir(), `compiled-http-id-${crypto.randomUUID()}`) });
    const prepared = catalog.savePrepared(value.prepared.artifact);
    expect(prepared.status).toBe("ok");
    if (prepared.status === "refused") return;
    const resolved = await handleCompiledModuleHttpRequest(new Request("http://test/api/compiler/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preparedArtifactId: prepared.value.id, preparedQueueHash: value.prepared.identity.preparedQueueHash, hints: hints(value.prepared), presentation: { module: { title: "HTTP", version: "1", ruleset: "cosmic-horror", era: "test", summary: "summary", playerCount: "1", expectedDuration: "short", triggerWarnings: [] }, scenes: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.symbols.sceneIds.map((id: string) => [id, { description: id }])), connections: Object.fromEntries((value.resolved.artifact.payload as any).analysisInput.connections.map((c: any) => [c.id, { condition: c.id }])), clues: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.symbols.clueIds.map((id: string) => [id, { findMethods: [], revelation: id, unlocks: [], importance: "core" }])), endings: Object.fromEntries((value.resolved.artifact.payload as any).mechanicsIR.endings.map((e: any) => [e.effects.find((x: any) => x.kind === "end_game").endingId, { name: e.id, description: e.id, conditions: ["declared"] }])) } }) }), dependencies(undefined, catalog));
    expect(resolved?.status).toBe(200);
    const body = await resolved?.json() as { bundleId: string };
    expect(body.bundleId).toMatch(/^[a-z2-7]{24}$/);
    const session = await handleCompiledModuleHttpRequest(new Request("http://test/api/sessions/compiled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bundleId: body.bundleId, archetype: "investigator", characterName: "Ada" }) }), dependencies(undefined, catalog));
    expect(session?.status).toBe(201);
    expect(await session?.json()).toMatchObject({ bundleId: body.bundleId });
    const read = await handleCompiledModuleHttpRequest(new Request(`http://test/api/compiler/bundles/${body.bundleId}`), dependencies(undefined, catalog));
    expect(read?.status).toBe(200);
  });
});
