import type { ModuleNPC } from "./types";
import type { RuntimeNpcSnapshot } from "./runtime-types";

function normalizeName(name: string): string {
  return name.replace(/（[^）]*）$/, "");
}

function runtimeNpcIndex(snapshots: RuntimeNpcSnapshot[]): Map<string, RuntimeNpcSnapshot> {
  const byName = new Map<string, RuntimeNpcSnapshot>();
  const sourceIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (sourceIds.has(snapshot.sourceId)) throw new Error(`runtime NPC sourceId 重复：${snapshot.sourceId}`);
    sourceIds.add(snapshot.sourceId);
    const name = normalizeName(snapshot.sourceName);
    if (byName.has(name)) throw new Error(`runtime NPC 归一化姓名重复：${name}`);
    byName.set(name, structuredClone(snapshot));
  }
  return byName;
}

/** Attach validated runtime snapshots to their narrative ModuleNPC counterparts. */
export function attachRuntimeNpcs(
  narrativeNpcs: ModuleNPC[],
  snapshots: RuntimeNpcSnapshot[],
): ModuleNPC[] {
  const runtimeByName = runtimeNpcIndex(snapshots);
  const matchedSourceIds = new Set<string>();
  const npcs = narrativeNpcs.map((npc) => {
    const runtime = runtimeByName.get(normalizeName(npc.name));
    if (!runtime) return npc;
    matchedSourceIds.add(runtime.sourceId);
    return { ...npc, runtime };
  });
  const missing = [...runtimeByName.values()]
    .filter((runtime) => !matchedSourceIds.has(runtime.sourceId))
    .map((runtime) => runtime.sourceId);
  if (missing.length > 0) throw new Error(`runtime NPC 无对应叙事 NPC：${missing.join(", ")}`);
  return npcs;
}
