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

describe("产出了但可疑的物品", () => {
  test("description 为空仍产出，但要报数 —— 没有描述的物品没法叙事", () => {
    // 实跑 item_20（p8:L6「抽屉里的关于***号农场的转购协议」）就是这个形状：
    // ▶ 行有名字、冒号后什么都没有。这种多半是分块产物，得看见。
    const r = buildItems(
      [input("p8:L6", "抽屉里的转购协议", "")],
      kinds([["p8:L6", "item"]]),
      ids([["p8:L6", "item_20"]]),
    );
    // 行为不变：物品照样产出。这条 warning 说的是「放过去了」，不是「丢掉了」
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.description).toBe("");
    // 整条列表比对，不用 join().toContain("1")：那种写法在报成 11 / 21 时照样绿
    expect(r.warnings).toEqual([
      "1 个条目产出了物品但 description 为空（▶ 行只有名字没有正文），已照原样产出",
    ]);
  });

  test("无名条目已按「没有名字」报过，不再重复计进空描述 —— 一条输入只报一次", () => {
    // name 与 text 双空的条目在 nameless 那关就 continue 了，压根没成为物品。
    // 空描述这个数只数「产出了的」，不然同一条输入会在两个数里各占一席，
    // 读的人会以为有两条问题条目。
    const r = buildItems(
      [input("p4:L12", "", "")],
      kinds([["p4:L12", "item"]]),
      ids([["p4:L12", "item_01"]]),
    );
    expect(r.items).toEqual([]);
    expect(r.warnings).toEqual(["1 个条目被判成物品/陷阱但没有名字，已跳过"]);
  });

  test("重名物品报一条 warning 并点出名字 —— 校准器按 name 配对，重名会有一个报成 extra", () => {
    // 实跑的 item_14 / item_15 都叫「驾驶证」：原文确实写了两遍，基准只收一次。
    // 只报个数字的话，读的人没法把它找出来；兄弟模块（buildScenes 的重名标题）
    // 也是把名字写进文案的，跟着那个口径。
    const r = buildItems(
      [input("p6:L17", "驾驶证", "住址甲"), input("p7:L12", "驾驶证", "住址乙")],
      kinds([["p6:L17", "item"], ["p7:L12", "item"]]),
      ids([["p6:L17", "item_14"], ["p7:L12", "item_15"]]),
    );
    // 行为不变：本轮不去重，两个都产出
    expect(r.items.map((i) => i.id)).toEqual(["item_14", "item_15"]);
    // 先数条数再看内容：每个重名条目各报一条（这里就是两条）的实现，
    // 在 join().toContain("驾驶证") 下同样绿
    const dup = r.warnings.filter((w) => w.includes("驾驶证"));
    expect(dup).toHaveLength(1);
    expect(dup[0]).toBe(
      "物品名「驾驶证」出现 2 次；校准器按 name 配对，其中一个会报成 extra，那不是幻觉。本轮不去重，两个都产出",
    );
  });

  test("名字各不相同就不报重名 —— 这个数不能一有物品就响", () => {
    const r = buildItems(
      [input("p1:L1", "钥匙", "a"), input("p1:L2", "照片", "b")],
      kinds([["p1:L1", "item"], ["p1:L2", "item"]]),
      ids([["p1:L1", "item_01"], ["p1:L2", "item_02"]]),
    );
    expect(r.items).toHaveLength(2);
    expect(r.warnings).toEqual([]);
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
