import { join } from "path";
import { GameSession } from "../api/game-session";
import { CompiledSessionSnapshotStore, type CompiledSessionSnapshot } from "../api/compiled-session-snapshot";
import { CompilerArtifactCatalog } from "../compiler/compiler-artifact-catalog";
import { runAction } from "../api/server";

const [root, sessionId, duplicateInput, duplicateActionId, expectedGenerationText, nextInput, nextActionId, nextExpectedGenerationText] = process.argv.slice(2);
if (!root || !sessionId || !duplicateInput || !duplicateActionId || !expectedGenerationText || !nextInput || !nextActionId || !nextExpectedGenerationText) throw new Error("restart child requires action identities and generations");
const expectedGeneration = Number(expectedGenerationText);
if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) throw new Error("restart child generation is invalid");
const nextExpectedGeneration = Number(nextExpectedGenerationText);
if (!Number.isSafeInteger(nextExpectedGeneration) || nextExpectedGeneration < 0) throw new Error("restart child next generation is invalid");
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
const bundleValue = bundle.value;

function restore(value: CompiledSessionSnapshot): GameSession {
  const session = new GameSession(sessionId, "cosmic-horror", config, undefined, undefined, undefined, { careerRoot: join(root, "careers") });
  const result = session.restoreCompiledSession(value, bundleValue);
  if (result.status === "refused") throw new Error(result.message);
  return session;
}

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
console.log(JSON.stringify({ ordering, duplicate: duplicate.body, continued: continued.body, history: continued.session.getPlayerHistory("p1").total }));
