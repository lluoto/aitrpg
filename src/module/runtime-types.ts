// 统一模组类型的运行时字段（步骤 5A）。
//
// 本文件是 module/types.ts（叙事结构）与 rules/mythos-module.ts（加载器）
// 之间的中立数据类型层。它不得 import 任何一侧，避免 ModuleData 反向
// import MythosModule 形成循环依赖。

import type { NPCMood } from "../agent/types";

export type RuntimeDifficulty = "easy" | "medium" | "hard" | "nightmare";

export interface RuntimeActivation {
  type: "manual" | "location_enter" | "item_found" | "read_tome" | "san_threshold";
  condition: string;
}

// Kept alongside runtime config during 5A so a future migration does not
// silently choose ModuleData's top-level copy when the two source values differ.
export interface RuntimeModuleIdentity {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface RuntimeModuleSpell {
  name: string;
  sanCost: string;
  mpCost: number;
  description: string;
  effectType?: string;
}

export interface RuntimeModuleTome {
  name: string;
  sceneId: string;
  sanCost: string;
  tomeRating: number;
  spells: string[];
  openDescription: string;
}

// Kept separate from ModuleData.ModuleItem: this is a placement record,
// not a rich interactable item with an id, type, revelation, or trap rules.
export interface RuntimeItemPlacement {
  name: string;
  sceneId: string;
  description?: string;
}

// Kept separate from EndNarration/Ending: conditionText is LLM-facing prose,
// not the structured, machine-evaluable condition used by EndNarration.
export interface RuntimeModuleEnding {
  id: string;
  name: string;
  description: string;
  conditionText: string;
  narration?: string;
}

export interface RuntimeModuleReward {
  id: string;
  description: string;
  conditionText: string;
  sanChange?: string;
  cmChange?: number;
  reputationChange?: number;
  skillGrowth?: Record<string, string>;
}

// Kept separate from Clue: Mythos bindings only name an InvestigationEngine
// clue and optional copy/SAN cost; they do not express discovery mechanics.
export interface RuntimeClueBinding {
  scene: string;
  clueType: string;
  description?: string;
  sanCost?: string;
}

export interface RuntimeModuleHook {
  type: "on_enter_scene" | "on_combat_start" | "on_read_tome" | "on_investigate";
  condition: string;
  narration?: string;
  effect?: string;
}

export interface RuntimeInitialEffect {
  target: string;
  field: string;
  value: unknown;
}

export interface RuntimeNpcPersonality {
  role?: string;
  personality?: string;
  background?: string;
  goals?: string[];
  speech_style?: string;
  knowledge?: string[];
  secrets?: string[];
  attitudes?: Record<string, string>;
  traits?: {
    courage: number;
    friendliness: number;
    suspicion: number;
    curiosity: number;
    stability: number;
  };
  initialMood?: NPCMood;
  factions?: Array<{ name: string; loyalty: number }>;
}

// Explicit nested combat/loader configuration for a narrative ModuleNPC.
// id/name/sceneId remain on ModuleNPC itself; these fields are intentionally
// not mixed with narrative role/description/knowledge/secrets.
export interface RuntimeNpcConfig {
  type: "npc" | "monster";
  hp: number;
  maxHp: number;
  ac: number;
  faction: string;
  tacticsKey?: string;
  mythosCreatureId?: string;
  attributes?: Record<string, number>;
  skills?: Record<string, number>;
  age?: number;
  gender?: "male" | "female";
  dialogHints?: string[];
  npcPersonalityId?: string;
  personality?: RuntimeNpcPersonality;
}

// A runtime snapshot is what gets nested in a narrative ModuleNPC. Source
// identity stays explicit because the two active representations can differ.
export interface RuntimeNpcSnapshot extends RuntimeNpcConfig {
  sourceId: string;
  sourceName: string;
  sceneId: string;
}

// ModuleData.runtime is deliberately loader-shaped rather than ModuleSupport:
// it stores serializable configuration, while ModuleSupport remains reserved
// for module-specific executable hooks and constants.
export interface ModuleRuntimeConfig {
  sourceIdentity?: RuntimeModuleIdentity;
  activation?: RuntimeActivation;
  difficulty?: RuntimeDifficulty;
  source?: string;
  introNarration?: string;
  spells?: RuntimeModuleSpell[];
  tomes?: RuntimeModuleTome[];
  rewards?: RuntimeModuleReward[];
  kpNotes?: Record<string, string>;
  initialEffects?: RuntimeInitialEffect[];
  hooks?: RuntimeModuleHook[];
  sceneBgm?: Record<string, string>;
  sceneAliases?: Record<string, string[]>;
  legacyEndings?: RuntimeModuleEnding[];
  itemPlacements?: RuntimeItemPlacement[];
  clueBindings?: RuntimeClueBinding[];
}
