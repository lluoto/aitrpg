import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GameSession, compiledMechanicsAction } from "../api/game-session";
import { CompiledSessionSnapshotStore } from "../api/compiled-session-snapshot";
import { CompilerArtifactCatalog } from "../compiler/compiler-artifact-catalog";
import { handleRequest, runAction } from "../api/server";
import { compiledModuleHttpFixture } from "./compiled-module-http-lifecycle.test";

const CONFIG = { apiKey: "sk-placeholder", baseUrl: "http://offline.invalid", model: "offline", maxTokens: 1, temperature: 0 };
const HIDDEN_FIXTURE_TEXT = ["父线索", "子线索", "一把档案室钥匙", "一份必须读懂的档案", "出口说明", "离开这里的旧车票", "rule_clean", "rule_hasty", "ending:rule_clean", "ending:rule_hasty"];

function root(): string {
  return mkdtempSync(join(tmpdir(), "compiled-actions-"));
}

function methodIds(payload: any) {
  return {
    parent: payload.mechanicsIR.discoveryMethods.find((method: any) => method.id === "find_parent")!.id,
    child: payload.mechanicsIR.discoveryMethods.find((method: any) => method.id === "find_child")!.id,
    entry: payload.mechanicsIR.connections.find((connection: any) => connection.connectionId === "entry_archive")!.id,
    exit: payload.mechanicsIR.connections.find((connection: any) => connection.connectionId === "archive_exit")!.id,
  };
}

async function durableSession(dir: string, id = "compiled-actions") {
  const fixture = await compiledModuleHttpFixture();
  const catalog = new CompilerArtifactCatalog({ root: join(dir, "catalog") });
  const saved = catalog.saveBundle(fixture.resolved.artifact, fixture.projection);
  if (saved.status === "refused") throw new Error(saved.message);
  const bundle = catalog.loadBundle(saved.value.id);
  if (bundle.status === "refused") throw new Error(bundle.message);
  const snapshots = new CompiledSessionSnapshotStore({ root: join(dir, "snapshots") });
  const session = new GameSession(id, "cosmic-horror", CONFIG, "investigator", "Ada", undefined, { careerRoot: join(dir, "careers") });
  const loaded = session.loadDurableCompiledModule(bundle.value);
  if (loaded.status === "refused") throw new Error(loaded.message);
  const initial = session.createCompiledSessionSnapshot();
  const stored = snapshots.save(initial);
  if (stored.status === "refused") throw new Error(stored.message);
  session.acknowledgeCompiledSnapshot(initial);
  snapshots.confirmCreated(initial);
  return { fixture, catalog, snapshots, session, bundleId: saved.value.id, dir };
}

function restore(built: Awaited<ReturnType<typeof durableSession>>, snapshot?: unknown): GameSession {
  const bundle = built.catalog.loadBundle(built.bundleId);
  if (bundle.status === "refused") throw new Error(bundle.message);
  const raw = snapshot === undefined ? built.snapshots.read(built.session.id) : { status: "ok" as const, value: snapshot };
  if (raw.status === "refused") throw new Error(raw.message);
  const session = new GameSession(built.session.id, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(built.dir, "careers") });
  const restored = session.restoreCompiledSession(raw.value, bundle.value);
  if (restored.status === "refused") throw new Error(restored.message);
  return session;
}

function commitAndRestore(current: GameSession, built: Awaited<ReturnType<typeof durableSession>>, mechanismId: string, actionId: string): GameSession {
  const committed = current.commitCompiledAction(compiledMechanicsAction(mechanismId), actionId, current.getCompiledGeneration()!, (snapshot) => {
    const stored = built.snapshots.save(snapshot);
    if (stored.status === "refused") throw new Error(stored.message);
  });
  if (committed.status !== "committed") throw new Error(`compiled action was not committed: ${committed.status}`);
  return restore(built, committed.snapshot);
}

async function httpSession(dir: string) {
  const fixture = await compiledModuleHttpFixture();
  const catalog = new CompilerArtifactCatalog({ root: join(dir, "catalog") });
  const saved = catalog.saveBundle(fixture.resolved.artifact, fixture.projection);
  if (saved.status === "refused") throw new Error(saved.message);
  const snapshots = new CompiledSessionSnapshotStore({ root: join(dir, "snapshots") });
  const response = await handleRequest(new Request("http://test/api/sessions/compiled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bundleId: saved.value.id, archetype: "investigator", characterName: "Ada" }),
  }), catalog, snapshots, { careerRoot: join(dir, "careers") });
  if (response.status !== 201) throw new Error(await response.text());
  const created = await response.json() as { sessionId: string; generation: number };
  return { fixture, catalog, snapshots, sessionId: created.sessionId, creation: created, dir };
}

async function request(built: Awaited<ReturnType<typeof httpSession>>, path: string, method = "GET", body?: unknown) {
  const response = await handleRequest(new Request(`http://test${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }), built.catalog, built.snapshots, { careerRoot: join(built.dir, "careers") });
  return { status: response.status, body: await response.json() as any };
}

async function listActions(built: Awaited<ReturnType<typeof httpSession>>) {
  return request(built, `/api/sessions/${built.sessionId}/compiled/actions?pcId=p1`);
}

async function structuredAction(built: Awaited<ReturnType<typeof httpSession>>, mechanismId: string, actionId: string, expectedGeneration: number) {
  return request(built, `/api/sessions/${built.sessionId}/compiled/actions`, "POST", { mechanismId, pcId: "p1", actionId, expectedGeneration });
}

/** Snapshot every live authority that action discovery/refusal must leave alone. */
function immutableCompiledView(session: GameSession) {
  const compiled = (session as any).compiledModule;
  return structuredClone({
    activePlayerId: session.activePlayerId,
    round: session.round,
    state: session.getState(),
    mechanicsState: session.getCompiledMechanicsState()?.state,
    trace: session.getCompiledMechanicsState()?.trace,
    world: session.world.getCurrentState(),
    history: session.getPlayerHistory("p1"),
    budget: compiled?.budget.count,
    lastActiveAt: session.lastActiveAt,
  });
}

function expectPlayerSafeLabels(labels: string[]) {
  const text = labels.join("\n");
  for (const forbidden of HIDDEN_FIXTURE_TEXT) expect(text).not.toContain(forbidden);
}

describe("compiled action discovery", () => {
  it("does not alter ordinary, Barn, or combat suggestion bytes", async () => {
    const ordinary = new GameSession("ordinary-suggestion-bytes", "cosmic-horror", CONFIG, "investigator", "Ada");
    expect(ordinary.getSuggestions("p1")).toEqual(["\u73af\u987e\u56db\u5468"]);

    const barn = new GameSession("barn-suggestion-bytes", "cosmic-horror", CONFIG, "investigator", "Ada");
    await barn.act("\u52a0\u8f7d\u6a21\u7ec4 \u666e\u745e\u7c73\u5c14\u7684\u8c37\u4ed3");
    (barn as any).movePlayerToScene("\u7ef4\u68ee\u9152\u5427");
    expect(barn.getSuggestions("p1")).toEqual([
      "\u4ed4\u7ec6\u641c\u67e5\u8fd9\u91cc", "\u4e0e \u9152\u5427\u4fdd\u9556 \u4ea4\u8c08", "\u4e0e \u524d\u53f0 \u4ea4\u8c08", "\u524d\u5f80 \u666e\u745e\u7c73\u5c14",
    ]);

    barn.combatActive = true;
    expect(barn.getSuggestions("p1")).toEqual([
      "\u2694\uFE0F \u653b\u51fb\u654c\u4eba", "\u{1F6E1}\uFE0F \u9632\u5fa1", "\u{1F48A} \u4f7f\u7528\u7269\u54c1", "\u{1F3C3} \u64a4\u9000",
    ]);
  });

  it("projects player-safe, deterministic, cloned actions from the shared available-action core", async () => {
    const fixture = await compiledModuleHttpFixture();
    const session = new GameSession("compiled-ephemeral", "cosmic-horror", CONFIG, "investigator", "Ada");
    const loaded = session.loadCompiledModule(fixture.resolved.artifact.payload as any, fixture.projection);
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "refused") return;
    const compiled = (session as any).compiledModule;
    const parent = compiled.payload.mechanicsIR.discoveryMethods.find((method: any) => method.id === "find_parent");
    compiled.payload.mechanicsIR.discoveryMethods.push({ ...structuredClone(parent), id: "a_second_parent" });
    compiled.payload.analysisInput.discoveryLocations.a_second_parent = compiled.state.currentSceneId;

    const actions = session.getCompiledAvailableActions();
    expect(actions.map((action) => action.mechanismId)).toEqual(["a_second_parent", "find_parent"]);
    expect(actions.every((action) => action.kind === "discovery" && action.label === "Search here" && action.command === compiledMechanicsAction(action.mechanismId))).toBe(true);
    expect(actions.every((action) => !("outcome" in action))).toBe(true);
    // These are real fixture-only data: clue display names, their source text,
    // and both terminal declarations. A generic prefix check would not catch
    // a future label that leaks one of them verbatim.
    expectPlayerSafeLabels(actions.map((action) => action.label));
    actions[0]!.label = "mutated";
    expect(session.getCompiledAvailableActions()[0]!.label).toBe("Search here");

    const result = await session.act(compiledMechanicsAction("a_second_parent"), "p1");
    expect(result.error).toBeUndefined();
    expect(session.getCompiledAvailableActions().map((action) => action.mechanismId)).not.toContain("find_parent");
    expect(session.getCompiledAvailableActions().map((action) => action.mechanismId)).not.toContain("a_second_parent");
  });

  it("never settles or mutates a compiled session while listing, including a pending automatic transition", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir, "compiled-read-only");
      const compiled = (built.session as any).compiledModule;
      compiled.payload.mechanicsIR.transitions.push({
        id: "pending_transition",
        when: { kind: "all", predicates: [] },
        effects: [{ kind: "set_state", stateKey: "pending", value: true }],
        sourceInterpretationIds: [],
      });
      const before = immutableCompiledView(built.session);
      expect(() => built.session.getCompiledAvailableActions()).toThrow("not settled");
      expect(immutableCompiledView(built.session)).toEqual(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("serves generation-bound structured actions, refreshes after execution and restart, and preserves terminal metadata", async () => {
    const dir = root();
    const originalRandom = Math.random;
    try {
      const built = await httpSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      expect(built.creation.generation).toBe(0);
      expect((await request(built, `/api/sessions/${built.sessionId}/state`)).body.generation).toBe(0);
      const initial = await listActions(built);
      expect(initial).toMatchObject({ status: 200, body: { generation: 0 } });
      expect(initial.body.actions.map((action: any) => action.mechanismId)).toEqual([ids.parent]);
      expect(initial.body.actions.map((action: any) => action.mechanismId)).not.toContain(ids.entry);

      const parent = await structuredAction(built, ids.parent, "parent", 0);
      expect(parent).toMatchObject({ status: 200, body: { generation: 1 } });
      const unlocked = await listActions(built);
      expect((await request(built, `/api/sessions/${built.sessionId}/state`)).body.generation).toBe(1);
      expect(unlocked.body.actions.map((action: any) => action.mechanismId)).toEqual([ids.entry]);
      expect(unlocked.body.actions[0]).toMatchObject({ kind: "traversal", command: compiledMechanicsAction(ids.entry) });
      expectPlayerSafeLabels(unlocked.body.actions.map((action: any) => action.label));

      const traversed = await structuredAction(built, ids.entry, "entry", 1);
      expect(traversed).toMatchObject({ status: 200, body: { generation: 2 } });
      const checked = await listActions(built);
      expect((await request(built, `/api/sessions/${built.sessionId}/state`)).body.generation).toBe(2);
      expect(checked.body.actions).toContainEqual(expect.objectContaining({ mechanismId: ids.child, kind: "discovery", label: "Read here", check: { kind: "skill", skill: "library_use", difficulty: "hard" } }));
      expect(checked.body.actions.every((action: any) => !("outcome" in action))).toBe(true);
      expectPlayerSafeLabels(checked.body.actions.map((action: any) => action.label));

      const raw = built.snapshots.read(built.sessionId);
      expect(raw.status).toBe("ok");
      if (raw.status === "refused") return;
      const rawSnapshot = raw.value as { bundle: { id: string } };
      const bundle = built.catalog.loadBundle(rawSnapshot.bundle.id);
      expect(bundle.status).toBe("ok");
      if (bundle.status === "refused") return;
      const restarted = new GameSession(built.sessionId, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(dir, "careers") });
      expect(restarted.restoreCompiledSession(raw.value, bundle.value).status).toBe("loaded");
      expect(restarted.getCompiledAvailableActions()).toEqual(checked.body.actions);

      Math.random = () => 0;
      const child = await structuredAction(built, ids.child, "child", 2);
      expect(child).toMatchObject({ status: 200, body: { generation: 3 } });
      const exit = await listActions(built);
      expect((await request(built, `/api/sessions/${built.sessionId}/state`)).body.generation).toBe(3);
      expect(exit.body.actions.map((action: any) => action.mechanismId)).toEqual([ids.exit]);
      expect(await structuredAction(built, ids.exit, "exit", 3)).toMatchObject({ status: 200, body: { generation: 4 } });
      const terminal = await listActions(built);
      expect(terminal).toMatchObject({ status: 200, body: { generation: 4, actions: [], compiled: { terminalEnding: expect.any(Object) } } });
      expect(await structuredAction(built, ids.exit, "after-terminal", 4)).toMatchObject({ status: 409, body: { code: "compiled_terminal", generation: 4, compiled: { terminalEnding: expect.any(Object) } } });
      expect((await request(built, `/api/sessions/${built.sessionId}/state`)).body.generation).toBe(4);
    } finally {
      Math.random = originalRandom;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses p1's persisted check values and exposes one failback-capable mechanism without client outcomes", async () => {
    const dir = root();
    const originalRandom = Math.random;
    try {
      const built = await durableSession(dir, "compiled-checks");
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      let current = commitAndRestore(built.session, built, ids.parent, "parent");
      current = commitAndRestore(current, built, ids.entry, "entry");
      (current as any).characters.get("p1").skillValues.library_use = 80;
      current.session.join("p2", "Stale", "p2");
      (current as any).characters.set("p2", { name: "Stale", skillValues: { library_use: 1 } });
      current.activePlayerId = "p2";
      (current as any).activeCharacter = { name: "Stale", skillValues: { library_use: 1 } };
      Math.random = () => 0.99;
      const first = current.commitCompiledAction(compiledMechanicsAction(ids.child), "failure-one", 2, (snapshot) => {
        const stored = built.snapshots.save(snapshot);
        if (stored.status === "refused") throw new Error(stored.message);
      });
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      expect(current.activePlayerId).toBe("p2");
      const firstEvents = (first.response.action as unknown as { events: Array<{ content: string }> }).events;
      expect(first.snapshot?.character.pcId).toBe("p1");
      expect((first.snapshot?.history ?? []).map((message: any) => message.content)).toEqual(expect.arrayContaining(firstEvents.map((event) => event.content)));
      expect(firstEvents.some((event) => event.content.includes("目标=80%"))).toBe(true);
      current = restore(built, first.snapshot);
      expect(current.activePlayerId).toBe("p1");
      expect(current.getPlayerHistory("p1").messages.map((message) => message.content)).toEqual(expect.arrayContaining(firstEvents.map((event) => event.content)));
      expect(current.getCompiledAvailableActions().filter((action) => action.mechanismId === ids.child)).toHaveLength(1);
      current = commitAndRestore(current, built, ids.child, "failure-two");
      expect(current.getCompiledAvailableActions().filter((action) => action.mechanismId === ids.child)).toHaveLength(1);
      const failback = current.commitCompiledAction(compiledMechanicsAction(ids.child), "failback", 4, (snapshot) => {
        const stored = built.snapshots.save(snapshot);
        if (stored.status === "refused") throw new Error(stored.message);
      });
      expect(failback).toMatchObject({ status: "committed", response: { action: { compiled: { trace: expect.arrayContaining([expect.objectContaining({ mechanismId: ids.child, outcome: "failback" })]) } } } });
    } finally {
      Math.random = originalRandom;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps duplicate lookup ahead of availability and maps structured and codec refusals without mutation", async () => {
    const dir = root();
    try {
      const built = await httpSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const before = await request(built, `/api/sessions/${built.sessionId}`);
      expect(await structuredAction(built, ids.child, "unavailable", 0)).toMatchObject({ status: 409, body: { code: "compiled_action_unavailable", generation: 0 } });
      expect(await structuredAction(built, "unknown_mechanism", "unknown", 0)).toMatchObject({ status: 409, body: { code: "compiled_action_unavailable", generation: 0 } });
      expect(await request(built, `/api/sessions/${built.sessionId}/compiled/actions`, "POST", { mechanismId: ids.parent, pcId: "p2", actionId: "unknown-pc", expectedGeneration: 0 })).toMatchObject({ status: 404, body: { code: "unknown_pc", generation: 0 } });
      expect(await request(built, `/api/sessions/${built.sessionId}/compiled/actions`, "POST", { pcId: "p1", actionId: "bad", expectedGeneration: 0 })).toMatchObject({ status: 400, body: { code: "compiled_action_contract_required" } });
      expect(await request(built, `/api/sessions/${built.sessionId}/compiled/actions`, "POST", { mechanismId: ids.parent, pcId: "p1", actionId: "client-outcome", expectedGeneration: 0, outcome: "failback" })).toMatchObject({ status: 400, body: { code: "compiled_action_contract_required", generation: 0 } });
      expect(await request(built, `/api/sessions/${built.sessionId}/action`, "POST", { input: "@compiled ", pcId: "p1", actionId: "bad-codec", expectedGeneration: 0 })).toMatchObject({ status: 400, body: { code: "compiled_action_required", generation: 0 } });
      expect(await request(built, `/api/sessions/${built.sessionId}`)).toEqual(before);

      const first = await structuredAction(built, ids.parent, "same-id", 0);
      expect(first.status).toBe(200);
      expect(await structuredAction(built, ids.parent, "same-id", 0)).toEqual(first);
      const afterFirst = await request(built, `/api/sessions/${built.sessionId}`);
      expect(await structuredAction(built, ids.entry, "stale", 0)).toMatchObject({ status: 409, body: { code: "compiled_generation_conflict", generation: 1 } });
      expect(await structuredAction(built, ids.entry, "same-id", 1)).toMatchObject({ status: 409, body: { code: "compiled_idempotency_conflict", generation: 1 } });
      expect(await request(built, `/api/sessions/${built.sessionId}`)).toEqual(afterFirst);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("leaves mechanics, world mirrors, and p1 history unchanged for unknown and unavailable compiled IDs", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir, "compiled-refusal-no-write");
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const before = immutableCompiledView(built.session);
      for (const [input, actionId] of [[compiledMechanicsAction(ids.child), "unavailable"], [compiledMechanicsAction("unknown_mechanism"), "unknown"]] as const) {
        expect(await runAction(built.session, { input, pcId: "p1", actionId, expectedGeneration: 0 }, () => { throw new Error("must not persist a refusal"); })).toMatchObject({ status: 409, body: { code: "compiled_action_unavailable", generation: 0 } });
        expect(immutableCompiledView(built.session)).toEqual(before);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("maps a structured HTTP snapshot persistence refusal to 500", async () => {
    const dir = root();
    try {
      const built = await httpSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const snapshots: any = built.snapshots;
      const originalSave = snapshots.save;
      snapshots.save = () => ({ status: "refused", code: "SNAPSHOT_IO", message: "forced test persistence refusal" });
      try {
        expect(await structuredAction(built, ids.parent, "persistence-http", 0)).toMatchObject({ status: 500, body: { code: "compiled_persistence_failed", generation: 0 } });
      } finally {
        snapshots.save = originalSave;
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps structured and legacy codec execution equivalent and makes compiled suggestions executable", async () => {
    const leftDir = root();
    const rightDir = root();
    try {
      const structured = await httpSession(leftDir);
      const codec = await httpSession(rightDir);
      const ids = methodIds(structured.fixture.resolved.artifact.payload);
      const structuredResult = await structuredAction(structured, ids.parent, "same", 0);
      const codecResult = await request(codec, `/api/sessions/${codec.sessionId}/action`, "POST", { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "same", expectedGeneration: 0 });
      expect(structuredResult.status).toBe(200);
      expect(codecResult.status).toBe(200);
      expect(structuredResult.body.compiled.stateHash).toBe(codecResult.body.compiled.stateHash);
      expect(structuredResult.body.compiled.trace).toEqual(codecResult.body.compiled.trace);
      const suggestions = await request(structured, `/api/sessions/${structured.sessionId}/suggestions?pcId=p1`);
      const actions = await listActions(structured);
      expect(suggestions.body.suggestions).toEqual(actions.body.actions.map((action: any) => action.command));

      const ordinary = new GameSession("ordinary-suggestions", "cosmic-horror", CONFIG, "investigator", "Ada");
      expect(ordinary.getSuggestions("p1")).toEqual(["环顾四周"]);
    } finally {
      rmSync(leftDir, { recursive: true, force: true });
      rmSync(rightDir, { recursive: true, force: true });
    }
  });

  it("maps real compiled execution and durable persistence failures to 500", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir, "compiled-persist-failure");
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      expect(await runAction(built.session, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "fails", expectedGeneration: 0 }, () => { throw new Error("storage failed"); })).toMatchObject({ status: 500, body: { code: "compiled_persistence_failed", generation: 0 } });
      (built.session as any).compiledModule.state.currentSceneId = "tampered";
      expect(await runAction(built.session, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "execution", expectedGeneration: 0 }, () => { throw new Error("must not persist an execution refusal"); })).toMatchObject({ status: 500, body: { code: "compiled_execution_failed", generation: 0 } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
