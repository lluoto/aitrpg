// 摄取管线 · 场景骨架
//
// 本轮只填 id / name / description 三个字段。其余一律不填 ——
// 没抽就是没抽，填 undefined 或编一个值都会让校准报告读不出「还差多少」。
// 这一轮买的是「可测量」，不是「更准」。

import { describe, test, expect } from "bun:test";
import { buildScenes } from "../ingest/build-scenes";
import type { Section, SectionItem } from "../ingest/sectionize";
import type { SectionKind } from "../ingest/classify-sections";

const item = (name: string, text: string): SectionItem => ({
  name,
  text,
  source: { page: 1, line: 1 },
});

const sec = (title: string, body = "", items: SectionItem[] = []): Section => ({
  title,
  body,
  items,
  source: { page: 1, line: 1 },
});

const kinds = (pairs: Array<[string, SectionKind]>) => new Map<string, SectionKind>(pairs);

describe("挑块", () => {
  test("只取 scene 类", () => {
    const secs = [sec("农场外围"), sec("菲碧·特里坎"), sec("附录"), sec("米戈属性")];
    const r = buildScenes(
      secs,
      kinds([["农场外围", "scene"], ["菲碧·特里坎", "npc"], ["附录", "structure"], ["米戈属性", "rule"]]),
      ["scene_01", "scene_02", "scene_03", "scene_04"],
    );
    expect(r.scenes.map((s) => s.name)).toEqual(["农场外围"]);
  });

  test("没有分类结果的块跳过，并计入 warnings —— 不猜", () => {
    const r = buildScenes([sec("农场外围"), sec("来路不明")], kinds([["农场外围", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes).toHaveLength(1);
    expect(r.warnings.join()).toContain("没有分类结果");
  });

  test("标题为空的前置块跳过", () => {
    const r = buildScenes([sec("", "普瑞米尔的谷仓"), sec("报亭")], kinds([["报亭", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes.map((s) => s.name)).toEqual(["报亭"]);
  });

  test("空分类表给零个场景 —— LLM 挂掉时如实显示 0，不把所有块当场景", () => {
    const r = buildScenes([sec("农场外围"), sec("报亭")], kinds([]), ["scene_01", "scene_02"]);
    expect(r.scenes).toEqual([]);
  });
});

describe("字段口径", () => {
  test("id 按下标取自 assignSceneIds 的结果", () => {
    const r = buildScenes([sec("前言"), sec("报亭")], kinds([["报亭", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes[0]?.id).toBe("scene_02");
  });

  test("name 是中文原名，description 是整块 body", () => {
    const r = buildScenes([sec("报亭", "镇口的报亭，老板正在打盹。")], kinds([["报亭", "scene"]]), ["scene_01"]);
    expect(r.scenes[0]?.name).toBe("报亭");
    expect(r.scenes[0]?.description).toBe("镇口的报亭，老板正在打盹。");
  });

  test("三个必填数组存在且为空", () => {
    const r = buildScenes([sec("报亭", "x")], kinds([["报亭", "scene"]]), ["scene_01"]);
    expect(r.scenes[0]?.clues).toEqual([]);
    expect(r.scenes[0]?.npcIds).toEqual([]);
    expect(r.scenes[0]?.connections).toEqual([]);
  });

  test("可选字段一个都不写进对象 —— 写 undefined 也不行", () => {
    const r = buildScenes([sec("报亭", "x")], kinds([["报亭", "scene"]]), ["scene_01"]);
    expect(Object.keys(r.scenes[0] ?? {}).sort()).toEqual(
      ["clues", "connections", "description", "id", "name", "npcIds"],
    );
  });

  test("▶ 条目不混进 description —— 它们是线索/物品，不是场景描述", () => {
    const s = sec("农场外围", "泥泞的车辙。", [item("捕兽夹", "踩中时造成1D4+1伤害")]);
    const r = buildScenes([s], kinds([["农场外围", "scene"]]), ["scene_01"]);
    expect(r.scenes[0]?.description).toBe("泥泞的车辙。");
    expect(r.scenes[0]?.description).not.toContain("捕兽夹");
  });

  test("丢弃的条目要报数 —— 不静默丢东西", () => {
    const s = sec("农场外围", "x", [item("捕兽夹", "a"), item("霰弹枪", "b")]);
    const r = buildScenes([s], kinds([["农场外围", "scene"]]), ["scene_01"]);
    // 整条 warning 列表比对，不用 join().toContain("2")：
    // 那种写法在报数算成 12 / 20 / 22 时照样绿，数字也可能是从别的 warning 蹭来的。
    // 这条测试买的就是「那个数是 2」，就得把条数和文案一起钉死。
    expect(r.warnings).toEqual(["2 个 ▶ 条目本轮未消费（属线索/物品，留给下一轮）"]);
  });
});

describe("重名标题", () => {
  test("各得各的 id", () => {
    const r = buildScenes([sec("卧室", "a"), sec("卧室", "b")], kinds([["卧室", "scene"]]), ["scene_01", "scene_02"]);
    expect(r.scenes.map((s) => s.id)).toEqual(["scene_01", "scene_02"]);
  });

  test("报一条 warning —— 分类器以标题为键，两块只能拿到同一类", () => {
    const r = buildScenes([sec("卧室", "a"), sec("卧室", "b")], kinds([["卧室", "scene"]]), ["scene_01", "scene_02"]);
    // 「一条」是这条测试的全部内容：每块各报一条（这里就是两条）的实现，
    // 在 join().toContain("卧室") 下同样绿。所以先数条数，再看那一条说了什么 ——
    // 报数说「出现 2 次」才算认出这是重名，只是提到标题不算。
    const dup = r.warnings.filter((w) => w.includes("卧室"));
    expect(dup).toHaveLength(1);
    expect(dup[0]).toContain("出现 2 次");
  });
});

describe("调用契约", () => {
  test("ids 与 sections 长度不符直接抛 —— 那是编程错误，不是数据问题", () => {
    expect(() => buildScenes([sec("甲"), sec("乙")], kinds([]), ["scene_01"])).toThrow();
  });
});
