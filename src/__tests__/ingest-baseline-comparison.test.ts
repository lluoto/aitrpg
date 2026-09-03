// 摄取管线 · 对基准比对（开发·无基准模式 任务①）
//
// 从 scripts/ingest/run.ts 抽出的纯函数——覆盖率/精确率/id 继承/
// calibrate diff 全部靠给定的 BaselineData 计算，不认得任何具体模组。
// 用小型构造数据验证每一块计算，不需要真实的谷仓数据集。

import { describe, test, expect } from "bun:test";
import { computeBaselineComparison, type BaselineData } from "../ingest/baseline-comparison";
import type { ModuleData, Scene, ModuleItem } from "../module/types";

const scene = (id: string, name: string, clues: Scene["clues"] = []): Scene => ({
  id,
  name,
  description: "",
  clues,
  npcIds: [],
  connections: [],
});

const item = (id: string, name: string, sceneId: string, type: ModuleItem["type"] = "loot"): ModuleItem => ({
  id,
  name,
  sceneId,
  description: "",
  type,
});

const baselineModule: ModuleData = {
  id: "test_module",
  title: "测试模组",
  version: "1.0",
  ruleset: "cosmic-horror",
  era: "1921",
  summary: "",
  scenes: [
    scene("bedroom", "卧室", [
      { id: "clue_diary", name: "日记本", description: "", findMethods: [], revelation: "", unlocks: [], found: false, importance: "core" },
    ]),
    scene("hall", "大厅（备注）"),
  ],
  npcs: [],
  meta: { playerCount: "", expectedDuration: "", triggerWarnings: [] },
  endings: [],
  items: [item("key1", "钥匙", "bedroom", "key")],
};

const baseline: BaselineData = {
  module: baselineModule,
  scoringKey: {
    "p1:L1": [{ kind: "clue", id: "clue_diary" }],
    "p1:L2": [{ kind: "item", id: "key1" }],
  },
};

describe("evaluateKeyLhs（评分键左手边）", () => {
  test("抽出的键与评分键集合完全一致时报「完全一致」", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [scene("scene_01", "卧室")],
      rawItems: [item("item_01", "钥匙", "scene_01", "key")],
      extractedKeys: ["p1:L1", "p1:L2"],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.keyLhs.keyMissing).toEqual([]);
    expect(r.keyLhs.keyStale).toEqual([]);
  });

  test("抽出来了但键里没有的会被记进 keyMissing", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [],
      rawItems: [],
      extractedKeys: ["p1:L1", "p9:L9"],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.keyLhs.keyMissing).toEqual(["p9:L9"]);
    expect(r.keyLhs.keyStale).toEqual(["p1:L2"]);
  });

  test("sourceKey 重复时给出提示", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [],
      rawItems: [],
      extractedKeys: ["p1:L1", "p1:L1"],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.keyLhs.duplicateNote).toContain("sourceKey 有重复");
  });
});

describe("id 继承（复用 inherit-ids.ts，这里只验证接线对）", () => {
  test("按 name 配上基准 id，场景/物品/线索三层都生效", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [scene("scene_01", "卧室", [{ id: "item_01", name: "日记本", description: "", findMethods: [], revelation: "", unlocks: [], found: false, importance: "core" }])],
      rawItems: [item("item_02", "钥匙", "scene_01", "key")],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 1,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.scenes[0]?.id).toBe("bedroom");
    expect(r.items[0]?.id).toBe("key1");
    expect(r.items[0]?.sceneId).toBe("bedroom"); // 场景 id 映射要连带改写 item.sceneId
    expect(r.scenes[0]?.clues[0]?.id).toBe("clue_diary");
  });

  test("配不上基准 name 的保留内部 id 并报 warning", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [scene("scene_01", "阁楼")], // 基准没有"阁楼"
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.scenes[0]?.id).toBe("scene_01");
    expect(r.sceneIdInherit.warnings.some((w) => w.includes("阁楼"))).toBe(true);
  });

  test("基准场景带括号注解（大厅（备注））不影响按 name 配对（stripDisplayAnnotation 已在 inherit-ids.ts 里处理）", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [scene("scene_01", "大厅")],
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.scenes[0]?.id).toBe("hall");
  });
});

describe("场景覆盖率", () => {
  test("严格覆盖 + 名字变体（括号注解）分开统计", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [scene("scene_01", "卧室"), scene("scene_02", "大厅")], // 生成侧没带注解
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.sceneCoverage.hit).toEqual(["卧室"]);
    expect(r.sceneCoverage.variantPairs).toEqual(["大厅（备注） ← 大厅"]);
    expect(r.sceneCoverage.trueMissing).toEqual([]);
  });

  test("真误报：生成了基准没有、也不是任何变体的场景", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [scene("scene_01", "地下室")],
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.sceneCoverage.trueExtraScenes).toEqual(["地下室"]);
  });
});

describe("物品覆盖率", () => {
  test("按 name 覆盖，误报与漏报各自列出", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [],
      rawItems: [item("item_01", "手电筒", "scene_01", "loot")], // 基准没有"手电筒"，也没生成"钥匙"
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.itemCoverage.itemHit).toBe(0);
    expect(r.itemCoverage.extraItemNames).toEqual(["手电筒"]);
    expect(r.itemCoverage.missingBaseItemNames).toEqual(["钥匙"]);
  });
});

describe("线索覆盖率（拿评分键坐标算）", () => {
  test("clueProvenance 的 sourceRef 命中评分键坐标才算覆盖", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [],
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [{ path: "x", source: "", result: "", reason: "", by: "rule", sourceRef: "p1:L1" }],
      clueCount: 1,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.clueCoverage.clueHit).toBe(1);
    expect(r.clueCoverage.cluePrecisionHits).toBe(1);
    expect(r.clueCoverage.missedClueIds).toEqual([]);
  });

  test("sourceRef 指向一个评分键里标记为 item 而非 clue 的坐标——不算线索覆盖", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [],
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [{ path: "x", source: "", result: "", reason: "", by: "rule", sourceRef: "p1:L2" }],
      clueCount: 1,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.clueCoverage.cluePrecisionHits).toBe(0);
    expect(r.clueCoverage.missedClueIds).toEqual(["clue_diary"]); // 唯一一条评分键坐标里的线索没被覆盖
  });
});

describe("条目分类准确率", () => {
  test("预测与期望一致记入 correct，陷阱按基准 type 而不是评分键的 item kind 判定", () => {
    const trapBaseline: BaselineData = {
      module: {
        ...baselineModule,
        items: [item("trap1", "陷阱", "bedroom", "trap")],
      },
      scoringKey: { "p1:L1": [{ kind: "item", id: "trap1" }] },
    };
    const r = computeBaselineComparison(trapBaseline, {
      rawScenes: [],
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [{ key: "p1:L1", sceneTitle: "", sceneId: "", name: "陷阱", text: "" }],
      itemKinds: new Map([["p1:L1", "trap"]]),
    });
    expect(r.itemClassification.correct).toBe(1);
    expect(r.itemClassification.total).toBe(1);
  });

  test("评分键说 none（不在评分键里）的条目不计分", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: [],
      rawItems: [],
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [{ key: "p9:L9", sceneTitle: "", sceneId: "", name: "无关条目", text: "" }],
      itemKinds: new Map([["p9:L9", "event"]]),
    });
    expect(r.itemClassification.notInKey).toEqual(["p9:L9"]);
    expect(r.itemClassification.total).toBe(0);
  });
});

describe("calibrate diff", () => {
  test("生成内容与基准完全一致时 diff 为空", () => {
    const r = computeBaselineComparison(baseline, {
      rawScenes: baselineModule.scenes.map((s) => ({ ...s, id: `internal_${s.id}` })),
      rawItems: baselineModule.items.map((i) => ({ ...i, id: `internal_${i.id}` })),
      extractedKeys: [],
      clueProvenance: [],
      clueCount: 0,
      itemInputs: [],
      itemKinds: new Map(),
    });
    expect(r.diffs).toEqual([]);
  });
});
