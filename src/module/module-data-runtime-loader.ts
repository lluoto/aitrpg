// Direct ModuleData runtime loader (step 5C).
//
// This intentionally does not import deriveMythosModule or MythosModuleLoader.
// It reads ModuleData's narrative structure plus its runtime group directly.

import type { Clue, ModuleData, ModuleItem, ModuleNPC, SceneConnection } from "./types";
import type {
  ModuleRuntimeConfig,
  RuntimeClueBinding,
  RuntimeItemPlacement,
  RuntimeModuleHook,
  RuntimeModuleReward,
  RuntimeModuleSpell,
  RuntimeModuleTome,
  RuntimeNpcSnapshot,
} from "./runtime-types";

export interface RuntimeSceneExit {
  target: string;
  desc: string;
}

export interface ModuleDataRuntimeHost {
  registerScene(scene: { id: string; name: string; description: string; exits: RuntimeSceneExit[] }): void;
  registerRuntimeNpc(npc: ModuleNPC, runtime: RuntimeNpcSnapshot): void;
  registerNarrativeNpc(npc: ModuleNPC): void;
  registerRichClue(sceneId: string, clue: Clue, sanCost?: string): void;
  registerLegacyClue(binding: RuntimeClueBinding): void;
  registerTome(tome: RuntimeModuleTome): void;
  registerItemPlacement(item: RuntimeItemPlacement): void;
  registerRichItem(item: ModuleItem): void;
  registerSpell(spell: RuntimeModuleSpell): void;
  registerHook(hook: RuntimeModuleHook): void;
  registerRewards(rewards: RuntimeModuleReward[]): void;
  registerKpNotes(notes: Record<string, string>): void;
  registerSceneBgm(bgm: Record<string, string>): void;
  registerSceneAliases(aliases: Record<string, string[]>): void;
  applyInitialEffects(effects: NonNullable<ModuleRuntimeConfig["initialEffects"]>): void;
  addIntroNarration(text: string): void;
}

export interface ModuleDataLoadResult {
  id: string;
  name: string;
  entryScene: string | null;
  lines: string[];
  narrative: Pick<ModuleData, "endings" | "epilogues" | "prologue" | "partySetup" | "narrative">;
}

function runtimeOf(module: ModuleData): ModuleRuntimeConfig {
  const runtime = module.runtime;
  if (!runtime?.activation || !runtime.difficulty || !runtime.sourceIdentity) {
    throw new Error("ModuleData 缺少步骤 5B 迁入的运行配置");
  }
  return runtime;
}

function toRuntimeExit(connection: SceneConnection): RuntimeSceneExit {
  // C2 policy: ModuleData.condition is source-backed, player-actionable text;
  // the legacy desc map is frozen only for regression and retirement planning.
  return { target: connection.targetSceneId, desc: connection.condition };
}

export class ModuleDataRuntimeLoader {
  private imported = new Set<string>();

  constructor(private readonly host: ModuleDataRuntimeHost) {}

  import(module: ModuleData): ModuleDataLoadResult {
    if (this.imported.has(module.id)) {
      return {
        id: module.id,
        name: module.title,
        entryScene: module.scenes[0]?.id ?? null,
        lines: [`模组「${module.title}」已导入。`],
        narrative: pickNarrative(module),
      };
    }
    const runtime = runtimeOf(module);
    this.imported.add(module.id);
    const lines = [`【统一模组：${module.title}】`, `难度：${runtime.difficulty} | ${module.summary}`];

    for (const scene of module.scenes) {
      this.host.registerScene({
        id: scene.id,
        name: scene.name,
        description: scene.description,
        exits: scene.connections.map(toRuntimeExit),
      });
    }
    lines.push(`注册 ${module.scenes.length} 个模组场景`);
    lines.push(`构建 ${module.scenes.flatMap((scene) => scene.connections).length} 条统一场景出口`);

    for (const npc of module.npcs) {
      if (npc.runtime) this.host.registerRuntimeNpc(npc, npc.runtime);
      else this.host.registerNarrativeNpc(npc);
    }
    lines.push(`注册 ${module.npcs.length} 个叙事 NPC，其中 ${module.npcs.filter((npc) => npc.runtime).length} 个带运行配置`);

    for (const scene of module.scenes) {
      for (const clue of scene.clues) this.host.registerRichClue(scene.id, clue, runtime.richClueSanCosts?.[clue.id]);
    }
    lines.push(`注册 ${module.scenes.flatMap((scene) => scene.clues).length} 条丰富线索`);

    for (const binding of runtime.clueBindings ?? []) this.host.registerLegacyClue(binding);
    if (runtime.clueBindings?.length) lines.push(`注册 ${runtime.clueBindings.length} 条兼容线索绑定`);

    for (const tome of runtime.tomes ?? []) this.host.registerTome(tome);
    for (const item of runtime.itemPlacements ?? []) this.host.registerItemPlacement(item);
    for (const item of module.items) this.host.registerRichItem(item);
    for (const spell of runtime.spells ?? []) this.host.registerSpell(spell);
    for (const hook of runtime.hooks ?? []) this.host.registerHook(hook);
    if (runtime.rewards) this.host.registerRewards(runtime.rewards);
    if (runtime.kpNotes) this.host.registerKpNotes(runtime.kpNotes);
    if (runtime.sceneBgm) this.host.registerSceneBgm(runtime.sceneBgm);
    if (runtime.sceneAliases) this.host.registerSceneAliases(runtime.sceneAliases);
    if (runtime.initialEffects) this.host.applyInitialEffects(runtime.initialEffects);
    if (runtime.introNarration) this.host.addIntroNarration(runtime.introNarration);

    return {
      id: module.id,
      name: module.title,
      entryScene: module.scenes[0]?.id ?? null,
      lines,
      narrative: pickNarrative(module),
    };
  }
}

function pickNarrative(module: ModuleData): ModuleDataLoadResult["narrative"] {
  return {
    endings: module.endings,
    epilogues: module.epilogues,
    prologue: module.prologue,
    partySetup: module.partySetup,
    narrative: module.narrative,
  };
}
