import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { ModuleDataRuntimeLoader, type ModuleDataRuntimeHost } from "../module/module-data-runtime-loader";

function makeHost() {
  const scenes: Array<{ id: string; name: string; description: string; exits: Array<{ target: string; desc: string }> }> = [];
  const runtimeNpcs: string[] = [];
  const narrativeNpcs: string[] = [];
  const richClues: string[] = [];
  const legacyClues: string[] = [];
  const richItems: string[] = [];
  const itemPlacements: string[] = [];
  const spells: string[] = [];
  const hooks: string[] = [];
  const rewards: string[] = [];
  const messages: string[] = [];
  const host: ModuleDataRuntimeHost = {
    registerScene: (scene) => scenes.push(scene),
    registerRuntimeNpc: (_npc, runtime) => runtimeNpcs.push(runtime.sourceId),
    registerNarrativeNpc: (npc) => narrativeNpcs.push(npc.id),
    registerRichClue: (_sceneId, clue) => richClues.push(clue.id),
    registerLegacyClue: (binding) => legacyClues.push(binding.clueType),
    registerTome: () => {},
    registerItemPlacement: (item) => itemPlacements.push(item.name),
    registerRichItem: (item) => richItems.push(item.id),
    registerSpell: (spell) => spells.push(spell.name),
    registerHook: (hook) => hooks.push(hook.condition),
    registerRewards: (items) => rewards.push(...items.map((item) => item.id)),
    registerKpNotes: () => {},
    registerSceneBgm: () => {},
    registerSceneAliases: () => {},
    addIntroNarration: (text) => messages.push(text),
  };
  return { host, scenes, runtimeNpcs, narrativeNpcs, richClues, legacyClues, richItems, itemPlacements, spells, hooks, rewards, messages };
}

describe("ModuleDataRuntimeLoader：直接读取统一 ModuleData", () => {
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
    expect(BARN_OF_PREMIER.scenes.flatMap((scene) => scene.clues).find((clue) => clue.id === "clue_bar_mass_booking")?.matchTexts).toEqual(["包场", "登记", "免费饮品", "小费"]);
    expect(capture.legacyClues).toHaveLength(10);
    expect(capture.richItems).toHaveLength(10);
    expect(capture.itemPlacements).toHaveLength(10);
    expect(capture.spells).toHaveLength(4);
    expect(capture.hooks).toHaveLength(34);
    expect(capture.rewards).toHaveLength(9);
    expect(capture.messages).toHaveLength(1);
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

  it("结构判据：direct loader 不 import unified-module 或 mythos-module，不能偷偷走旧路径", () => {
    const imports = scanImports(readFileSync("src/module/module-data-runtime-loader.ts", "utf8"));
    expect(imports.some((entry) => importPointsTo(entry.path, "unified-module"))).toBe(false);
    expect(imports.some((entry) => importPointsTo(entry.path, "mythos-module"))).toBe(false);
  });
});
