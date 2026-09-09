import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { ModuleDataRuntimeLoader, type ModuleDataRuntimeHost } from "../module/module-data-runtime-loader";
import type { Clue, ModuleItem } from "../module/types";
import { getModule } from "../rules/custom-modules";

function makeHost() {
  const scenes: Array<{ id: string; name: string; description: string; exits: Array<{ target: string; desc: string }> }> = [];
  const runtimeNpcs: string[] = [];
  const narrativeNpcs: string[] = [];
  const richClues: Array<{ clue: Clue; sceneId: string; sanCost?: string }> = [];
  const richItems: ModuleItem[] = [];
  const itemPlacements: string[] = [];
  const spells: string[] = [];
  const hooks: string[] = [];
  const rewards: string[] = [];
  const messages: string[] = [];
  const bgm: Record<string, string> = {};
  const aliases: Record<string, string[]> = {};
  const kpNotes: Record<string, string> = {};
  const initialEffects: unknown[] = [];
  const host: ModuleDataRuntimeHost = {
    registerScene: (scene) => scenes.push(scene),
    registerRuntimeNpc: (_npc, runtime) => runtimeNpcs.push(runtime.sourceId),
    registerNarrativeNpc: (npc) => narrativeNpcs.push(npc.id),
    registerRichClue: (sceneId, clue, sanCost) => richClues.push({ clue: structuredClone(clue), sceneId, sanCost }),
    registerTome: () => {},
    registerItemPlacement: (item) => itemPlacements.push(item.name),
    registerRichItem: (item) => richItems.push(structuredClone(item)),
    registerSpell: (spell) => spells.push(spell.name),
    registerHook: (hook) => hooks.push(hook.condition),
    registerRewards: (items) => rewards.push(...items.map((item) => item.id)),
    registerKpNotes: (items) => Object.assign(kpNotes, items),
    registerSceneBgm: (items) => Object.assign(bgm, items),
    registerSceneAliases: (items) => Object.assign(aliases, items),
    applyInitialEffects: (items) => initialEffects.push(...items),
    addIntroNarration: (text) => messages.push(text),
  };
  return { host, scenes, runtimeNpcs, narrativeNpcs, richClues, richItems, itemPlacements, spells, hooks, rewards, messages, bgm, aliases, kpNotes, initialEffects };
}

describe("ModuleDataRuntimeLoader：直接读取统一 ModuleData", () => {
  it("custom module registry 的谷仓条目返回 ModuleData，不再返回 MythosModule 适配结果", () => {
    const entry = getModule("premiers_barn");
    expect(entry).toBeDefined();
    expect(entry?.module).toHaveProperty("scenes");
    expect(entry?.module).toHaveProperty("runtime");
    expect(entry?.module).not.toHaveProperty("sceneDescriptions");
    expect(entry?.module).toBe(BARN_OF_PREMIER);
  });

  it("不经 Mythos 适配，注册场景/ModuleData 连接/丰富线索/运行配置", () => {
    const capture = makeHost();
    const result = new ModuleDataRuntimeLoader(capture.host).import(BARN_OF_PREMIER);
    expect(result.entryScene).toBe("特里坎家");
    expect(capture.scenes).toHaveLength(21);
    expect(capture.scenes.flatMap((scene) => scene.exits)).toHaveLength(46);
    expect(capture.scenes.find((scene) => scene.id === "报亭")?.exits).toContainEqual({ target: "霍姆斯医院", desc: "根据报道前往霍姆斯医院" });
    expect(capture.scenes.find((scene) => scene.id === "与艾德里安的会面")?.description).toContain("喃喃出自己妻子与女儿的名字");
    expect(capture.scenes.find((scene) => scene.id === "证物室")?.description).toContain("防盗门钥匙、农场照片、钱包、驾照、手枪与电棒");
    expect(capture.scenes.find((scene) => scene.id === "旅店")?.description).not.toContain('。"\n\n"');
    expect(capture.scenes.find((scene) => scene.id === "维修间")?.description).toContain("青色按钮");
    expect(capture.runtimeNpcs).toHaveLength(11);
    expect(capture.narrativeNpcs.sort()).toEqual(["bar_receptionist", "hospital_staff", "newsstand_owner"]);
    expect(capture.richClues).toHaveLength(32);
    expect(BARN_OF_PREMIER.runtime).not.toHaveProperty("clueBindings");
    const brainJars = capture.richClues.find((entry) => entry.clue.id === "clue_final_brain_jars");
    expect(brainJars?.sceneId).toBe("维修间");
    expect(brainJars?.sanCost).toBe("1/1d6");
    const massBooking = capture.richClues.find((entry) => entry.clue.id === "clue_bar_mass_booking")?.clue;
    expect(massBooking?.matchTexts).toEqual(["包场", "登记", "免费饮品", "小费"]);
    expect(massBooking?.findMethods[0]?.difficulty).toBe("regular");
    expect(massBooking?.unlocks).toEqual(["clue_bar_guest_identity"]);
    expect(massBooking?.revelation).toContain("贵客包下了酒吧");
    expect(capture.richItems).toHaveLength(10);
    expect(capture.richItems.filter((item) => item.type === "trap")).toHaveLength(4);
    expect(capture.richItems.filter((item) => item.trap)).toHaveLength(3);
    expect(capture.richItems.find((item) => item.id === "trap_bear")?.trap?.damage).toBe("1D4+1");
    expect(capture.itemPlacements).toHaveLength(10);
    expect(capture.spells).toHaveLength(4);
    expect(capture.hooks).toHaveLength(34);
    expect(capture.rewards).toHaveLength(9);
    expect(capture.messages).toHaveLength(1);
    expect(Object.keys(capture.bgm)).toHaveLength(19);
    expect(capture.aliases["维修间"]).toEqual(["维修室"]);
    expect(Object.keys(capture.kpNotes)).toHaveLength(8);
    expect(result.narrative.endings).toHaveLength(5);
    expect(result.narrative.epilogues).toHaveLength(4);
    expect(result.narrative.prologue?.lines.length).toBeGreaterThan(0);
    expect(result.narrative.partySetup?.hooks).toHaveLength(2);
  });

  it("重复导入不重复注册或污染 host", () => {
    const capture = makeHost();
    const loader = new ModuleDataRuntimeLoader(capture.host);
    loader.import(BARN_OF_PREMIER);
    const again = loader.import(BARN_OF_PREMIER);
    expect(again.lines).toEqual(["模组「普瑞米尔的谷仓」已导入。"]);
    expect(capture.scenes).toHaveLength(21);
    expect(capture.richClues).toHaveLength(32);
    expect(capture.runtimeNpcs).toHaveLength(11);
  });

  it("host 中途失败不会标记 imported；第二次真正重试且不重复 hooks/messages/items", () => {
    const capture = makeHost();
    const registerHook = capture.host.registerHook;
    let failOnce = true;
    capture.host.registerHook = (hook) => {
      if (failOnce && hook.condition === "证物室") {
        failOnce = false;
        throw new Error("intentional mid-load failure");
      }
      registerHook(hook);
    };
    const loader = new ModuleDataRuntimeLoader(capture.host);
    expect(() => loader.import(BARN_OF_PREMIER)).toThrow("intentional mid-load failure");
    const retried = loader.import(BARN_OF_PREMIER);
    expect(retried.lines[0]).toBe("【统一模组：普瑞米尔的谷仓】");
    expect(capture.hooks).toHaveLength(34);
    expect(capture.messages).toHaveLength(1);
    expect(capture.itemPlacements).toHaveLength(10);
    expect(capture.richItems).toHaveLength(10);
    expect(capture.scenes).toHaveLength(21);
    expect(capture.richClues).toHaveLength(32);
  });

  it("结构预验证失败发生在任何 host 写入之前", () => {
    const capture = makeHost();
    const broken = structuredClone(BARN_OF_PREMIER);
    const firstScene = broken.scenes[0];
    if (!firstScene) throw new Error("fixture lacks first scene");
    firstScene.connections.push({ targetSceneId: "不存在场景", condition: "错误边" });
    expect(() => new ModuleDataRuntimeLoader(capture.host).import(broken)).toThrow("Scene.connection 悬空");
    expect(capture.scenes).toEqual([]);
    expect(capture.runtimeNpcs).toEqual([]);
    expect(capture.richClues).toEqual([]);
    expect(capture.hooks).toEqual([]);
    expect(capture.messages).toEqual([]);
  });

  it("覆盖可选 initialEffects 字段，不因真实谷仓当前为空而形成盲点", () => {
    const capture = makeHost();
    const module = structuredClone(BARN_OF_PREMIER);
    module.runtime!.initialEffects = [{ target: "test", field: "flag", value: { nested: true } }];
    new ModuleDataRuntimeLoader(capture.host).import(module);
    expect(capture.initialEffects).toEqual([{ target: "test", field: "flag", value: { nested: true } }]);
  });

  it("结构判据：direct loader 不 import MythosModule，不能偷偷走旧路径", () => {
    const imports = scanImports(readFileSync("src/module/module-data-runtime-loader.ts", "utf8"));
    expect(imports.some((entry) => importPointsTo(entry.path, "mythos-module"))).toBe(false);
  });
});
