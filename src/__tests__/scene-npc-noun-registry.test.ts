// 「角色名词」登记表判据——把"线索路径提到某个角色，但场景 npcIds
// 里没有对应实体"从只能靠实跑撞到（todo-41 那次真实撞坑）变成一条
// 确定性判据。
//
// bun test src/__tests__/scene-npc-noun-registry.test.ts

import { describe, it, expect } from "bun:test";
import {
  findSceneCharacterNounGaps,
  findModuleCharacterNounGaps,
} from "../investigation/scene-npc-noun-registry";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { Scene, ModuleNPC } from "../module/types";

function scene(id: string, clues: Scene["clues"], npcIds: string[]): Scene {
  return { id, name: id, description: "", clues, npcIds, connections: [] };
}
function clue(id: string, description: string, findMethodDesc = ""): Scene["clues"][number] {
  return {
    id, name: id, description,
    findMethods: findMethodDesc ? [{ type: "observation", description: findMethodDesc }] : [],
    revelation: "", unlocks: [], found: false, importance: "core",
  };
}
function npc(id: string, name: string, role: string, sceneId: string): ModuleNPC {
  return {
    id, name, role, sceneId, description: "",
    personality: { traits: [], speech: "", attitude: "" },
    knowledge: [], secrets: [],
  };
}

describe("findSceneCharacterNounGaps：正确/错误/能力边界", () => {
  it("**正确**：登记表里的名词出现在线索文本里，场景确实有对应 NPC（role 包含该词）→ 不报缺口", () => {
    const gaps = findSceneCharacterNounGaps(
      [scene("s1", [clue("c1", "问前台", "问前台")], ["n1"])],
      [npc("n1", "前台", "前台", "s1")],
      ["前台"],
    );
    expect(gaps).toEqual([]);
  });

  it("**错误行为红线**：登记表里的名词出现在线索文本里，场景 npcIds 是空的 → 必须报缺口", () => {
    const gaps = findSceneCharacterNounGaps(
      [scene("s1", [clue("c1", "问前台", "问前台")], [])],
      [],
      ["前台"],
    );
    expect(gaps).toEqual([{ sceneId: "s1", sceneName: "s1", noun: "前台", clueId: "c1" }]);
  });

  it("**错误行为红线**：场景有 NPC，但没有一个 role/name 包含登记的名词 → 仍然报缺口（不能「有 npcIds 就算数」）", () => {
    const gaps = findSceneCharacterNounGaps(
      [scene("s1", [clue("c1", "问前台", "问前台")], ["n1"])],
      [npc("n1", "路人甲", "路人", "s1")],
      ["前台"],
    );
    expect(gaps.length).toBe(1);
  });

  it("**能力边界（负面确认）**：一个未登记的角色名词不会被抓到——即便场景里真的缺这个角色的 NPC", () => {
    const gaps = findSceneCharacterNounGaps(
      [scene("s1", [clue("c1", "问店员在不在", "问店员")], [])],
      [],
      ["前台"], // 登记表里没有"店员"
    );
    expect(gaps).toEqual([]); // 不是漏检不算数，是这份判据本来就只认登记过的词
  });

  it("豁免登记：命中登记词但显式标了跨场景引用/例外，不报缺口", () => {
    const gaps = findSceneCharacterNounGaps(
      [scene("s1", [clue("c1", "提到前台", "提到前台")], [])],
      [],
      ["前台"],
      [{ sceneId: "s1", noun: "前台", reason: "测试用豁免" }],
    );
    expect(gaps).toEqual([]);
  });
});

describe("对 BARN_OF_PREMIER 实跑：weisen_bar/newsstand 当前 0 缺口", () => {
  it("**正确**：当前登记表（前台/报亭老板）扫全模组，缺口为空——A/B 两个提交确实把这两处补齐了", () => {
    const gaps = findModuleCharacterNounGaps(BARN_OF_PREMIER);
    expect(gaps).toEqual([]);
  });

  it("**变异检验**：把「前台」从 weisen_bar.npcIds 里拿掉，判据必须精确报出这个缺口", () => {
    const mutated = BARN_OF_PREMIER.scenes.map((s) =>
      s.id === "weisen_bar" ? { ...s, npcIds: s.npcIds.filter((id) => id !== "bar_receptionist") } : s,
    );
    const gaps = findSceneCharacterNounGaps(mutated, BARN_OF_PREMIER.npcs);
    const bar = gaps.filter((g) => g.sceneId === "weisen_bar");
    expect(bar.length).toBeGreaterThan(0);
    expect(bar.every((g) => g.noun === "前台")).toBe(true);
    // 变异不影响 newsstand——两个场景的修复彼此独立，不该互相牵连。
    expect(gaps.some((g) => g.sceneId === "newsstand")).toBe(false);
  });

  it("**能力边界（合成数据负面确认）**：一个真实存在于线索文本、但没登记进表的角色名词不会被抓到——直到手动把它加进登记表才现形，证明这份判据不是「扫描全模组自动找齐所有缺口」，只认登记过的词", () => {
    // 用合成数据而不是依赖 BARN_OF_PREMIER 某处永远保持"已知但未修"的
    // 状态——开发·约束层补角色实体域 N9 任务 D 把 hospital 的
    // "医护人员" 缺口修完并登记之后，真实数据里已经不再有这个可以
    // 拿来演示能力边界的现成反例，改用与本文件其它合成用例同一套
    // 写法自己搭一个。
    const scenes = [
      scene("s1", [clue("c1", "问问店小二这里最近的事", "问店小二")], []),
    ];
    const withoutRegistering = findSceneCharacterNounGaps(scenes, [], ["前台"]); // 默认登记表没有"店小二"
    expect(withoutRegistering).toEqual([]);
    const afterRegistering = findSceneCharacterNounGaps(scenes, [], ["前台", "店小二"]);
    expect(afterRegistering.some((g) => g.noun === "店小二")).toBe(true);
  });
});
