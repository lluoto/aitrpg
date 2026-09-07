// Step 5 unified adapters.
//
// These functions are pure, isolated projections. During 5B the custom
// Mythos export is derived from ModuleData; no active loader imports this
// module directly, so loader switching remains a later behavior change.

import type { ModuleData, ModuleNPC } from "./types";
import type { ModuleRuntimeConfig, RuntimeNpcSnapshot } from "./runtime-types";
import type { MythosModule, ModuleNPC as MythosModuleNPC } from "../rules/mythos-module";

export interface RuntimeFieldDifference {
  field: keyof ModuleRuntimeConfig;
  expected: unknown;
  actual: unknown;
}

function normalizeName(name: string): string {
  return name.replace(/（[^）]*）$/, "");
}

function isolated<T>(value: T): T {
  return structuredClone(value);
}

export function projectRuntimeNpc(npc: MythosModuleNPC): RuntimeNpcSnapshot {
  return isolated({
    sourceId: npc.id,
    sourceName: npc.name,
    sceneId: npc.sceneId,
    type: npc.type,
    hp: npc.hp,
    maxHp: npc.maxHp,
    ac: npc.ac,
    faction: npc.faction,
    tacticsKey: npc.tacticsKey,
    mythosCreatureId: npc.mythosCreatureId,
    attributes: npc.attributes,
    skills: npc.skills,
    age: npc.age,
    gender: npc.gender,
    dialogHints: npc.dialogHints,
    npcPersonalityId: npc.npcPersonalityId,
    personality: npc.personality,
  });
}

// This shape is deliberately independent from ModuleRuntimeConfig. It reads
// directly from a MythosModule source so an omitted field cannot disappear on
// both sides of a project-then-restore comparison.
export function readMythosRuntimeFields(module: MythosModule): ModuleRuntimeConfig {
  return isolated({
    sourceIdentity: {
      id: module.id,
      name: module.name,
      version: module.version,
      description: module.description,
    },
    activation: module.activation,
    difficulty: module.difficulty,
    source: module.source,
    introNarration: module.introNarration,
    spells: module.spells,
    tomes: module.tomes,
    rewards: module.rewards,
    kpNotes: module.kpNotes,
    initialEffects: module.initialEffects,
    hooks: module.hooks,
    sceneBgm: module.sceneBgm,
    sceneAliases: module.sceneAliases,
    loaderSceneDescriptions: module.sceneDescriptions,
    loaderExits: module.exits,
    runtimeNpcOrder: (module.npcs ?? []).map((npc) => npc.id),
    legacyEndings: module.endings,
    itemPlacements: module.items,
    clueBindings: module.clues,
  });
}

export function projectMythosRuntime(module: MythosModule): ModuleRuntimeConfig {
  return readMythosRuntimeFields(module);
}

export function restoreMythosRuntimeFields(runtime: ModuleRuntimeConfig): ModuleRuntimeConfig {
  return isolated(runtime);
}

export function findRuntimeProjectionDifferences(
  expected: ModuleRuntimeConfig,
  actual: ModuleRuntimeConfig,
): RuntimeFieldDifference[] {
  const fields: Array<keyof ModuleRuntimeConfig> = [
    "sourceIdentity", "activation", "difficulty", "source", "introNarration", "spells", "tomes",
    "rewards", "kpNotes", "initialEffects", "hooks", "sceneBgm", "sceneAliases",
    "loaderSceneDescriptions", "loaderExits", "runtimeNpcOrder", "npcStats",
    "legacyEndings", "itemPlacements", "clueBindings",
  ];
  return fields.flatMap((field) =>
    structuredEqual(expected[field], actual[field]) ? [] : [{ field, expected: expected[field], actual: actual[field] }],
  );
}

function structuredEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => structuredEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && structuredEqual(left[key], right[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function runtimeNpcIndex(runtimeModule: MythosModule): Map<string, RuntimeNpcSnapshot> {
  const byName = new Map<string, RuntimeNpcSnapshot>();
  const sourceIds = new Set<string>();
  for (const sourceNpc of runtimeModule.npcs ?? []) {
    if (sourceIds.has(sourceNpc.id)) {
      throw new Error(`runtime NPC sourceId 重复：${sourceNpc.id}`);
    }
    sourceIds.add(sourceNpc.id);
    const name = normalizeName(sourceNpc.name);
    if (byName.has(name)) {
      throw new Error(`runtime NPC 归一化姓名重复：${name}`);
    }
    byName.set(name, projectRuntimeNpc(sourceNpc));
  }
  return byName;
}

// A rehearsal only: it copies both inputs, detects ambiguous/missing NPC
// matches, and returns a standalone ModuleData snapshot. No loader consumes it.
export function buildUnifiedModuleData(
  narrative: ModuleData,
  runtimeModule: MythosModule,
  npcStats?: Record<string, Record<string, number | string>>,
): ModuleData {
  const narrativeSnapshot = isolated(narrative);
  const runtimeByName = runtimeNpcIndex(runtimeModule);
  const matchedSourceIds = new Set<string>();
  const npcs: ModuleNPC[] = narrativeSnapshot.npcs.map((npc) => {
    const runtime = runtimeByName.get(normalizeName(npc.name));
    if (!runtime) return npc;
    matchedSourceIds.add(runtime.sourceId);
    return { ...npc, runtime };
  });
  const missing = [...runtimeByName.values()]
    .filter((runtime) => !matchedSourceIds.has(runtime.sourceId))
    .map((runtime) => runtime.sourceId);
  if (missing.length > 0) {
    throw new Error(`runtime NPC 无对应叙事 NPC：${missing.join(", ")}`);
  }

  const runtime = projectMythosRuntime(runtimeModule);
  if (npcStats) runtime.npcStats = isolated(npcStats);
  return {
    ...narrativeSnapshot,
    npcs,
    runtime,
  };
}

interface ReadyRuntimeConfig extends ModuleRuntimeConfig {
  sourceIdentity: NonNullable<ModuleRuntimeConfig["sourceIdentity"]>;
  activation: NonNullable<ModuleRuntimeConfig["activation"]>;
  difficulty: NonNullable<ModuleRuntimeConfig["difficulty"]>;
}

function requireRuntime(module: ModuleData): ReadyRuntimeConfig {
  const runtime = module.runtime;
  if (!runtime?.sourceIdentity || !runtime.activation || !runtime.difficulty) {
    throw new Error("统一 ModuleData 缺少运行时身份、activation 或 difficulty");
  }
  return {
    ...runtime,
    sourceIdentity: runtime.sourceIdentity,
    activation: runtime.activation,
    difficulty: runtime.difficulty,
  };
}

// The thin legacy export adapter used by custom-modules/premiers_barn.ts.
// It has no dependency on that entry point, preventing an adapter cycle.
export function deriveMythosModule(module: ModuleData): MythosModule {
  const runtime = requireRuntime(module);
  const runtimeById = new Map(
    module.npcs.flatMap((npc) => npc.runtime ? [[npc.runtime.sourceId, npc.runtime] as const] : []),
  );
  const npcs = (runtime.runtimeNpcOrder ?? []).map((sourceId) => {
    const snapshot = runtimeById.get(sourceId);
    if (!snapshot) throw new Error(`统一 ModuleData 缺少运行 NPC：${sourceId}`);
    return {
      id: snapshot.sourceId,
      name: snapshot.sourceName,
      sceneId: snapshot.sceneId,
      type: snapshot.type,
      hp: snapshot.hp,
      maxHp: snapshot.maxHp,
      ac: snapshot.ac,
      faction: snapshot.faction,
      tacticsKey: snapshot.tacticsKey,
      mythosCreatureId: snapshot.mythosCreatureId,
      attributes: snapshot.attributes,
      skills: snapshot.skills,
      age: snapshot.age,
      gender: snapshot.gender,
      dialogHints: snapshot.dialogHints,
      npcPersonalityId: snapshot.npcPersonalityId,
      personality: snapshot.personality,
    };
  });
  const identity = runtime.sourceIdentity;
  return {
    id: identity.id,
    name: identity.name,
    version: identity.version,
    description: identity.description,
    difficulty: runtime.difficulty,
    activation: isolated(runtime.activation),
    ...(runtime.source === undefined ? {} : { source: runtime.source }),
    ...(runtime.loaderExits === undefined ? {} : { exits: isolated(runtime.loaderExits) }),
    ...(runtime.loaderSceneDescriptions === undefined ? { } : { sceneDescriptions: isolated(runtime.loaderSceneDescriptions) }),
    ...(runtime.sceneBgm === undefined ? {} : { sceneBgm: isolated(runtime.sceneBgm) }),
    ...(runtime.sceneAliases === undefined ? {} : { sceneAliases: isolated(runtime.sceneAliases) }),
    ...(runtime.introNarration === undefined ? {} : { introNarration: runtime.introNarration }),
    ...(runtime.spells === undefined ? {} : { spells: isolated(runtime.spells) }),
    ...(runtime.tomes === undefined ? {} : { tomes: isolated(runtime.tomes) }),
    ...(runtime.itemPlacements === undefined ? {} : { items: isolated(runtime.itemPlacements) }),
    npcs,
    ...(runtime.initialEffects === undefined ? {} : { initialEffects: isolated(runtime.initialEffects) }),
    ...(runtime.clueBindings === undefined ? {} : { clues: isolated(runtime.clueBindings) }),
    ...(runtime.hooks === undefined ? {} : { hooks: isolated(runtime.hooks) }),
    ...(runtime.legacyEndings === undefined ? {} : { endings: isolated(runtime.legacyEndings) }),
    ...(runtime.rewards === undefined ? {} : { rewards: isolated(runtime.rewards) }),
    ...(runtime.kpNotes === undefined ? {} : { kpNotes: isolated(runtime.kpNotes) }),
  };
}
