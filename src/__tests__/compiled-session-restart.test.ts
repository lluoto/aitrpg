import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GameSession, compiledMechanicsAction } from "../api/game-session";
import {
  CompiledSessionSnapshotStore,
  compiledSessionSnapshotHash,
  compiledSessionSnapshotNodeFileOps,
  type CompiledSessionSnapshot,
} from "../api/compiled-session-snapshot";
import { CompilerArtifactCatalog } from "../compiler/compiler-artifact-catalog";
import { mechanicsStateHash } from "../compiler/mechanics-execution";
import { cleanupExpiredSessions, hydrateCompiledSessions, partitionSessionListings, runAction } from "../api/server";
import { compiledModuleHttpFixture } from "./compiled-module-http-lifecycle.test";

const CONFIG = { apiKey: "sk-placeholder", baseUrl: "http://offline.invalid", model: "offline", maxTokens: 1, temperature: 0 };

function root(): string {
  return mkdtempSync(join(tmpdir(), "compiled-restart-"));
}

async function durableSession(dir: string, id = "compiledrestart") {
  const fixture = await compiledModuleHttpFixture();
  const catalog = new CompilerArtifactCatalog({ root: join(dir, "catalog") });
  const savedBundle = catalog.saveBundle(fixture.resolved.artifact, fixture.projection);
  if (savedBundle.status === "refused") throw new Error(savedBundle.message);
  const bundle = catalog.loadBundle(savedBundle.value.id);
  if (bundle.status === "refused") throw new Error(bundle.message);
  const snapshots = new CompiledSessionSnapshotStore({ root: join(dir, "snapshots") });
  const session = new GameSession(id, "cosmic-horror", CONFIG, "investigator", "Ada", undefined, { careerRoot: join(dir, "careers") });
  const loaded = session.loadDurableCompiledModule(bundle.value);
  if (loaded.status === "refused") throw new Error(loaded.message);
  const initial = session.createCompiledSessionSnapshot();
  const saved = snapshots.save(initial);
  if (saved.status === "refused") throw new Error(saved.message);
  session.acknowledgeCompiledSnapshot(initial);
  snapshots.confirmCreated(initial);
  return { fixture, catalog, snapshots, session, bundleId: savedBundle.value.id, dir };
}

function methodIds(payload: any) {
  return {
    parent: payload.mechanicsIR.discoveryMethods.find((method: any) => method.id === "find_parent")!.id,
    child: payload.mechanicsIR.discoveryMethods.find((method: any) => method.id === "find_child")!.id,
    entry: payload.mechanicsIR.connections.find((connection: any) => connection.connectionId === "entry_archive")!.id,
    exit: payload.mechanicsIR.connections.find((connection: any) => connection.connectionId === "archive_exit")!.id,
  };
}

function restoreFresh(built: Awaited<ReturnType<typeof durableSession>>, snapshot?: unknown): GameSession {
  const loaded = built.catalog.loadBundle(built.bundleId);
  if (loaded.status === "refused") throw new Error(loaded.message);
  const raw = snapshot === undefined ? built.snapshots.read(built.session.id) : { status: "ok" as const, value: snapshot };
  if (raw.status === "refused") throw new Error(raw.message);
  const restored = new GameSession(built.session.id, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(built.dir, "careers") });
  const result = restored.restoreCompiledSession(raw.value, loaded.value);
  if (result.status === "refused") throw new Error(result.message);
  return restored;
}

function commitAndRestore(
  current: GameSession,
  built: Awaited<ReturnType<typeof durableSession>>,
  input: string,
  actionId: string,
) {
  const committed = current.commitCompiledAction(input, actionId, current.getCompiledGeneration()!, (snapshot) => {
    const saved = built.snapshots.save(snapshot);
    if (saved.status === "refused") throw new Error(saved.message);
  });
  expect(committed.status).toBe("committed");
  if (committed.status !== "committed") throw new Error("compiled action did not commit");
  return { committed, current: restoreFresh(built, committed.snapshot) };
}

function rehash(snapshot: CompiledSessionSnapshot): CompiledSessionSnapshot {
  snapshot.snapshotHash = compiledSessionSnapshotHash(snapshot);
  return snapshot;
}

type FreshRestartProof = {
  ordering: string[];
  duplicate: { generation: number };
  continued: { generation: number; narrative: string; compiled: { stateHash: string; terminalEnding?: { id: string } } };
  history: number;
};

async function runFreshWorkerRestartProof(request: Record<string, unknown>): Promise<FreshRestartProof> {
  const worker = new Worker(new URL("./compiled-session-restart-child.ts", import.meta.url).href, { type: "module" });
  try {
    return await new Promise<FreshRestartProof>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("fresh restart worker timed out"));
      }, 10_000);
      const finish = (value: FreshRestartProof | Error) => {
        clearTimeout(timeout);
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      worker.onmessage = (event: MessageEvent<{ status: "ok"; proof: FreshRestartProof } | { status: "error"; message: string }>) => {
        if (event.data.status === "ok") finish(event.data.proof);
        else finish(new Error(event.data.message));
      };
      worker.onerror = (event: ErrorEvent) => finish(new Error(event.message || "fresh restart worker failed"));
      worker.postMessage(request);
    });
  } finally {
    worker.terminate();
  }
}

describe("restart-safe compiled sessions", () => {
  it("stores a hash-bound catalog reference and restores exact p1, SAN, history, state, trace, and generation", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const committed = commitAndRestore(built.session, built, compiledMechanicsAction(ids.parent), "discover-parent");
      const current = committed.current;
      expect(current.getCompiledMechanicsState()).toEqual(committed.committed.response.action.compiled as any);
      expect(current.getCompiledMechanicsState()?.trace).toEqual(committed.committed.snapshot?.trace);
      expect(current.getPlayerHistory("p1").messages.map((message) => ({ speaker: message.speaker, content: message.content, type: message.type }))).toEqual(committed.committed.response.action.events as any);
      expect(current.getCharacterSummary()).toMatchObject({ name: "Ada" });
      expect(current.getSanity()).toEqual(built.session.getSanity());
      expect(current.getPlayerHistory("p1").total).toBe(2);
      expect(current.getCompiledGeneration()).toBe(1);
      const raw = built.snapshots.read(current.id);
      expect(raw.status).toBe("ok");
      if (raw.status === "ok") {
        const snapshot = raw.value as CompiledSessionSnapshot;
        expect(snapshot.bundle).toEqual(expect.objectContaining({ id: built.bundleId, bundleHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
        expect(JSON.stringify(snapshot)).not.toContain("projectionArtifactHash");
        expect(snapshot.previousSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("binds generation, round, contiguous idempotency records, and every stored response to replayed player edges", async () => {
    const dir = root();
    const originalRandom = Math.random;
    try {
      const built = await durableSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      let current = built.session;
      Math.random = () => 0.99;
      for (const [index, id] of [ids.parent, ids.entry, ids.child, ids.child, ids.child, ids.exit].entries()) {
        current = commitAndRestore(current, built, compiledMechanicsAction(id), `step-${index}`).current;
      }
      const raw = built.snapshots.read(current.id);
      expect(raw.status).toBe("ok");
      if (raw.status === "ok") {
        const snapshot = raw.value as CompiledSessionSnapshot;
        expect(snapshot.generation).toBe(6);
        expect(snapshot.round).toBe(6);
        expect(snapshot.idempotency.map((record) => [record.expectedGeneration, record.generation])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]);
        expect(snapshot.idempotency.at(-1)?.response.action.compiled).toMatchObject({ generation: 6, terminalEnding: { id: "clean" } });
      }
      expect(current.getCompiledMechanicsState()?.state.terminalEndingId).toBe("clean");
    } finally {
      Math.random = originalRandom;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects rehashed generation, round, ledger, response, character, SAN, and bundle forgeries before world writes", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      commitAndRestore(built.session, built, compiledMechanicsAction(ids.parent), "forgery");
      const raw = built.snapshots.read(built.session.id);
      expect(raw.status).toBe("ok");
      if (raw.status === "refused") return;
      const cases: Array<(snapshot: CompiledSessionSnapshot) => void> = [
        (snapshot) => { snapshot.generation = 9; },
        (snapshot) => { snapshot.round = 0; },
        (snapshot) => { snapshot.idempotency[0]!.expectedGeneration = 4; },
        (snapshot) => { snapshot.trace[0]!.mechanismId = "forged-mechanism"; },
        (snapshot) => { (snapshot.idempotency[0]!.response as any).action = null; },
        (snapshot) => { (snapshot.idempotency[0]!.response.action as any).extra = true; },
        (snapshot) => { (snapshot.idempotency[0]!.response.summary as any).scene = "forged-scene"; },
        (snapshot) => { (snapshot.idempotency[0]!.response.summary as any).messageCount = 999; },
        (snapshot) => { (snapshot.idempotency[0]!.response.summary as any).npcCount = 1; },
        (snapshot) => { (snapshot.idempotency[0]!.response.action.state as any).player.hp = 1; },
        (snapshot) => { (snapshot.idempotency[0]!.response.action.state as any).gameTime.day = 99; },
        (snapshot) => { delete (snapshot.character.sheet.attributes as any).power; },
        (snapshot) => { (snapshot.character.sanity as any).currentSAN = 101; },
        (snapshot) => { (snapshot.character.sanity as any).mythosLog = [{ source: 1, gain: "x", maxSanLoss: null }]; },
        (snapshot) => { (snapshot.character.sheet as any).unsupported = true; },
        (snapshot) => { snapshot.bundle.bundleHash = "a".repeat(64); },
      ];
      for (const mutate of cases) {
        const forged = rehash(structuredClone(raw.value as CompiledSessionSnapshot));
        mutate(forged);
        rehash(forged);
        const target = new GameSession(built.session.id, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(dir, "careers") });
        let writes = 0;
        for (const method of ["registerScene", "setSceneExits", "setActiveScene", "upsertEntity", "recordSceneVisit", "recordClueDiscovery", "setPlayerSanity"] as const) {
          const original = (target.world as any)[method].bind(target.world);
          (target.world as any)[method] = (...args: unknown[]) => { writes++; return original(...args); };
        }
        const bundle = built.catalog.loadBundle(built.bundleId);
        if (bundle.status === "refused") throw new Error(bundle.message);
        expect(target.restoreCompiledSession(forged, bundle.value).status).toBe("refused");
        expect(writes).toBe(0);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("requires the durable action transaction and preserves p1 as the only mutating actor", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const before = built.session.getCompiledMechanicsState();
      expect((await built.session.act(compiledMechanicsAction(ids.parent), "p1")).error?.code).toBe("compiled_action_contract_required");
      expect(built.session.getCompiledMechanicsState()).toEqual(before);
      expect(built.session.addPartyMember("Beth", "investigator")).toEqual({ rejected: "compiled_mutation_unsupported" });
      expect(built.session.setScene("not-a-scene")).toBe(false);
      expect(built.session.setPlayerSan("p1", 1)).toMatchObject({ ok: false });
      const transaction = await runAction(built.session, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "http-parent", expectedGeneration: 0 }, (snapshot) => {
        const saved = built.snapshots.save(snapshot);
        if (saved.status === "refused") throw new Error(saved.message);
      }, (snapshot) => restoreFresh(built, snapshot));
      expect(transaction).toMatchObject({ status: 200, body: { generation: 1 } });
      const duplicate = await runAction(transaction.session!, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "http-parent", expectedGeneration: 0 }, undefined, (snapshot) => restoreFresh(built, snapshot));
      expect(duplicate).toEqual(expect.objectContaining({ status: 200, body: transaction.body }));
      const conflict = await runAction(transaction.session!, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "http-parent", expectedGeneration: 1 }, undefined, (snapshot) => restoreFresh(built, snapshot));
      expect(conflict).toMatchObject({ status: 409, body: { code: "compiled_idempotency_conflict", generation: 1 } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("persists the exact checked-action dice and line for HTTP retries before and after restart", async () => {
    const dir = root();
    const originalRandom = Math.random;
    try {
      const built = await durableSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      let current = commitAndRestore(built.session, built, compiledMechanicsAction(ids.parent), "checked-parent").current;
      current = commitAndRestore(current, built, compiledMechanicsAction(ids.entry), "checked-entry").current;
      (current as any).activeCharacter.skillValues.library_use = 80;
      Math.random = () => 0.99;
      const body = { input: compiledMechanicsAction(ids.child), pcId: "p1", actionId: "checked-failure", expectedGeneration: 2 };
      const first = await runAction(current, body, (snapshot) => {
        const saved = built.snapshots.save(snapshot);
        if (saved.status === "refused") throw new Error(saved.message);
      }, (snapshot) => restoreFresh(built, snapshot));
      expect(first).toMatchObject({
        status: 200,
        body: {
          generation: 3,
          dice: [{ expr: "d100", total: 100, detail: "library_use/hard" }],
          events: expect.arrayContaining([{ speaker: "系统", content: "🎲 library_use hard 检定 d100=100 (目标=80%) → 失败", type: "system" }]),
          compiled: { trace: expect.arrayContaining([expect.objectContaining({ mechanismId: ids.child, outcome: "failure" })]) },
        },
      });
      const duplicate = await runAction(first.session!, body, undefined, (snapshot) => restoreFresh(built, snapshot));
      expect(duplicate).toEqual(expect.objectContaining({ status: 200, body: first.body }));
      const restarted = restoreFresh(built);
      const duplicateAfterRestart = await runAction(restarted, body, undefined, (snapshot) => restoreFresh(built, snapshot));
      expect(duplicateAfterRestart).toEqual(expect.objectContaining({ status: 200, body: first.body }));

      const raw = built.snapshots.read(built.session.id);
      expect(raw.status).toBe("ok");
      if (raw.status === "refused") return;
      const mutations: Array<(snapshot: CompiledSessionSnapshot) => void> = [
        (snapshot) => { ((snapshot.idempotency.at(-1)!.response.action as any).dice[0] as any).total = 1; },
        (snapshot) => { ((snapshot.idempotency.at(-1)!.response.action as any).events[1] as any).content = "🎲 library_use hard 检定 d100=100 (目标=81%) → 失败"; },
        (snapshot) => { ((snapshot.idempotency.at(-1)!.response.action as any).events[1] as any).content = "🎲 library_use hard 检定 d100=100 (目标=80%) → 成功"; },
      ];
      for (const mutate of mutations) {
        const forged = rehash(structuredClone(raw.value as CompiledSessionSnapshot));
        mutate(forged);
        rehash(forged);
        const target = new GameSession(built.session.id, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(dir, "careers") });
        let writes = 0;
        for (const method of ["registerScene", "setSceneExits", "setActiveScene", "upsertEntity", "recordSceneVisit", "recordClueDiscovery", "setPlayerSanity"] as const) {
          const original = (target.world as any)[method].bind(target.world);
          (target.world as any)[method] = (...args: unknown[]) => { writes++; return original(...args); };
        }
        const bundle = built.catalog.loadBundle(built.bundleId);
        if (bundle.status === "refused") throw new Error(bundle.message);
        expect(target.restoreCompiledSession(forged, bundle.value).status).toBe("refused");
        expect(writes).toBe(0);
      }
    } finally {
      Math.random = originalRandom;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed after persistence until the server installs a fresh replay-validated object, then supports a retry", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const result = await runAction(built.session, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "install-failure", expectedGeneration: 0 }, (snapshot) => {
        const saved = built.snapshots.save(snapshot);
        if (saved.status === "refused") throw new Error(saved.message);
      }, () => { throw new Error("setScene install failure"); });
      expect(result).toMatchObject({ status: 500, body: { code: "compiled_unavailable", generation: 1 } });
      expect((await built.session.act(compiledMechanicsAction(ids.parent))).error?.code).toBe("compiled_unavailable");
      const fresh = restoreFresh(built);
      const retry = await runAction(fresh, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: "install-failure", expectedGeneration: 0 }, undefined, (snapshot) => restoreFresh(built, snapshot));
      expect(retry).toMatchObject({ status: 200, body: { generation: 1 } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("fails closed for post-persist scene, world, SAN, and history installation faults without exposing a split-generation object", async () => {
    const dir = root();
    try {
      for (const [label, breakInstall] of [
        ["scene", (session: GameSession) => { (session.world as any).setActiveScene = () => false; }],
        ["world", (session: GameSession) => { (session.world as any).upsertEntity = () => { throw new Error("world mirror failed"); }; }],
        ["san", (session: GameSession) => { (session.world as any).setPlayerSanity = () => { throw new Error("SAN persistence failed"); }; }],
        ["history", (session: GameSession) => { (session.session as any).restoreSinglePlayer = () => { throw new Error("history publication failed"); }; }],
      ] as const) {
        const built = await durableSession(dir, `fault-${label}`);
        const ids = methodIds(built.fixture.resolved.artifact.payload);
        const result = await runAction(built.session, { input: compiledMechanicsAction(ids.parent), pcId: "p1", actionId: `fault-${label}`, expectedGeneration: 0 }, (snapshot) => {
          const saved = built.snapshots.save(snapshot);
          if (saved.status === "refused") throw new Error(saved.message);
        }, (snapshot) => {
          const replacement = new GameSession(snapshot.sessionId, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(dir, "careers") });
          breakInstall(replacement);
          const bundle = built.catalog.loadBundle(built.bundleId);
          if (bundle.status === "refused") throw new Error(bundle.message);
          const restored = replacement.restoreCompiledSession(snapshot, bundle.value);
          if (restored.status === "refused") throw new Error(restored.message);
          return replacement;
        });
        expect(result).toMatchObject({ status: 500, body: { code: "compiled_unavailable", generation: 1 } });
        expect((await built.session.act(compiledMechanicsAction(ids.parent))).error?.code).toBe("compiled_unavailable");
        expect(restoreFresh(built).getCompiledGeneration()).toBe(1);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("uses monotonic immutable bodies and bounded headers without replacing a newer snapshot", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir);
      const initial = built.snapshots.read(built.session.id);
      expect(initial.status).toBe("ok");
      if (initial.status === "refused") return;
      expect(built.snapshots.rollbackCreated(initial.value)).toMatchObject({ status: "refused", code: "SNAPSHOT_CONFLICT" });
      expect(built.snapshots.read(built.session.id)).toMatchObject({ status: "ok" });
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      const committed = commitAndRestore(built.session, built, compiledMechanicsAction(ids.parent), "monotonic");
      expect(built.snapshots.save(initial.value)).toMatchObject({ status: "refused", code: "SNAPSHOT_CONFLICT" });
      const header = built.snapshots.listHeaders();
      expect(header).toHaveLength(1);
      expect(header[0]).toMatchObject({ status: "ok", value: { sessionId: built.session.id, generation: 1, fileName: `${built.session.id}.header.json` } });
      const current = built.snapshots.read(built.session.id);
      expect(current.status).toBe("ok");
      if (current.status === "ok") expect((current.value as CompiledSessionSnapshot).snapshotHash).toBe(committed.committed.snapshot!.snapshotHash);

      const capture = await durableSession(dir, "capture");
      const captured = capture.session.commitCompiledAction(compiledMechanicsAction(ids.parent), "capture", 0, () => undefined);
      expect(captured).toMatchObject({ status: "committed" });
      if (captured.status !== "committed") return;
      const failingStore = new CompiledSessionSnapshotStore({
        root: capture.snapshots.root,
        fileOps: { ...compiledSessionSnapshotNodeFileOps, writeReplace: () => { throw new Error("header replacement failed"); } },
      });
      expect(failingStore.save(captured.snapshot!)).toMatchObject({ status: "refused", code: "SNAPSHOT_STORAGE_FAILED" });
      expect(capture.snapshots.read(capture.session.id)).toMatchObject({ status: "ok", value: expect.objectContaining({ generation: 0 }) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("hydrates entries independently, keeps unavailable sessions out of resumable memory, and expires compiled sessions from memory only", async () => {
    const dir = root();
    try {
      const built = await durableSession(dir, "validrestart");
      writeFileSync(join(built.snapshots.root, "broken.header.json"), "{");
      const registry = new Map<string, GameSession>();
      const diagnostics = new Map<string, { id: string; code: string; message: string }>();
      const hydrated = hydrateCompiledSessions({ sessions: registry, diagnostics, catalog: built.catalog, snapshots: built.snapshots, createSession: (id) => new GameSession(id, "cosmic-horror", CONFIG, undefined, undefined, undefined, { careerRoot: join(dir, "careers") }) });
      expect(hydrated.hydrated).toEqual(["validrestart"]);
      expect(hydrated.unavailable).toContainEqual(expect.objectContaining({ id: "broken" }));
      expect(registry.has("broken")).toBe(false);
      const listed = partitionSessionListings(registry.values(), [{ id: "metadata-only", createdAt: 1, ruleset: "cosmic-horror", playerName: "Ada", scene: "entry", bundleId: "aaaaaaaaaaaaaaaaaaaaaaaa" }], diagnostics.values());
      expect(listed.sessions.map((session) => session.id)).toEqual(["validrestart"]);
      expect(listed.unavailable.map((entry) => entry.id)).toContain("metadata-only");
      expect(listed.unavailable.map((entry) => entry.id)).toContain("broken");

      const live = registry.get("validrestart")!;
      live.lastActiveAt = 1;
      const deleted: string[] = [];
      expect(cleanupExpiredSessions(registry, { now: 100, timeoutMs: 10, deleteMetadata: (id) => deleted.push(id), isDurableCompiled: (session) => session instanceof GameSession && session.isDurableCompiledSession() })).toEqual(["validrestart"]);
      expect(deleted).toEqual([]);
      expect(built.snapshots.read("validrestart")).toMatchObject({ status: "ok" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps state-limit and terminal replay behavior stable across a fresh rehydration", async () => {
    const dir = root();
    const uninterruptedDir = root();
    const originalRandom = Math.random;
    try {
      const built = await durableSession(dir);
      const uninterruptedBuilt = await durableSession(uninterruptedDir);
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      Math.random = () => 0.99;
      let current = commitAndRestore(built.session, built, compiledMechanicsAction(ids.parent), "a").current;
      current = commitAndRestore(current, built, compiledMechanicsAction(ids.entry), "b").current;
      current = commitAndRestore(current, built, compiledMechanicsAction(ids.child), "c").current;
      const restarted = restoreFresh(built);
      let uninterrupted = commitAndRestore(uninterruptedBuilt.session, uninterruptedBuilt, compiledMechanicsAction(ids.parent), "a").current;
      uninterrupted = commitAndRestore(uninterrupted, uninterruptedBuilt, compiledMechanicsAction(ids.entry), "b").current;
      uninterrupted = commitAndRestore(uninterrupted, uninterruptedBuilt, compiledMechanicsAction(ids.child), "c").current;
      uninterrupted = commitAndRestore(uninterrupted, uninterruptedBuilt, compiledMechanicsAction(ids.child), "d").current;
      const resumed = commitAndRestore(restarted, built, compiledMechanicsAction(ids.child), "d").current;
      expect(resumed.getCompiledMechanicsState()).toEqual(uninterrupted.getCompiledMechanicsState());
      expect(resumed.getCompiledGeneration()).toBe(uninterrupted.getCompiledGeneration());
      expect(mechanicsStateHash(resumed.getCompiledMechanicsState()!.state)).toBe(mechanicsStateHash(uninterrupted.getCompiledMechanicsState()!.state));
    } finally {
      Math.random = originalRandom;
      rmSync(dir, { recursive: true, force: true });
      rmSync(uninterruptedDir, { recursive: true, force: true });
    }
  });

  it("proves a fresh Worker module can hydrate, retry the stored action, continue, and preserve terminal narration", async () => {
    const dir = root();
    const uninterruptedDir = root();
    const originalRandom = Math.random;
    try {
      const built = await durableSession(dir, "freshprocess");
      const baseline = await durableSession(uninterruptedDir, "uninterrupted");
      const ids = methodIds(built.fixture.resolved.artifact.payload);
      Math.random = () => 0.99;
      let processA = built.session;
      for (const [index, input] of [ids.parent, ids.entry, ids.child, ids.child, ids.child].entries()) {
        processA = commitAndRestore(processA, built, compiledMechanicsAction(input), `fresh-${index}`).current;
      }
      let uninterrupted = baseline.session;
      for (const [index, input] of [ids.parent, ids.entry, ids.child, ids.child, ids.child, ids.exit].entries()) {
        uninterrupted = commitAndRestore(uninterrupted, baseline, compiledMechanicsAction(input), `fresh-${index}`).current;
      }
      const proof = await runFreshWorkerRestartProof({
        root: dir,
        sessionId: "freshprocess",
        duplicateInput: compiledMechanicsAction(ids.child),
        duplicateActionId: "fresh-2",
        expectedGeneration: 2,
        nextInput: compiledMechanicsAction(ids.exit),
        nextActionId: "fresh-5",
        nextExpectedGeneration: 5,
      });
      expect(proof.ordering).toEqual(["header", "catalog", "body", "restore"]);
      const persisted = built.snapshots.read("freshprocess");
      expect(persisted.status).toBe("ok");
      if (persisted.status === "refused") return;
      const checkedResponse = (persisted.value as CompiledSessionSnapshot).idempotency.find((record) => record.actionId === "fresh-2")!.response;
      expect(proof.duplicate as any).toEqual({ ...checkedResponse.action, summary: checkedResponse.summary, generation: checkedResponse.generation });
      expect((proof.duplicate as any).dice).toMatchObject([{ expr: "d100", total: expect.any(Number), detail: "library_use/hard" }]);
      expect(proof.duplicate.generation).toBe(3);
      expect(proof.continued).toMatchObject({ generation: 6, narrative: "ending:rule_clean", compiled: { stateHash: uninterrupted.getCompiledMechanicsState()!.stateHash, terminalEnding: { id: "clean" } } });
      expect(proof.history).toBeGreaterThan(0);
    } finally {
      Math.random = originalRandom;
      rmSync(dir, { recursive: true, force: true });
      rmSync(uninterruptedDir, { recursive: true, force: true });
    }
  });
});
