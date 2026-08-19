// 摄取管线 · ModuleItem 构建
//
// 本轮只取 item 与 trap 两类。type 由规则定（名字里有没有「钥匙」是死板形态），
// 陷阱机制接已经校准过的 extractTrapMechanics ——
// 能用规则抽的不交给 LLM，这是仓库既定的分工。

import { describe, test, expect } from "bun:test";
import { buildItems } from "../ingest/build-items";
import type { ItemInput, ItemKind } from "../ingest/classify-items";

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
  test("只取 item 与 trap", () => {
    const ins = [
      input("p1:L1", "防盗门的钥匙", "用来打开谷仓的门"),
      input("p1:L2", "捕兽夹", "造成 1D4+1 的伤害"),
      input("p1:L3", "床头柜", "可以看到一本日记本"),
      input("p1:L4", "侧面的防盗门", "可以通过钥匙打开门"),
    ];
    const r = buildItems(
      ins,
      kinds([["p1:L1", "item"], ["p1:L2", "trap"], ["p1:L3", "clue"], ["p1:L4", "connection"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"], ["p1:L3", "item_03"], ["p1:L4", "item_04"]]),
    );
    expect(r.items.map((i) => i.name)).toEqual(["防盗门的钥匙", "捕兽夹"]);
  });

  test("查不到分类的跳过并计入 warnings —— 不猜", () => {
    const r = buildItems([input("p1:L1", "钥匙", "x")], kinds([]), ids([["p1:L1", "item_01"]]));
    expect(r.items).toEqual([]);
    expect(r.warnings.join()).toContain("没有分类结果");
  });

  test("空分类表给零个物品 —— LLM 挂掉时如实显示 0，不把所有条目当物品", () => {
    const ins = [input("p1:L1", "钥匙", "x"), input("p1:L2", "照片", "y")];
    const r = buildItems(ins, kinds([]), ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]));
    expect(r.items).toEqual([]);
  });
});

describe("字段口径", () => {
  test("id 按 key 取自 assignItemIds 的结果", () => {
    const r = buildItems(
      [input("p9:L13", "捕兽夹", "造成 1D4+1 的伤害")],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.items[0]?.id).toBe("item_07");
  });

  test("name 与 description 原样，sceneId 来自 input", () => {
    const r = buildItems(
      [input("p1:L1", "农场的照片", "可以对照着找到农场", "scene_09")],
      kinds([["p1:L1", "item"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items[0]).toMatchObject({
      name: "农场的照片",
      description: "可以对照着找到农场",
      sceneId: "scene_09",
    });
  });

  test("可选字段一个都不写进对象", () => {
    const r = buildItems(
      [input("p1:L1", "农场的照片", "x")],
      kinds([["p1:L1", "item"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(Object.keys(r.items[0] ?? {}).sort()).toEqual(["description", "id", "name", "sceneId", "type"]);
  });
});

describe("type 由规则定", () => {
  const t = (name: string) =>
    buildItems([input("p1:L1", name, "x")], kinds([["p1:L1", "item"]]), ids([["p1:L1", "item_01"]]))
      .items[0]?.type;

  test("名字含「钥匙」→ key", () => {
    expect(t("防盗门的钥匙")).toBe("key");
    expect(t("住宅钥匙")).toBe("key");
  });

  test("名字含「照片/证/文件」→ document", () => {
    expect(t("农场的照片")).toBe("document");
    expect(t("驾驶证")).toBe("document");
    expect(t("老旧文件")).toBe("document");
  });

  test("都不中 → loot", () => {
    expect(t("黑色钱包")).toBe("loot");
  });

  test("只看 name 不看 text —— 正文里出现「钥匙」的条目多得是", () => {
    // 基准的「床头柜」正文就写着钥匙。拿正文匹配会把一堆东西判成 key
    const r = buildItems(
      [input("p1:L1", "黑色钱包", "里面有一把钥匙")],
      kinds([["p1:L1", "item"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items[0]?.type).toBe("loot");
  });

  test("trap 类直接是 trap，不过 name 规则", () => {
    const r = buildItems(
      [input("p1:L1", "钥匙形状的陷阱", "造成 1d6 的伤害")],
      kinds([["p1:L1", "trap"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items[0]?.type).toBe("trap");
  });
});

describe("陷阱接上已有的抽取器", () => {
  const bear = "体形小于 35 的角色会免疫这种陷阱，当踩中时陷阱会牢牢咬住被害者的腿，造成 1D4+1 的伤害。挣脱需要困难成功的力量来打开陷阱。";

  test("机制落到 trap 字段", () => {
    const r = buildItems(
      [input("p9:L13", "捕兽夹", bear)],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.items[0]?.trap).toMatchObject({ damage: "1D4+1", sizImmunityBelow: 35 });
  });

  test("provenance 的 path 已 rebase 到根，且用 id 不用下标", () => {
    // 下标路径在按名字配对之后没有意义 —— 上一轮已经确认过
    const r = buildItems(
      [input("p9:L13", "捕兽夹", bear)],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.provenance.map((p) => p.path)).toContain("items[item_07].trap.damage");
  });

  test("sourceRef 就是条目的键", () => {
    const r = buildItems(
      [input("p9:L13", "捕兽夹", bear)],
      kinds([["p9:L13", "trap"]]),
      ids([["p9:L13", "item_07"]]),
    );
    expect(r.provenance[0]?.sourceRef).toBe("p9:L13");
  });

  test("一条机制都抽不到时仍产出物品，只是不带 trap，并计入 warnings", () => {
    // 基准里 trap 缺省的语义就是「该陷阱纯叙事，不结算」
    const r = buildItems(
      [input("p1:L1", "看起来吓人的东西", "调查员会感到不安。")],
      kinds([["p1:L1", "trap"]]),
      ids([["p1:L1", "item_01"]]),
    );
    expect(r.items).toHaveLength(1);
    expect("trap" in (r.items[0] ?? {})).toBe(false);
    expect(r.warnings.join()).toContain("抽不到");
  });
});

describe("无名条目", () => {
  test("被判成物品但没名字 → 跳过并 warn，因为没法被指认", () => {
    const r = buildItems([input("p4:L12", "", "使用卡片询问免费饮品")], kinds([["p4:L12", "item"]]), ids([["p4:L12", "item_01"]]));
    expect(r.items).toEqual([]);
    expect(r.warnings.join()).toContain("没有名字");
  });
});

describe("调用契约", () => {
  test("条目的 key 不在 ids 里直接抛 —— 那是编程错误", () => {
    expect(() => buildItems([input("p1:L1", "钥匙", "x")], kinds([["p1:L1", "item"]]), ids([]))).toThrow();
  });

  test("同名条目各得各的 id —— 驾驶证在两个块里各出现一次", () => {
    const r = buildItems(
      [input("p6:L17", "驾驶证", "住址"), input("p7:L12", "驾驶证", "住址")],
      kinds([["p6:L17", "item"], ["p7:L12", "item"]]),
      ids([["p6:L17", "item_10"], ["p7:L12", "item_14"]]),
    );
    expect(r.items.map((i) => i.id)).toEqual(["item_10", "item_14"]);
  });
});
