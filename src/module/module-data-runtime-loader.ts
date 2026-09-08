// Direct ModuleData runtime loader (step 5C).
//
// This intentionally does not import deriveMythosModule or MythosModuleLoader.
// It reads ModuleData's narrative structure plus its runtime group directly.

import type { Clue, ModuleData, ModuleItem, ModuleNPC, SceneConnection } from "./types";
import type {
  ModuleRuntimeConfig,
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

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} 重复：${value}`);
    seen.add(value);
  }
}

function validateBeforeHostWrites(module: ModuleData): ModuleRuntimeConfig {
  const runtime = runtimeOf(module);
  assertUnique(module.scenes.map((scene) => scene.id), "Scene.id");
  const sceneIds = new Set(module.scenes.map((scene) => scene.id));
  for (const scene of module.scenes) {
    for (const connection of scene.connections) {
      if (!sceneIds.has(connection.targetSceneId)) {
        throw new Error(`Scene.connection 悬空：${scene.id} -> ${connection.targetSceneId}`);
      }
    }
  }
  assertUnique(module.npcs.map((npc) => npc.id), "ModuleNPC.id");
  assertUnique(module.items.map((item) => item.id), "ModuleItem.id");
  assertUnique(module.scenes.flatMap((scene) => scene.clues.map((clue) => clue.id)), "Clue.id");

  const runtimeSnapshots = module.npcs.flatMap((npc) => npc.runtime ? [npc.runtime] : []);
  const sourceIds = runtimeSnapshots.map((snapshot) => snapshot.sourceId);
  assertUnique(sourceIds, "runtime NPC sourceId");
  const order = runtime.runtimeNpcOrder ?? [];
  assertUnique(order, "runtimeNpcOrder");
  const snapshotIds = new Set(sourceIds);
  for (const sourceId of order) {
    if (!snapshotIds.has(sourceId)) throw new Error(`runtimeNpcOrder 引用不存在 snapshot：${sourceId}`);
  }
  const orderIds = new Set(order);
  const unconsumed = sourceIds.filter((sourceId) => !orderIds.has(sourceId));
  if (unconsumed.length > 0) throw new Error(`runtime snapshot 未被 order 消费：${unconsumed.join(", ")}`);
  return runtime;
}

function toRuntimeExit(connection: SceneConnection): RuntimeSceneExit {
  // C2 policy: ModuleData.condition is source-backed, player-actionable text;
  // the legacy desc map is frozen only for regression and retirement planning.
  return { target: connection.targetSceneId, desc: connection.condition };
}

export class ModuleDataRuntimeLoader {
  private imported = new Set<string>();
  /** 成功返回的 host 操作；失败重试时跳过，避免重复追加副作用。 */
  private completedOperations = new Map<string, Set<string>>();

  constructor(private readonly host: ModuleDataRuntimeHost) {}

  private runOperation(moduleId: string, key: string, operation: () => void): void {
    const completed = this.completedOperations.get(moduleId) ?? new Set<string>();
    this.completedOperations.set(moduleId, completed);
    if (completed.has(key)) return;
    // Host callbacks must be atomic or idempotent: throwing means the operation
    // did not commit. GameSession callbacks satisfy this contract.
    operation();
    completed.add(key);
  }

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
    // All structural checks happen before the first host write.
    const runtime = validateBeforeHostWrites(module);
    const lines = [`【统一模组：${module.title}】`, `难度：${runtime.difficulty} | ${module.summary}`];

    module.scenes.forEach((scene, index) => {
      this.runOperation(module.id, `scene:${index}:${scene.id}`, () => this.host.registerScene({
        id: scene.id,
        name: scene.name,
        description: scene.description,
        exits: scene.connections.map(toRuntimeExit),
      }));
    });
    lines.push(`注册 ${module.scenes.length} 个模组场景`);
    lines.push(`构建 ${module.scenes.flatMap((scene) => scene.connections).length} 条统一场景出口`);

    module.npcs.forEach((npc, index) => this.runOperation(module.id, `npc:${index}:${npc.id}`, () => {
      if (npc.runtime) this.host.registerRuntimeNpc(npc, npc.runtime);
      else this.host.registerNarrativeNpc(npc);
    }));
    lines.push(`注册 ${module.npcs.length} 个叙事 NPC，其中 ${module.npcs.filter((npc) => npc.runtime).length} 个带运行配置`);

    module.scenes.forEach((scene) => scene.clues.forEach((clue, index) => {
      this.runOperation(module.id, `clue:${scene.id}:${index}:${clue.id}`, () =>
        this.host.registerRichClue(scene.id, clue, runtime.richClueSanCosts?.[clue.id]));
    }));
    lines.push(`注册 ${module.scenes.flatMap((scene) => scene.clues).length} 条丰富线索`);

    (runtime.tomes ?? []).forEach((tome, index) => this.runOperation(module.id, `tome:${index}:${tome.name}`, () => this.host.registerTome(tome)));
    (runtime.itemPlacements ?? []).forEach((item, index) => this.runOperation(module.id, `placement:${index}:${item.name}`, () => this.host.registerItemPlacement(item)));
    module.items.forEach((item, index) => this.runOperation(module.id, `item:${index}:${item.id}`, () => this.host.registerRichItem(item)));
    (runtime.spells ?? []).forEach((spell, index) => this.runOperation(module.id, `spell:${index}:${spell.name}`, () => this.host.registerSpell(spell)));
    (runtime.hooks ?? []).forEach((hook, index) => this.runOperation(module.id, `hook:${index}:${hook.type}:${hook.condition}`, () => this.host.registerHook(hook)));
    const rewards = runtime.rewards;
    if (rewards) this.runOperation(module.id, "rewards", () => this.host.registerRewards(rewards));
    const kpNotes = runtime.kpNotes;
    if (kpNotes) this.runOperation(module.id, "kpNotes", () => this.host.registerKpNotes(kpNotes));
    const sceneBgm = runtime.sceneBgm;
    if (sceneBgm) this.runOperation(module.id, "sceneBgm", () => this.host.registerSceneBgm(sceneBgm));
    const sceneAliases = runtime.sceneAliases;
    if (sceneAliases) this.runOperation(module.id, "sceneAliases", () => this.host.registerSceneAliases(sceneAliases));
    const initialEffects = runtime.initialEffects;
    if (initialEffects) this.runOperation(module.id, "initialEffects", () => this.host.applyInitialEffects(initialEffects));
    const introNarration = runtime.introNarration;
    if (introNarration) this.runOperation(module.id, "introNarration", () => this.host.addIntroNarration(introNarration));

    // Only a completely successful plan becomes imported. A thrown host
    // operation leaves the operation ledger available for a real retry.
    this.imported.add(module.id);
    this.completedOperations.delete(module.id);

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
