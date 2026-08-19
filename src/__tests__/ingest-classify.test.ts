// 摄取管线 · 块分类（LLM 层）
//
// 「这一块是不是场景」已实测证明不是文本形态能定的（引文信号 15/20，误报 6，
// 见 docs/index-program.md），所以归 LLM。
//
// LLM 的回答本身没法做确定性单测，能测的是它两侧的纯函数：
// prompt 有没有把该给的都给全，以及回答坏掉时解析器扛不扛得住。
// 模型行为靠实跑对基准验证，不靠单测假装验证。

import { describe, test, expect } from "bun:test";
import { buildClassifyPrompt, parseClassifyResponse, toClassifyInputs } from "../ingest/classify-sections";
import type { Section } from "../ingest/sectionize";

const SECS = [
  { title: "农场外围", excerpt: "这里是非常危险的一个场景。艾德里安在这里放置了很多陷阱。" },
  { title: "菲碧·特里坎", excerpt: "加比的母亲，一位焦虑的中年女性。" },
  { title: "附录", excerpt: "主要 NPC 数据。" },
];

describe("prompt 构建", () => {
  test("每个块的标题都要出现，漏一个模型就分不了它", () => {
    const p = buildClassifyPrompt(SECS);
    for (const s of SECS) expect(p).toContain(s.title);
  });

  test("带上正文摘要 —— 只给标题不足以判断", () => {
    expect(buildClassifyPrompt(SECS)).toContain("艾德里安在这里放置了很多陷阱");
  });

  test("摘要过长要截断，别把整本模组塞进 prompt", () => {
    const p = buildClassifyPrompt([{ title: "x", excerpt: "描".repeat(3000) }]);
    expect(p.length).toBeLessThan(2000);
  });

  test("四个类别都在 prompt 里说明", () => {
    const p = buildClassifyPrompt(SECS);
    for (const k of ["scene", "npc", "structure", "rule"]) expect(p).toContain(k);
  });

  test("要求纯 JSON 输出 —— 混着解释文字会让解析器难做", () => {
    expect(buildClassifyPrompt(SECS)).toMatch(/JSON/i);
  });
});

describe("响应解析", () => {
  const titles = SECS.map((s) => s.title);

  test("正常 JSON", () => {
    const m = parseClassifyResponse('{"农场外围":"scene","菲碧·特里坎":"npc","附录":"structure"}', titles);
    expect(m.get("农场外围")).toBe("scene");
    expect(m.get("菲碧·特里坎")).toBe("npc");
  });

  test("代码围栏包裹也能解析 —— 模型很爱加 ```json", () => {
    const m = parseClassifyResponse('```json\n{"农场外围":"scene"}\n```', titles);
    expect(m.get("农场外围")).toBe("scene");
  });

  test("前后带解释文字时抠出 JSON 那段", () => {
    const m = parseClassifyResponse('好的，分类如下：\n{"农场外围":"scene"}\n希望有帮助', titles);
    expect(m.get("农场外围")).toBe("scene");
  });

  test("键带着 prompt 里的方括号也要认 —— 模型会照抄展示格式", () => {
    // 实跑踩到的：prompt 里标题显示成【农场外围】，模型返回的键就是 "【农场外围】"，
    // 拿裸标题匹配会把 43 条全丢掉，表现成"模型没干活"，实际是模型全做对了。
    const m = parseClassifyResponse('{"【农场外围】":"scene","【附录】":"structure"}', titles);
    expect(m.get("农场外围")).toBe("scene");
    expect(m.get("附录")).toBe("structure");
  });

  test("键带多余空白也要认", () => {
    expect(parseClassifyResponse('{" 农场外围 ":"scene"}', titles).get("农场外围")).toBe("scene");
  });

  test("模型漏了某个块 → 该块不在结果里，不臆造", () => {
    const m = parseClassifyResponse('{"农场外围":"scene"}', titles);
    expect(m.has("附录")).toBe(false);
  });

  test("模型编了不存在的标题 → 丢弃", () => {
    const m = parseClassifyResponse('{"不存在的块":"scene"}', titles);
    expect(m.size).toBe(0);
  });

  test("非法类别值 → 丢弃该条，不当成 scene", () => {
    // 把认不出的东西默认成 scene，会让分类结果虚高而无人察觉
    const m = parseClassifyResponse('{"农场外围":"地点"}', titles);
    expect(m.has("农场外围")).toBe(false);
  });

  test("整体不是 JSON → 返回空表，交给调用方降级", () => {
    expect(parseClassifyResponse("我无法完成这个任务", titles).size).toBe(0);
  });

  test("空响应 → 空表", () => {
    expect(parseClassifyResponse("", titles).size).toBe(0);
  });
});

const sec = (title: string, body: string): Section => ({
  title,
  body,
  items: [],
  source: { page: 1, line: 1 },
});

describe("toClassifyInputs", () => {
  test("标题与正文原样传下去", () => {
    const out = toClassifyInputs([sec("农场外围", "泥泞的车辙一直通向谷仓。")]);
    expect(out).toEqual([{ title: "农场外围", excerpt: "泥泞的车辙一直通向谷仓。" }]);
  });

  test("滤掉标题为空的前置块 —— 它进不了以标题为键的分类结果", () => {
    // sectionize 会把首个标题之前的内容（第 1 页的书名等）归入 title 为空串的块
    const out = toClassifyInputs([sec("", "普瑞米尔的谷仓"), sec("报亭", "镇口的报亭。")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("报亭");
  });

  test("保序，但不与输入等长 —— 下游只能按标题查回，不能按下标", () => {
    // 空标题块被滤掉，两边下标就对不上了。而 assignSceneIds 是对着
    // 完整的 sections 编号的，把两者按位置一拉，每个场景都会挂错 id。
    const out = toClassifyInputs([sec("", "书名"), sec("甲", "a"), sec("乙", "b")]);
    expect(out.map((s) => s.title)).toEqual(["甲", "乙"]);
  });

  test("空输入给空数组", () => {
    expect(toClassifyInputs([])).toEqual([]);
  });

  test("正文不在这里截断 —— 截断是 buildClassifyPrompt 的事，只该有一处", () => {
    const long = "描".repeat(500);
    expect(toClassifyInputs([sec("甲", long)])[0]?.excerpt).toHaveLength(500);
  });
});
