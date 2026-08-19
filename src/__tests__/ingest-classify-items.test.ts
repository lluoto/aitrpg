// 摄取管线 · ▶ 条目分类
//
// LLM 的回答本身没法做确定性单测，能测的是它两侧的纯函数：
// 输入组装有没有把该给的都给全，以及回答坏掉时解析器扛不扛得住。
// 模型行为靠实跑对基准验证，不靠单测假装验证。

import { describe, test, expect } from "bun:test";
import { toItemInputs, buildItemPrompt, parseItemResponse } from "../ingest/classify-items";
import type { Section, SectionItem } from "../ingest/sectionize";
import type { SectionKind } from "../ingest/classify-sections";

const item = (name: string, text: string, page: number, line: number): SectionItem => ({
  name,
  text,
  source: { page, line },
});

const sec = (title: string, items: SectionItem[]): Section => ({
  title,
  body: "",
  items,
  source: { page: 1, line: 1 },
});

const kinds = (pairs: Array<[string, SectionKind]>) => new Map<string, SectionKind>(pairs);

describe("toItemInputs", () => {
  test("只取场景块上的条目", () => {
    const secs = [
      sec("农场外围", [item("捕兽夹", "1D4+1", 9, 13)]),
      sec("菲碧·特里坎", [item("", "她只知道加比比较叛逆", 3, 8)]),
    ];
    const out = toItemInputs(secs, kinds([["农场外围", "scene"], ["菲碧·特里坎", "npc"]]), ["scene_01", "scene_02"]);
    expect(out.map((i) => i.key)).toEqual(["p9:L13"]);
  });

  test("带上所属场景的 id 与标题 —— 物品要知道自己在哪个场景", () => {
    const out = toItemInputs(
      [sec("前言", []), sec("农场外围", [item("捕兽夹", "x", 9, 13)])],
      kinds([["农场外围", "scene"]]),
      ["scene_01", "scene_02"],
    );
    expect(out[0]).toMatchObject({ sceneId: "scene_02", sceneTitle: "农场外围" });
  });

  test("无名条目照样进 —— 39 个里有 8 个整行没冒号，名字为空串", () => {
    const out = toItemInputs(
      [sec("维森酒吧", [item("", "使用卡片询问免费饮品", 4, 12)])],
      kinds([["维森酒吧", "scene"]]),
      ["scene_01"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("");
  });

  test("查不到分类的块不取 —— 不猜", () => {
    const out = toItemInputs([sec("来路不明", [item("x", "y", 1, 2)])], kinds([]), ["scene_01"]);
    expect(out).toEqual([]);
  });

  test("ids 与 sections 长度不符直接抛", () => {
    expect(() => toItemInputs([sec("甲", []), sec("乙", [])], kinds([]), ["scene_01"])).toThrow();
  });
});

describe("buildItemPrompt", () => {
  test("键、场景、名字、正文都进 prompt", () => {
    const p = buildItemPrompt([
      { key: "p9:L13", sceneTitle: "农场外围", sceneId: "scene_11", name: "捕兽夹", text: "造成 1D4+1 的伤害" },
    ]);
    expect(p).toContain("p9:L13");
    expect(p).toContain("农场外围");
    expect(p).toContain("捕兽夹");
    expect(p).toContain("造成 1D4+1 的伤害".replace(/\s+/g, ""));
  });

  test("六个类别名都在 prompt 里 —— 少一个模型就永远不会返回它", () => {
    const p = buildItemPrompt([{ key: "p1:L1", sceneTitle: "甲", sceneId: "scene_01", name: "x", text: "y" }]);
    for (const k of ["clue", "item", "trap", "connection", "npc_knowledge", "event"]) {
      expect(p).toContain(k);
    }
  });

  test("无名条目也要能渲染，不能塌成空行", () => {
    const p = buildItemPrompt([
      { key: "p4:L12", sceneTitle: "维森酒吧", sceneId: "scene_04", name: "", text: "使用卡片询问免费饮品" },
    ]);
    expect(p).toContain("p4:L12");
    expect(p).toContain("使用卡片询问免费饮品");
  });
});

describe("parseItemResponse", () => {
  const known = ["p9:L13", "p4:L12"];

  test("认得干净的 JSON", () => {
    const m = parseItemResponse('{"p9:L13":"trap","p4:L12":"clue"}', known);
    expect(m.get("p9:L13")).toBe("trap");
    expect(m.get("p4:L12")).toBe("clue");
  });

  test("代码围栏里的也认", () => {
    const m = parseItemResponse('```json\n{"p9:L13":"trap"}\n```', known);
    expect(m.get("p9:L13")).toBe("trap");
  });

  test("模型把整行抄回来当键也认 —— 展示格式不该变成输出格式的契约", () => {
    // 上一轮就栽在这：prompt 里标题展示成【农场外围】，模型照抄回来，
    // 43 条全被丢弃，表现成「模型没干活」，实际它全做对了。
    const m = parseItemResponse('{"p9:L13 【农场外围】捕兽夹":"trap"}', known);
    expect(m.get("p9:L13")).toBe("trap");
  });

  test("编造的键丢掉", () => {
    expect(parseItemResponse('{"p99:L99":"trap"}', known).size).toBe(0);
  });

  test("枚举外的类别丢掉，不做兜底猜测", () => {
    expect(parseItemResponse('{"p9:L13":"物品"}', known).size).toBe(0);
  });

  test("值不是字符串就丢掉", () => {
    expect(parseItemResponse('{"p9:L13":["trap"]}', known).size).toBe(0);
  });

  test("整个回答不是 JSON 时给空表，不崩", () => {
    expect(parseItemResponse("我认为第一条是陷阱。", known).size).toBe(0);
  });

  test("空回答给空表", () => {
    expect(parseItemResponse("", known).size).toBe(0);
  });
});
