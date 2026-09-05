// 两份谷仓模组表示的跨表示一致性判据——开发·陈旧记录纠正+收敛前置
// N10 任务 B1，为 todo-19/20 的收敛做前置。
//
// bun test src/__tests__/representation-consistency.test.ts

import { describe, it, expect } from "bun:test";
import {
  findNpcSceneInconsistencies,
  findNumericFactInconsistencies,
  findEndingIdInconsistencies,
  findSceneSetInconsistencies,
  findRepresentationInconsistencies,
  findBarnRepresentationInconsistencies,
  KNOWN_INCONSISTENCIES,
  type NumericFactCheck,
} from "../module/representation-consistency";
import type { ModuleData } from "../module/types";
import type { MythosModule } from "../rules/mythos-module";

// ── 合成夹具：最小化的 ModuleData/MythosModule 子集，只填判据要读的字段 ──

function moduleData(scenes: ModuleData["scenes"], npcs: ModuleData["npcs"]): Pick<ModuleData, "scenes" | "npcs"> {
  return { scenes, npcs };
}
function mythosModule(
  npcs: NonNullable<MythosModule["npcs"]>,
  extra: Partial<Pick<MythosModule, "endings" | "sceneDescriptions" | "exits">> = {},
): Pick<MythosModule, "npcs" | "endings" | "sceneDescriptions" | "exits"> {
  return { npcs, ...extra };
}
function aNpc(id: string, name: string, sceneId: string): ModuleData["npcs"][number] {
  return {
    id, name, role: "路人", description: "", sceneId,
    personality: { traits: [], speech: "", attitude: "" }, knowledge: [], secrets: [],
  };
}
function bNpc(name: string, sceneId: string, background?: string): NonNullable<MythosModule["npcs"]>[number] {
  return {
    id: name, name, type: "npc", hp: 1, maxHp: 1, ac: 10, faction: "人类", sceneId,
    ...(background ? { personality: { background } } : {}),
  } as NonNullable<MythosModule["npcs"]>[number];
}
function aScene(id: string, name: string): ModuleData["scenes"][number] {
  return { id, name, description: "", clues: [], npcIds: [], connections: [] };
}

describe("findNpcSceneInconsistencies：正确/错误/能力边界", () => {
  it("**正确**：同名 NPC 在两侧的场景（去括号后）一致 → 不报", () => {
    const a = moduleData([aScene("s1", "甲地（备注）")], [aNpc("n1", "张三", "s1")]);
    const b = mythosModule([bNpc("张三", "甲地")]);
    expect(findNpcSceneInconsistencies(a, b)).toEqual([]);
  });

  it("**错误行为红线**：同名 NPC 在两侧场景不一致 → 报出双方各自的值", () => {
    const a = moduleData([aScene("s1", "甲地")], [aNpc("n1", "张三", "s1")]);
    const b = mythosModule([bNpc("张三", "乙地")]);
    const result = findNpcSceneInconsistencies(a, b);
    expect(result).toEqual([
      { category: "npc_scene", key: "张三", detail: "ModuleData: 甲地（sceneId=s1） vs MythosModule: 乙地" },
    ]);
  });

  it("**能力边界**：只在一侧出现的 NPC 不算站位矛盾（这是另一类缺口）", () => {
    const a = moduleData([aScene("s1", "甲地")], [aNpc("n1", "张三", "s1")]);
    const b = mythosModule([]); // B 完全没有张三
    expect(findNpcSceneInconsistencies(a, b)).toEqual([]);
  });

  it("NPC 名字带括号后缀（如 Mi-Go 的情形）也要能匹配上——不因为括号漏判", () => {
    const a = moduleData([aScene("s1", "甲地")], [aNpc("n1", "Mi-Go（真菌）", "s1")]);
    const b = mythosModule([bNpc("Mi-Go", "乙地")]);
    expect(findNpcSceneInconsistencies(a, b)).toEqual([
      { category: "npc_scene", key: "Mi-Go（真菌）", detail: "ModuleData: 甲地（sceneId=s1） vs MythosModule: 乙地" },
    ]);
  });
});

describe("findNumericFactInconsistencies：正确/错误/能力边界", () => {
  const check: NumericFactCheck = {
    key: "测试数值",
    extractA: (mod) => { const m = mod.npcs[0]?.description.match(/(\d+)/); return m ? Number(m[1]) : null; },
    extractB: (mod) => { const m = (mod.npcs ?? [])[0]?.personality?.background?.match(/(\d+)/); return m ? Number(m[1]) : null; },
  };

  it("**正确**：双方数值一致 → 不报", () => {
    const a = moduleData([], [{ ...aNpc("n1", "甲", "s1"), description: "共10人" }]);
    const b = mythosModule([bNpc("乙", "s1", "共10人")]);
    expect(findNumericFactInconsistencies(a, b, [check])).toEqual([]);
  });

  it("**错误行为红线**：双方数值不一致 → 报出双方各自的数字", () => {
    const a = moduleData([], [{ ...aNpc("n1", "甲", "s1"), description: "共10人" }]);
    const b = mythosModule([bNpc("乙", "s1", "共11人")]);
    expect(findNumericFactInconsistencies(a, b, [check])).toEqual([
      { category: "numeric_fact", key: "测试数值", detail: "ModuleData: 10 vs MythosModule: 11" },
    ]);
  });

  it("**能力边界**：任一侧抽不出数字就不算数，不能拿「抽不到」当「一致」", () => {
    const a = moduleData([], [{ ...aNpc("n1", "甲", "s1"), description: "没有数字" }]);
    const b = mythosModule([bNpc("乙", "s1", "共10人")]);
    expect(findNumericFactInconsistencies(a, b, [check])).toEqual([]);
  });
});

describe("findEndingIdInconsistencies：正确/错误", () => {
  it("**正确**：id 集合一致 → 不报", () => {
    expect(findEndingIdInconsistencies([{ id: "a" }, { id: "b" }], mythosModule([], { endings: [{ id: "a", name: "", description: "", conditionText: "" }, { id: "b", name: "", description: "", conditionText: "" }] }))).toEqual([]);
  });

  it("**错误行为红线**：一侧多一个/少一个都要精确报出是哪个 id", () => {
    const result = findEndingIdInconsistencies(
      [{ id: "a" }, { id: "b" }],
      mythosModule([], { endings: [{ id: "a", name: "", description: "", conditionText: "" }, { id: "c", name: "", description: "", conditionText: "" }] }),
    );
    expect(result).toEqual([
      { category: "ending_id", key: "b", detail: "END_NARRATIONS 有，MythosModule.endings 没有" },
      { category: "ending_id", key: "c", detail: "MythosModule.endings 有，END_NARRATIONS 没有" },
    ]);
  });
});

describe("findSceneSetInconsistencies：正确/错误/能力边界", () => {
  it("**正确**：场景集合一致（B 侧同时出现在 sceneDescriptions 与 exits 也不重复报）→ 不报", () => {
    const a = moduleData([aScene("s1", "甲地")], []);
    const b = mythosModule([], { sceneDescriptions: { "甲地": "..." }, exits: { "甲地": [] } });
    expect(findSceneSetInconsistencies(a, b)).toEqual([]);
  });

  it("**错误行为红线**：B 有 A 没有的场景节点会被报出", () => {
    const a = moduleData([aScene("s1", "甲地")], []);
    const b = mythosModule([], { sceneDescriptions: { "甲地": "...", "乙地": "..." } });
    expect(findSceneSetInconsistencies(a, b)).toEqual([
      { category: "scene_set", key: "乙地", detail: "MythosModule 场景图节点，ModuleData.scenes 没有对应场景" },
    ]);
  });

  it("**能力边界**：只出现在 exits 目标里（不是键）的节点同样会被算进 B 侧集合", () => {
    const a = moduleData([aScene("s1", "甲地")], []);
    const b = mythosModule([], { sceneDescriptions: { "甲地": "..." }, exits: { "甲地": [{ target: "丙地" }] } });
    expect(findSceneSetInconsistencies(a, b)).toEqual([
      { category: "scene_set", key: "丙地", detail: "MythosModule 场景图节点，ModuleData.scenes 没有对应场景" },
    ]);
  });
});

describe("变异检验：把某条已登记的不一致修好，判据应变绿；制造一条新的不一致，判据必须变红", () => {
  it("**修好**：合成一份「B 侧场景已经改成跟 A 一致」的夹具，站位不一致条目消失", () => {
    const a = moduleData([aScene("s1", "甲地")], [aNpc("n1", "张三", "s1")]);
    const brokenB = mythosModule([bNpc("张三", "乙地")]);
    const fixedB = mythosModule([bNpc("张三", "甲地")]); // 修好：改成跟 A 一致

    expect(findNpcSceneInconsistencies(a, brokenB).length).toBeGreaterThan(0);
    expect(findNpcSceneInconsistencies(a, fixedB)).toEqual([]); // 修好后判据变绿
  });

  it("**制造新的不一致**：原本一致的一对 NPC，改动 B 侧场景之后，判据必须精确报出这条新的不一致", () => {
    const a = moduleData([aScene("s1", "甲地")], [aNpc("n1", "张三", "s1")]);
    const consistentB = mythosModule([bNpc("张三", "甲地")]);
    expect(findNpcSceneInconsistencies(a, consistentB)).toEqual([]);

    const drifted = mythosModule([bNpc("张三", "新地方")]); // 制造一条新的不一致
    expect(findNpcSceneInconsistencies(a, drifted)).toEqual([
      { category: "npc_scene", key: "张三", detail: "ModuleData: 甲地（sceneId=s1） vs MythosModule: 新地方" },
    ]);
  });
});

describe("对真实的谷仓两份表示实跑：当前红条目与登记表精确相等（任务④/B1 的验收标准）", () => {
  it("**已知现状**：findBarnRepresentationInconsistencies() 与 KNOWN_INCONSISTENCIES 精确相等——如实报告初始红数，不为了好看调整", () => {
    const actual = findBarnRepresentationInconsistencies();
    const actualKeys = new Set(actual.map((f) => `${f.category}:${f.key}`));
    const knownKeys = new Set(KNOWN_INCONSISTENCIES.map((f) => `${f.category}:${f.key}`));
    expect(actualKeys).toEqual(knownKeys);
    // 数字本身也钉住，防止「集合碰巧对上但条数其实不一样」（理论上不可能，
    // 但显式断言一次不多余）。
    expect(actual.length).toBe(KNOWN_INCONSISTENCIES.length);
    expect(actual.length).toBeGreaterThanOrEqual(1); // 步骤 3 逐条修正中，当前值：1
  });

  it("**目标行为错误的对照**：登记表外新出现的不一致必须让这条判据变红——构造一份多一条的登记表，equality 断言必须失败", () => {
    const actual = findBarnRepresentationInconsistencies();
    const inflatedKnown = [...KNOWN_INCONSISTENCIES, { category: "npc_scene" as const, key: "从未存在的角色", reason: "测试用" }];
    const actualKeys = new Set(actual.map((f) => `${f.category}:${f.key}`));
    const inflatedKeys = new Set(inflatedKnown.map((f) => `${f.category}:${f.key}`));
    expect(actualKeys).not.toEqual(inflatedKeys);
  });

  it("**正确**：真实调用点 findRepresentationInconsistencies 与便捷入口 findBarnRepresentationInconsistencies 结果一致", () => {
    const { BARN_OF_PREMIER, END_NARRATIONS } = require("../module/barn-of-premier");
    const { MODULE_PREMIERS_BARN } = require("../rules/custom-modules/premiers_barn");
    expect(findRepresentationInconsistencies(BARN_OF_PREMIER, MODULE_PREMIERS_BARN, END_NARRATIONS)).toEqual(
      findBarnRepresentationInconsistencies(),
    );
  });
});
