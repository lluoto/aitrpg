// Step 5A lossless projection helpers.
//
// These are intentionally pure adapters. No active loader imports this file:
// 5A proves the target shape can carry both representations; 5B decides when
// a runtime actually reads ModuleData.runtime.

import type { ModuleData, ModuleNPC } from "./types";
import type {
  ModuleRuntimeConfig,
  RuntimeNpcSnapshot,
} from "./runtime-types";
import type { MythosModule, ModuleNPC as MythosModuleNPC } from "../rules/mythos-module";

export interface RuntimeFieldDifference {
  field: keyof ModuleRuntimeConfig;
  expected: unknown;
  actual: unknown;
}

function normalizeName(name: string): string {
  return name.replace(/（[^）]*）$/, "");
}

export function projectRuntimeNpc(npc: MythosModuleNPC): RuntimeNpcSnapshot {
  return {
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
  };
}

export function projectMythosRuntime(module: MythosModule): ModuleRuntimeConfig {
  return {
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
    legacyEndings: module.endings,
    itemPlacements: module.items,
    clueBindings: module.clues,
  };
}

export function restoreMythosRuntimeFields(runtime: ModuleRuntimeConfig): ModuleRuntimeConfig {
  return {
    sourceIdentity: runtime.sourceIdentity,
    activation: runtime.activation,
    difficulty: runtime.difficulty,
    source: runtime.source,
    introNarration: runtime.introNarration,
    spells: runtime.spells,
    tomes: runtime.tomes,
    rewards: runtime.rewards,
    kpNotes: runtime.kpNotes,
    initialEffects: runtime.initialEffects,
    hooks: runtime.hooks,
    sceneBgm: runtime.sceneBgm,
    sceneAliases: runtime.sceneAliases,
    legacyEndings: runtime.legacyEndings,
    itemPlacements: runtime.itemPlacements,
    clueBindings: runtime.clueBindings,
  };
}

export function findRuntimeProjectionDifferences(
  expected: ModuleRuntimeConfig,
  actual: ModuleRuntimeConfig,
): RuntimeFieldDifference[] {
  const fields: Array<keyof ModuleRuntimeConfig> = [
    "sourceIdentity", "activation", "difficulty", "source", "introNarration", "spells", "tomes",
    "rewards", "kpNotes", "initialEffects", "hooks", "sceneBgm", "sceneAliases",
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

// Constructing this object is a type-level rehearsal only. It does not alter
// BARN_OF_PREMIER or MODULE_PREMIERS_BARN, and no loader consumes the result.
export function buildUnifiedModuleData(
  narrative: ModuleData,
  runtimeModule: MythosModule,
): ModuleData {
  const runtimeByName = new Map(
    (runtimeModule.npcs ?? []).map((npc) => [normalizeName(npc.name), projectRuntimeNpc(npc)]),
  );
  const npcs: ModuleNPC[] = narrative.npcs.map((npc) => {
    const runtime = runtimeByName.get(normalizeName(npc.name));
    return runtime ? { ...npc, runtime } : npc;
  });

  return {
    ...narrative,
    npcs,
    runtime: projectMythosRuntime(runtimeModule),
  };
}
