// 摄取管线 · 线索构建（todo-28）
//
// 范围已定：只产 name/description/revelation 三个字段。findMethods/
// unlocks/importance/hint/failback/setStateVar 一律不产——原文是散文，
// 没有结构标记可供确定性抽取，抽了就是猜。unlocks 尤其不碰：它是
// 卧室线索那个 bug 的根源（2c38d2c）。

import { describe, test, expect } from "bun:test";
import { buildClues } from "../ingest/build-clues";
import type { ItemInput, ItemKind } from "../ingest/classify-items";
import type { Scene } from "../module/types";

const scene = (id: string, name = "某场景"): Scene => ({
  id,
  name,
  description: "",
  clues: [],
  npcIds: [],
  connections: [],
});

const input = (key: string, name: string, text: string, sceneId = "scene_01"): ItemInput => ({
  key,
  sceneTitle: "某场景",
  sceneId,
  name,
  text,
});

const kinds = (pairs: Array<[string, ItemKind]>) => new Map<string, ItemKind>(pairs);
const ids = (pairs: Array<[string, string]>) => new Map<string, string>(pairs);

describe("挑条目", () => {
  test("只取 clue，item/trap/connection/npc_knowledge/event 都不要", () => {
    const scenes = [scene("scene_01")];
    const ins = [
      input("p1:L1", "床头柜", "可以看到一本日记本"),
      input("p1:L2", "防盗门的钥匙", "用来打开谷仓的门"),
      input("p1:L3", "捕兽夹", "造成 1D4+1 的伤害"),
      input("p1:L4", "侧面的防盗门", "可以通过钥匙打开门"),
    ];
    const r = buildClues(
      scenes,
      ins,
      kinds([["p1:L1", "clue"], ["p1:L2", "item"], ["p1:L3", "trap"], ["p1:L4", "connection"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"], ["p1:L3", "item_03"], ["p1:L4", "item_04"]]),
    );
    expect(r.scenes[0]?.clues.map((c) => c.name)).toEqual(["床头柜"]);
    expect(r.clueCount).toBe(1);
  });

  test("查不到分类的跳过并计入 warnings —— 不猜", () => {
    const r = buildClues([scene("scene_01")], [input("p1:L1", "床头柜", "x")], kinds([]), ids([["p1:L1", "item_01"]]));
    expect(r.clueCount).toBe(0);
    expect(r.warnings.join()).toContain("没有分类结果");
  });

  test("空分类表给零条线索 —— LLM 挂掉时如实显示 0", () => {
    const ins = [input("p1:L1", "床头柜", "x"), input("p1:L2", "枪柜", "y")];
    const r = buildClues([scene("scene_01")], ins, kinds([]), ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]));
    expect(r.clueCount).toBe(0);
  });
});

describe("字段口径——只产 name/description/revelation", () => {
  test("id 按 key 取自 assignItemIds 的结果", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p9:L13", "床头柜", "可以看到一本日记本")],
      kinds([["p9:L13", "clue"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.scenes[0]?.clues[0]?.id).toBe("item_07");
  });

  test("description 与 revelation 都取自 input.text——没有两份独立原文，不硬拆", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "可以看到一本日记本，上面记着一些奇怪的符号")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.scenes[0]?.clues[0]).toMatchObject({
      name: "床头柜",
      description: "可以看到一本日记本，上面记着一些奇怪的符号",
      revelation: "可以看到一本日记本，上面记着一些奇怪的符号",
    });
  });

  test("**错误行为红线**：findMethods/unlocks 不产——留空数组，不是不存在也不是猜一个", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "x")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    const clue = r.scenes[0]?.clues[0];
    expect(clue?.findMethods).toEqual([]);
    expect(clue?.unlocks).toEqual([]);
  });

  test("matchTexts 不产——留 undefined，不是空数组也不是猜一个别名（开发·别名迁移轮 C 组）", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "x")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    const clue = r.scenes[0]?.clues[0];
    expect(clue?.matchTexts).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("matchTexts"))).toBe(true);
  });

  test("found 恒为 false——这是运行时状态字段，不是生成字段", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "x")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.scenes[0]?.clues[0]?.found).toBe(false);
  });

  test("importance 是必填枚举没有「未知」选项，占位成 color 并在 warnings 里说明这不是真实评估", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "x")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.scenes[0]?.clues[0]?.importance).toBe("color");
    expect(r.warnings.join()).toContain("不代表真实评估过的重要度");
  });

  test("产出线索时，warnings 里必须说明哪些字段没产——不是静默留空", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "x")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    const w = r.warnings.join();
    expect(w).toContain("findMethods");
    expect(w).toContain("unlocks");
  });
});

describe("场景归属", () => {
  test("正常归属：线索挂到 input.sceneId 对应的场景下", () => {
    const scenes = [scene("scene_01", "卧室"), scene("scene_02", "维修间")];
    const r = buildClues(
      scenes,
      [input("p1:L1", "床头柜", "x", "scene_01"), input("p1:L2", "培养缸", "y", "scene_02")],
      kinds([["p1:L1", "clue"], ["p1:L2", "clue"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]),
    );
    expect(r.scenes.find((s) => s.id === "scene_01")?.clues.map((c) => c.name)).toEqual(["床头柜"]);
    expect(r.scenes.find((s) => s.id === "scene_02")?.clues.map((c) => c.name)).toEqual(["培养缸"]);
  });

  test("**错误行为红线**：sceneId 在传入的 scenes 里找不到时，不猜挂到哪，跳过并报 warning", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "x", "scene_99")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.clueCount).toBe(0);
    expect(r.scenes[0]?.clues).toEqual([]);
    expect(r.warnings.join()).toContain("找不到");
  });

  test("不修改传入的 scenes 数组——纯函数，返回新对象", () => {
    const original = scene("scene_01");
    buildClues(
      [original],
      [input("p1:L1", "床头柜", "x")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(original.clues).toEqual([]); // 原对象未被修改
  });

  test("场景本身没有线索时，.clues 是空数组不是 undefined", () => {
    const r = buildClues([scene("scene_01"), scene("scene_02")], [], kinds([]), ids([]));
    expect(r.scenes.find((s) => s.id === "scene_02")?.clues).toEqual([]);
  });
});

describe("sourceRef 可追溯", () => {
  test("每条线索都有对应的 provenance，sourceRef 就是条目的键", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p9:L13", "床头柜", "可以看到一本日记本")],
      kinds([["p9:L13", "clue"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.provenance).toHaveLength(1);
    expect(r.provenance[0]?.sourceRef).toBe("p9:L13");
    expect(r.provenance[0]?.path).toBe("scenes[scene_01].clues[item_07]");
  });

  test("多条线索各自有独立的 provenance 记录，不会共用或漏记", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "床头柜", "a"), input("p1:L2", "枪柜", "b")],
      kinds([["p1:L1", "clue"], ["p1:L2", "clue"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]),
    );
    expect(r.provenance.map((p) => p.sourceRef)).toEqual(["p1:L1", "p1:L2"]);
  });
});

describe("无名条目", () => {
  test("被判成线索但没名字 → 跳过并 warn", () => {
    const r = buildClues(
      [scene("scene_01")],
      [input("p1:L1", "", "一些描述")],
      kinds([["p1:L1", "clue"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.clueCount).toBe(0);
    expect(r.warnings.join()).toContain("没有名字");
  });
});

describe("场景内重名线索", () => {
  test("同一场景内线索名重复报一条 warning 并点出名字", () => {
    const r = buildClues(
      [scene("scene_01", "谷仓")],
      [input("p1:L1", "尸体", "a"), input("p1:L2", "尸体", "b")],
      kinds([["p1:L1", "clue"], ["p1:L2", "clue"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]),
    );
    const dup = r.warnings.filter((w) => w.includes("尸体"));
    expect(dup).toHaveLength(1);
    expect(dup[0]).toContain("谷仓");
  });

  test("不同场景内同名不算重名——各自场景内唯一", () => {
    const r = buildClues(
      [scene("scene_01", "A"), scene("scene_02", "B")],
      [input("p1:L1", "尸体", "a", "scene_01"), input("p1:L2", "尸体", "b", "scene_02")],
      kinds([["p1:L1", "clue"], ["p1:L2", "clue"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]),
    );
    expect(r.warnings.filter((w) => w.includes("尸体"))).toEqual([]);
  });
});

describe("调用契约", () => {
  test("条目的 key 不在 ids 里直接抛 —— 那是编程错误", () => {
    expect(() =>
      buildClues([scene("scene_01")], [input("p1:L1", "床头柜", "x")], kinds([["p1:L1", "clue"]]), ids([])),
    ).toThrow();
  });
});
