import { join } from "path";
import { GameSession } from "../api/game-session";
import { CompiledSessionSnapshotStore, type CompiledSessionSnapshot } from "../api/compiled-session-snapshot";
import { CompilerArtifactCatalog } from "../compiler/compiler-artifact-catalog";
import { runAction } from "../api/server";

export interface FreshModuleRestartRequest {
  root: string;
  sessionId: string;
  duplicateInput: string;
  duplicateActionId: string;
  expectedGeneration: number;
  nextInput: string;
  nextActionId: string;
  nextExpectedGeneration: number;
}

/**
 * The runner deliberately reconstructs only from durable header/catalog/body
 * state. It can execute as a CLI or in a Worker module, neither of which inherits
 * the test module's live GameSession.
 */
export async function runFreshModuleRestartProof(request: FreshModuleRestartRequest): Promise<{
  ordering: string[];
  duplicate: Record<string, unknown>;
  continued: Record<string, unknown>;
  history: number;
}> {
  const { root, sessionId, duplicateInput, duplicateActionId, expectedGeneration, nextInput, nextActionId, nextExpectedGeneration } = request;
  if (!root || !sessionId || !duplicateInput || !duplicateActionId || !nextInput || !nextActionId || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || !Number.isSafeInteger(nextExpectedGeneration) || nextExpectedGeneration < 0) throw new Error("restart runner requires valid action identities and generations");
  const config = { apiKey: "sk-placeholder", baseUrl: "http://offline.invalid", model: "offline", maxTokens: 1, temperature: 0 };
  const catalog = new CompilerArtifactCatalog({ root: join(root, "catalog") });
  const snapshots = new CompiledSessionSnapshotStore({ root: join(root, "snapshots") });
  const ordering: string[] = [];
  const header = snapshots.readHeader(sessionId);
  if (header.status === "refused") throw new Error(header.message);
  ordering.push("header");
  const bundle = catalog.loadBundle(header.value.bundleId);
  if (bundle.status === "refused") throw new Error(bundle.message);
  ordering.push("catalog");
  const raw = snapshots.read(sessionId);
  if (raw.status === "refused") throw new Error(raw.message);
  const snapshot = raw.value as CompiledSessionSnapshot;
  if (snapshot.sessionId !== header.value.sessionId || snapshot.bundle.id !== header.value.bundleId || snapshot.snapshotHash !== header.value.snapshotHash || snapshot.generation !== header.value.generation) throw new Error("snapshot body does not match the bounded startup header");
  ordering.push("body");
  const restore = (value: CompiledSessionSnapshot): GameSession => {
    const session = new GameSession(sessionId, "cosmic-horror", config, undefined, undefined, undefined, { careerRoot: join(root, "careers") });
    const result = session.restoreCompiledSession(value, bundle.value);
    if (result.status === "refused") throw new Error(result.message);
    return session;
  };
  const initial = restore(snapshot);
  ordering.push("restore");
  const install = (value: CompiledSessionSnapshot) => restore(value);
  const duplicate = await runAction(initial, { input: duplicateInput, pcId: "p1", actionId: duplicateActionId, expectedGeneration }, undefined, install);
  if (duplicate.status !== 200 || !duplicate.session) throw new Error(`duplicate retry failed: ${JSON.stringify(duplicate.body)}`);
  const continued = await runAction(duplicate.session, { input: nextInput, pcId: "p1", actionId: nextActionId, expectedGeneration: nextExpectedGeneration }, (value) => {
    const saved = snapshots.save(value);
    if (saved.status === "refused") throw new Error(saved.message);
  }, install);
  if (continued.status !== 200 || !continued.session) throw new Error(`continued action failed: ${JSON.stringify(continued.body)}`);
  return { ordering, duplicate: duplicate.body, continued: continued.body, history: continued.session.getPlayerHistory("p1").total };
}

type FreshRestartWorkerScope = {
  postMessage(message: { status: "ok"; proof: Awaited<ReturnType<typeof runFreshModuleRestartProof>> } | { status: "error"; message: string }): void;
  addEventListener(type: "message", listener: (event: { data: FreshModuleRestartRequest }) => void | Promise<void>): void;
};

const workerScope = globalThis as typeof globalThis & Partial<FreshRestartWorkerScope>;
const isFreshRestartWorker = !import.meta.main && typeof workerScope.postMessage === "function" && typeof workerScope.addEventListener === "function";

if (isFreshRestartWorker) {
  const scope = workerScope as typeof globalThis & FreshRestartWorkerScope;
  scope.addEventListener("message", async (event) => {
    try {
      scope.postMessage({ status: "ok", proof: await runFreshModuleRestartProof(event.data) });
    } catch (error) {
      scope.postMessage({ status: "error", message: error instanceof Error ? error.message : "fresh restart worker failed" });
    }
  });
} else if (import.meta.main) {
  const [root, sessionId, duplicateInput, duplicateActionId, expectedGenerationText, nextInput, nextActionId, nextExpectedGenerationText] = process.argv.slice(2);
  const proof = await runFreshModuleRestartProof({ root: root ?? "", sessionId: sessionId ?? "", duplicateInput: duplicateInput ?? "", duplicateActionId: duplicateActionId ?? "", expectedGeneration: Number(expectedGenerationText), nextInput: nextInput ?? "", nextActionId: nextActionId ?? "", nextExpectedGeneration: Number(nextExpectedGenerationText) });
  console.log(JSON.stringify(proof));
}
