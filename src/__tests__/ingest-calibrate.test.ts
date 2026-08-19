// 摄取管线 · 校准器
//
// 用途：把读取模块生成的 ModuleData 与现有那份已被实跑校准过的
// barn-of-premier.ts 逐字段对比，差异清单就是读取模块还差多少的度量。
//
// 生成物不覆盖基准，并排放着比对——这样基准始终是可信的验收标尺。

import { describe, test, expect } from "bun:test";
import { diffValues, formatDiff, type FieldDiff } from "../ingest/calibrate";

/** 取某个路径上的差异，测试里用着方便 */
const at = (ds: FieldDiff[], path: string) => ds.find((d) => d.path === path);

describe("相同即无差异", () => {
  test("两个空对象", () => {
    expect(diffValues({}, {})).toEqual([]);
  });

  test("标量全等", () => {
    expect(diffValues({ a: 1, b: "x", c: true }, { a: 1, b: "x", c: true })).toEqual([]);
  });

  test("嵌套结构全等", () => {
    const v = { meta: { author: "甲", tags: ["a", "b"] } };
    expect(diffValues(v, structuredClone(v))).toEqual([]);
  });

  test("自比为零差异 —— 校准器最基本的自洽", () => {
    const m = {
      id: "m1",
      scenes: [{ id: "s1", name: "谷仓", clues: [{ id: "c1", name: "血衣" }] }],
      npcs: [{ id: "n1", name: "菲碧" }],
    };
    expect(diffValues(m, structuredClone(m))).toEqual([]);
  });
});

describe("标量差异", () => {
  test("值不同报 changed，并带上两边的值", () => {
    const d = diffValues({ version: "1.0" }, { version: "1.03" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ path: "version", kind: "changed", baseline: "1.0", candidate: "1.03" });
  });

  test("类型不同也算 changed", () => {
    const d = diffValues({ n: 35 }, { n: "35" });
    expect(d[0]?.kind).toBe("changed");
  });

  test("数字精度差异不被忽略", () => {
    const d = diffValues({ ratio: 0.5 }, { ratio: 0.51 });
    expect(d).toHaveLength(1);
  });
});

describe("缺失与多余", () => {
  test("候选缺字段 → missing", () => {
    const d = diffValues({ a: 1, b: 2 }, { a: 1 });
    expect(at(d, "b")).toMatchObject({ kind: "missing", baseline: 2 });
  });

  test("候选多字段 → extra", () => {
    const d = diffValues({ a: 1 }, { a: 1, z: 9 });
    expect(at(d, "z")).toMatchObject({ kind: "extra", candidate: 9 });
  });

  test("显式 undefined 与字段不存在视为同一件事", () => {
    // ModuleData 里大量可选字段，写不写 undefined 不该算差异
    expect(diffValues({ a: 1, b: undefined }, { a: 1 })).toEqual([]);
    expect(diffValues({ a: 1 }, { a: 1, b: undefined })).toEqual([]);
  });
});

describe("数组按 id 配对", () => {
  test("顺序不同但内容相同 → 无差异", () => {
    // 生成物的场景顺序不必与手写那份一致，按下标比会全盘误报
    const a = { scenes: [{ id: "s1", name: "甲" }, { id: "s2", name: "乙" }] };
    const b = { scenes: [{ id: "s2", name: "乙" }, { id: "s1", name: "甲" }] };
    expect(diffValues(a, b)).toEqual([]);
  });

  test("路径用 id 而不是下标 —— 下标会随顺序漂移，报出来没法查", () => {
    const a = { scenes: [{ id: "s1", name: "甲" }] };
    const b = { scenes: [{ id: "s1", name: "乙" }] };
    expect(at(diffValues(a, b), "scenes[s1].name")).toBeDefined();
  });

  test("候选少一个元素 → missing，路径带 id", () => {
    const a = { npcs: [{ id: "n1" }, { id: "n2" }] };
    const b = { npcs: [{ id: "n1" }] };
    expect(at(diffValues(a, b), "npcs[n2]")).toMatchObject({ kind: "missing" });
  });

  test("候选多一个元素 → extra", () => {
    const a = { npcs: [{ id: "n1" }] };
    const b = { npcs: [{ id: "n1" }, { id: "n9" }] };
    expect(at(diffValues(a, b), "npcs[n9]")).toMatchObject({ kind: "extra" });
  });

  test("嵌套数组同样按 id 配对", () => {
    const a = { scenes: [{ id: "s1", clues: [{ id: "c1", name: "血衣" }] }] };
    const b = { scenes: [{ id: "s1", clues: [{ id: "c1", name: "染血的衣物" }] }] };
    expect(at(diffValues(a, b), "scenes[s1].clues[c1].name")).toBeDefined();
  });
});

describe("无 id 的数组按下标", () => {
  test("字符串数组逐位比", () => {
    const d = diffValues({ tags: ["a", "b"] }, { tags: ["a", "c"] });
    expect(at(d, "tags[1]")).toMatchObject({ kind: "changed", baseline: "b", candidate: "c" });
  });

  test("长度不同报缺失", () => {
    const d = diffValues({ tags: ["a", "b"] }, { tags: ["a"] });
    expect(at(d, "tags[1]")).toMatchObject({ kind: "missing" });
  });

  test("顺序不同的字符串数组算差异 —— 无 id 时顺序是唯一身份", () => {
    const d = diffValues({ tags: ["a", "b"] }, { tags: ["b", "a"] });
    expect(d.length).toBeGreaterThan(0);
  });
});

describe("报告格式", () => {
  test("按种类分组统计", () => {
    const d = diffValues({ a: 1, b: 2, c: 3 }, { a: 9, b: 2, z: 0 });
    const txt = formatDiff(d);
    expect(txt).toContain("changed");
    expect(txt).toContain("missing");
    expect(txt).toContain("extra");
  });

  test("零差异时明确说通过，而不是给一片空白", () => {
    expect(formatDiff([])).toContain("无差异");
  });

  test("长文本截断，不把整段场景描述糊进报告", () => {
    const long = "描".repeat(500);
    const d = diffValues({ desc: long }, { desc: long + "！" });
    const txt = formatDiff(d);
    expect(txt.length).toBeLessThan(600);
  });
});

describe("配对键可配置", () => {
  test("不传 opts 与显式传 ['id'] 完全等价 —— 现有 21 个测试是这条的基线", () => {
    const a = { scenes: [{ id: "s1", name: "甲" }] };
    const b = { scenes: [{ id: "s2", name: "甲" }] };
    expect(diffValues(a, b)).toEqual(diffValues(a, b, { pairBy: ["id"] }));
  });

  test("按 name 配对：id 不同但 name 相同的两个元素被认成同一个", () => {
    // 生成的 id 是内部句柄（scene_07），基准是手写意译（adrian_bedroom），
    // 按 id 配会把每个场景都报成「缺失 + 多余」，真实差异被噪音埋掉
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室", description: "床头柜" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室", description: "床头柜" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(d.filter((x) => x.kind === "missing" || x.kind === "extra")).toEqual([]);
  });

  test("路径段用实际配对键的值 —— 序号 id 不可读，中文名可读", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室", description: "床头柜" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室", description: "床边" }] };
    expect(at(diffValues(a, b, { pairBy: ["id", "name"] }), "scenes[卧室].description")).toBeDefined();
  });

  test("先按 id 配，配不上的才按 name 配", () => {
    const a = { scenes: [{ id: "s1", name: "甲", v: 1 }, { id: "s2", name: "乙", v: 2 }] };
    const b = { scenes: [{ id: "s1", name: "甲", v: 1 }, { id: "scene_02", name: "乙", v: 2 }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(d.filter((x) => x.kind !== "id-mismatch")).toEqual([]);
  });

  test("配对键在两侧都不可用时退回按下标 —— 与现在的行为一致", () => {
    const d = diffValues({ tags: ["a", "b"] }, { tags: ["a", "c"] }, { pairBy: ["id", "name"] });
    expect(at(d, "tags[1]")).toMatchObject({ kind: "changed" });
  });
});

describe("id-mismatch 单列", () => {
  test("按 name 配上但 id 不同 → id-mismatch，不计入 changed", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(d.filter((x) => x.kind === "changed")).toEqual([]);
    expect(at(d, "scenes[卧室].id")).toMatchObject({
      kind: "id-mismatch",
      baseline: "adrian_bedroom",
      candidate: "scene_18",
    });
  });

  test("同一件事只报一次 —— 不再另出一条 .id 的 changed", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] }).filter((x) => x.path === "scenes[卧室].id");
    expect(d).toHaveLength(1);
  });

  test("按 id 配对时不会产出 id-mismatch", () => {
    const a = { scenes: [{ id: "s1", name: "甲" }] };
    const b = { scenes: [{ id: "s1", name: "乙" }] };
    expect(diffValues(a, b).filter((x) => x.kind === "id-mismatch")).toEqual([]);
  });

  test("一侧压根没有 id 时如实报 missing，不被跳过吞掉", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ name: "卧室" }] };
    const d = diffValues(a, b, { pairBy: ["id", "name"] });
    expect(at(d, "scenes[卧室].id")).toMatchObject({ kind: "missing" });
  });
});

describe("空数组仍按 id 配对", () => {
  test("候选侧 clues 为空 → 路径带线索 id，而不是下标", () => {
    // 这份缺失清单就是下一轮的路线图。印成 clues[0]…clues[31] 则一文不值
    const a = { scenes: [{ id: "s1", clues: [{ id: "clue_bar_ask_around", name: "打听" }] }] };
    const b = { scenes: [{ id: "s1", clues: [] }] };
    expect(at(diffValues(a, b), "scenes[s1].clues[clue_bar_ask_around]")).toMatchObject({ kind: "missing" });
  });

  test("两侧皆空 → 无差异", () => {
    expect(diffValues({ clues: [] }, { clues: [] })).toEqual([]);
  });

  test("空数组对上无 id 的数组仍退回下标", () => {
    const d = diffValues({ tags: ["a"] }, { tags: [] });
    expect(at(d, "tags[0]")).toMatchObject({ kind: "missing" });
  });
});

describe("报告含 id-mismatch 计数", () => {
  test("统计行列出 id 不一致的条数", () => {
    const a = { scenes: [{ id: "adrian_bedroom", name: "卧室" }] };
    const b = { scenes: [{ id: "scene_18", name: "卧室" }] };
    expect(formatDiff(diffValues(a, b, { pairBy: ["id", "name"] }))).toContain("id");
  });
});
