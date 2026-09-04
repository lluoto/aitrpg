// 叙述不能用调查员还拿不到的信息。
//
// 起因：特里坎家的开场氛围原文是
//   「循声望去，只见**米尔·特里坎**正抱着篮球站在院里……」
// 调查员这时刚走到门口，还没见过任何人 —— **不可能知道这孩子叫什么**。
// 旁白替他们作弊了。
//
// 这类毛病肉眼很难发现：名字读起来很自然，而且模组作者自己当然知道那是谁。
// 所以做成机器判据：**场景的开场氛围里不许出现该场景 NPC 的名字**
// （自报家门是 NPC 自己的台词，不走这条路）。

import { describe, test, expect } from "bun:test";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { namesLeakedInOpening, mentionsName, nameParts } from "../diagnostics/narration";

const leaksIn = (scenes: unknown, npcs: unknown) =>
  namesLeakedInOpening(scenes as never, npcs as never);

describe("mentionsName — 认名字要看边界", () => {
  test("**正确**：真的点了名", () => {
    expect(mentionsName("只见米尔·特里坎抱着球。", "米尔·特里坎")).toBe(true);
    expect(mentionsName("只见米尔抱着球。", "米尔")).toBe(true);
    expect(mentionsName("米尔抱着球。", "米尔")).toBe(true);
  });

  test("**错误行为的红线**：片段被更长的已知名字盖住，不算点名", () => {
    // 实跑真的踩到了：那一局的调查员叫**米尔德丽德**·罗德里格斯，
    // 判据第一版直接 `includes("米尔")`，当场报了个假阳性。
    // 子串匹配认错人 —— 正是这轮反复在修的同一种病，出在判据自己身上。
    const others = ["米尔德丽德·罗德里格斯"];
    expect(mentionsName("米尔德丽德·罗德里格斯下了车。", "米尔", others)).toBe(false);
  });

  test("**干扰**：同一句里既有别人的长名字、也真的点了名 → 仍算点名", () => {
    const others = ["米尔德丽德·罗德里格斯"];
    expect(mentionsName("米尔德丽德下了车，米尔抱着球。", "米尔", others)).toBe(true);
  });

  test("**干扰**：不给已知名单时不瞎猜，按字面算", () => {
    // 边界靠猜（「两侧是不是汉字」）会把「只见米尔抱着球」也否掉 ——
    // 中文没有词边界，`见` 也是汉字。所以宁可按字面，由调用方提供名单。
    expect(mentionsName("米尔德丽德下了车。", "米尔")).toBe(true);
  });

  test("**干扰**：全名足够独特", () => {
    expect(mentionsName("米尔德丽德和米尔·特里坎都在。", "米尔·特里坎")).toBe(true);
  });

  test("**干扰**：太短的片段一律不认（单个字满大街都是）", () => {
    expect(mentionsName("他在院里。", "他")).toBe(false);
    expect(mentionsName("", "米尔")).toBe(false);
  });

  test("nameParts 剥括号补充，且丢掉太短的片段", () => {
    expect(nameParts("食尸鬼（可选）")).toEqual(["食尸鬼"]);
    expect(nameParts("米尔·特里坎")).toEqual(["米尔·特里坎", "米尔", "特里坎"]);
  });
});

describe("开场氛围不得提前点名", () => {
  test("**错误行为的红线**：模组里一处都不该有", () => {
    // 变异检验：把「一个小女孩」改回「米尔·特里坎」，这条立刻红。
    expect(namesLeakedInOpening(BARN_OF_PREMIER.scenes, BARN_OF_PREMIER.npcs)).toEqual([]);
  });

  test("判据本身能报出问题（拿构造数据验，别让上一条是个空断言）", () => {
    const leaked = leaksIn(
      [{ id: "s1", npcIds: ["n1"], openingAtmosphere: "只见米尔·特里坎正抱着篮球。" }],
      [{ id: "n1", name: "米尔·特里坎" }],
    );
    expect(leaked.length).toBe(1);
    expect(leaked[0]!.hit).toBe("米尔·特里坎");
  });

  test("认得出只用姓或只用名的写法", () => {
    for (const opening of ["只见米尔抱着篮球。", "院里站着特里坎家的孩子。"]) {
      expect(leaksIn(
        [{ id: "s1", npcIds: ["n1"], openingAtmosphere: opening }],
        [{ id: "n1", name: "米尔·特里坎" }],
      ).length).toBe(1);
    }
  });

  test("**干扰输入**：不点名的描述不该被报", () => {
    expect(leaksIn(
      [{ id: "s1", npcIds: ["n1"], openingAtmosphere: "一个小女孩正抱着篮球站在院里。" }],
      [{ id: "n1", name: "米尔·特里坎" }],
    )).toEqual([]);
  });

  test("**干扰输入**：调查员名字撞上 NPC 的名，不该算泄漏", () => {
    // 实跑那一局的调查员就叫米尔德丽德·罗德里格斯。
    expect(namesLeakedInOpening(
      [{ id: "s1", npcIds: ["n1"], openingAtmosphere: "米尔德丽德·罗德里格斯推开车门。" }],
      [{ id: "n1", name: "米尔·特里坎" }],
      ["米尔德丽德·罗德里格斯"],
    )).toEqual([]);
  });

  test("**干扰输入**：别的场景的 NPC 名字不算这个场景的泄漏", () => {
    // 提到一个不在场的人（写给他的便条）是合法叙述，那是线索不是穿帮
    expect(leaksIn(
      [{ id: "s1", npcIds: ["n1"], openingAtmosphere: "门口贴着一张写给艾德里安的便条。" }],
      [{ id: "n1", name: "米尔·特里坎" }, { id: "n2", name: "艾德里安·埃斯特鲁姆" }],
    )).toEqual([]);
  });

  test("**干扰输入**：没有开场氛围的场景不参与判定", () => {
    expect(leaksIn([{ id: "s1", npcIds: ["n1"] }], [{ id: "n1", name: "米尔·特里坎" }])).toEqual([]);
  });

  test("被替换掉的那句仍然把孩子写清楚了 —— 不是删掉了事", () => {
    // 修法不能是「把这句删了」。玩家得知道院里有个孩子、她跑回屋里了，
    // 否则后面 NPC 出场就成了凭空冒出来。
    const scene = BARN_OF_PREMIER.scenes.find((s) => s.id === "特里坎家")!;
    expect(scene.openingAtmosphere).toContain("小女孩");
    expect(scene.openingAtmosphere).toContain("篮球");
    expect(scene.openingAtmosphere).toContain("跑回屋");
  });
});
