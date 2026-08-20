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

  test("空标题的前置块不取 —— 哪怕它名下挂着条目", () => {
    // sectionize 把首个标题之前的内容（第 1 页的书名等）归进 title 为空串的前置块。
    // 这里特意把空串也塞进 kinds 并判成 scene，好让「查不到分类」那条拦不住它 ——
    // 拦住它的必须是空标题这一条本身，否则这测试测的是另一个分支。
    const out = toItemInputs([sec("", [item("普瑞米尔的谷仓", "书名页", 1, 2)])], kinds([["", "scene"]]), ["scene_01"]);
    expect(out).toEqual([]);
  });

  test("ids 与 sections 长度不符直接抛", () => {
    // 认报错文本，不只认「抛了」：不带参数的 toThrow 连不相干的 TypeError 都算通过，
    // 而长度不符这条的价值全在它说清了差多少。
    expect(() => toItemInputs([sec("甲", []), sec("乙", [])], kinds([]), ["scene_01"])).toThrow(
      "[ingest] ids 与 sections 长度不符：1 vs 2",
    );
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
    // 认「- 类别名：」这个条目形态，不认裸词：item 和 clue 在下面那条「注意」里也各出现一次
    // （拿得走的是 item，知道了的是 clue），拿裸词断言的话，把这两条从类别表里删掉测试照样绿 ——
    // 而它俩正是那条注意存在的理由，六个里最不能漏的一对。
    for (const k of ["clue", "item", "trap", "connection", "npc_knowledge", "event"]) {
      expect(p).toContain(`- ${k}：`);
    }
  });

  test("无名条目也要能渲染，不能塌成空行", () => {
    const p = buildItemPrompt([
      { key: "p4:L12", sceneTitle: "维森酒吧", sceneId: "scene_04", name: "", text: "使用卡片询问免费饮品" },
    ]);
    expect(p).toContain("p4:L12");
    expect(p).toContain("使用卡片询问免费饮品");
    // 占位符才是这条测试的正题。少了它，那行就塌成「p4:L12 【维森酒吧】：正文」，
    // 键和正文都还在 —— 只断言这两样的话，删掉占位符测试照样绿，等于没测。
    expect(p).toContain("(无标题)");
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

  // 下面四条针对的是值这一侧。键那侧早就归一化了（整行抄回来也认），
  // 值这侧却是精确比对，模型换个写法就整条丢掉 —— 与键那侧同一类失效，
  // 且同样表现成「模型没答」而不是报错。

  test("值大小写不一致也认 —— Trap 就是 trap", () => {
    expect(parseItemResponse('{"p9:L13":"Trap"}', known).get("p9:L13")).toBe("trap");
  });

  test("值带首尾空白也认", () => {
    expect(parseItemResponse('{"p9:L13":"trap "}', known).get("p9:L13")).toBe("trap");
  });

  test("npc-knowledge 写成连字符也认 —— 六类里唯一的多词类别，最可能被写错", () => {
    expect(parseItemResponse('{"p9:L13":"npc-knowledge"}', known).get("p9:L13")).toBe("npc_knowledge");
  });

  test("归一化之后仍不在枚举里的值照样丢 —— 归一不是模糊匹配", () => {
    // 放宽的只是写法（大小写、空白、连字符），不是判定。traps 归一化后还是 traps，
    // 六类里没有它，就得丢。宁可少认，也不要悄悄多认。
    expect(parseItemResponse('{"p9:L13":" TRAPS "}', known).size).toBe(0);
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
