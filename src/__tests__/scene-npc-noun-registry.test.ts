// 「角色名词」登记表判据——把"线索路径提到某个角色，但场景 npcIds
// 里没有对应实体"从只能靠实跑撞到（todo-41 那次真实撞坑）变成一条
// 确定性判据。
//
// bun test src/__tests__/scene-npc-noun-registry.test.ts

import { describe, it, expect } from "bun:test";
import {
  findSceneCharacterNounGaps,
  findModuleCharacterNounGaps,
  CHARACTER_NOUN_REGISTRY,
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

  it("**能力边界（真实数据负面确认）**：医院场景「医护人员」缺口真实存在（本轮未修，另立 todo），但登记表没收这个词，判据不会报——证明这份判据不是「扫描全模组自动找齐所有缺口」，只认登记过的词", () => {
    const gaps = findModuleCharacterNounGaps(BARN_OF_PREMIER); // 用默认登记表（不含"医护人员"）
    expect(gaps.some((g) => g.sceneId === "hospital")).toBe(false);
    // 但只要临时把"医护人员"加进登记表去查，这个缺口立刻现形——
    // 证明"没登记"不等于"扫描器认为医院没问题"，只是这份判据的能力
    // 边界如实体现在这里，不是漏检。
    const withMedStaff = findModuleCharacterNounGaps(BARN_OF_PREMIER, [...CHARACTER_NOUN_REGISTRY, "医护人员"]);
    expect(withMedStaff.some((g) => g.sceneId === "hospital" && g.noun === "医护人员")).toBe(true);
  });
});
