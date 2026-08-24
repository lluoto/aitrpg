// LLM 失败时 PC 问出来的那句话。
//
// 你原话：「论起来也不万能，显得非常机械」。
//   「关于**这一点**，您还记得什么吗？」
//   「**这件事**的具体情况，您还知道些什么吗？」
//
// 两个毛病：
//   1. `fallbackQuestion` 收了 `topic` 参数**却从来不用** —— 池子里三条写死的，
//      算出来的话题直接丢掉，于是永远只会说「这一点」「这件事」
//   2. 它解构了 module/support/world/cast/cursor/dedup/wm/llmClient/agents 九个变量，
//      一个都没用；其中 `agents: [pl1, pl2]` 对 undefined 做数组解构 ——
//      一个「从池子里挑句话」的纯函数能抛 TypeError
//
// 修法的边界很重要：**只把已知专名塞进问句，绝不塞 knowledge 正文**。
// extractTopic 返回的是分句不是名词（「加比比较叛逆」），
// 原样塞进去既不通顺，又把答案在问句里提前说了。

import { describe, test, expect } from "bun:test";
import { fallbackQuestion, topicAnchor, extractTopic } from "../play/scene-pipeline";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { SceneCtx } from "../play/scene-pipeline";

const ctx = { module: BARN_OF_PREMIER } as unknown as SceneCtx;
const NPC = BARN_OF_PREMIER.npcs[0]!.name.replace(/[（(].*?[）)]/g, "").trim();

/** 把池子摊开：随机函数不该用单次调用去判 */
function pool(topic?: string): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < 300; i++) s.add(fallbackQuestion(ctx, topic));
  return s;
}

describe("话题里有已知专名时，问句必须叫出名字", () => {
  test("**错误行为的红线**：不得再说「关于这一点」而把人名丢掉", () => {
    // 变异检验：把 anchor 分支删掉，这条立刻红。
    const qs = pool(`${NPC}比较叛逆`);
    expect(qs.size).toBeGreaterThan(1);
    for (const q of qs) expect(q).toContain(NPC);
  });

  test("**正确**：全名优先于单段名，问句不该退化成叫小名", () => {
    const full = BARN_OF_PREMIER.npcs.find((n) => n.name.includes("·"));
    if (!full) return;
    const bare = full.name.replace(/[（(].*?[）)]/g, "").trim();
    expect(topicAnchor(`${bare}失踪了`, BARN_OF_PREMIER)).toBe(bare);
  });
});

describe("话题里没有专名时，宁可抽象也不剧透", () => {
  test("**错误行为的红线**：knowledge 正文不得原样进问句", () => {
    // 这是修这个 bug 时最容易踩的坑：一看到「问句里没有话题名」
    // 就把 topic 拼进去，结果写出「关于加比比较叛逆，您还记得什么吗？」——
    // 不通顺，而且提问即剧透、回答即复述。
    const raw = "镇上最近有多起失踪案，警察压着不让说";
    const topic = extractTopic(raw);
    const qs = pool(topic);
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空（池子空了「正文不得进问句」就成了空话）
    expect(qs.size).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q).not.toContain(topic);
      expect(q).not.toContain("失踪案");
    }
  });

  test("**正确**：抽象支的池子不止一句 —— 机械感来自池子太小", () => {
    expect(pool("镇上最近不太平").size).toBeGreaterThanOrEqual(4);
    expect(pool().size).toBeGreaterThanOrEqual(3);
  });
});

describe("这是个纯函数，不该会崩", () => {
  test("**错误行为的红线**：ctx 不完整时不得抛异常", () => {
    // 原实现 `agents: [pl1, pl2]` 对 undefined 做数组解构，诊断脚本传空 ctx 直接崩。
    // 一个从池子里挑字符串的函数没有任何理由碰 agents。
    const empty = {} as unknown as SceneCtx;
    expect(() => fallbackQuestion(empty)).not.toThrow();
    expect(() => fallbackQuestion(empty, "随便什么话题")).not.toThrow();
    expect(fallbackQuestion(empty).length).toBeGreaterThan(0);
  });

  test("**干扰输入**：module 没有 npcs/scenes 时降级为抽象问句，不崩", () => {
    const bare = { module: {} } as unknown as SceneCtx;
    expect(() => fallbackQuestion(bare, `${NPC}比较叛逆`)).not.toThrow();
    expect(topicAnchor("什么话题", undefined)).toBe("");
    expect(topicAnchor("", BARN_OF_PREMIER)).toBe("");
  });
});

describe("topicAnchor 只认已知专名", () => {
  test("**正确**：模组里登记过的人名能取到", () => {
    expect(topicAnchor(`${NPC}的事`, BARN_OF_PREMIER)).toBe(NPC);
  });

  test("**错误行为的红线**：没登记过的词不得当专名", () => {
    // 不做通用中文名词抽取 —— 开放文本上按字面切词不可靠，
    // 切错就会把正文当专名塞进问句。
    expect(topicAnchor("那辆红色的卡车", BARN_OF_PREMIER)).toBe("");
    expect(topicAnchor("他昨天很反常", BARN_OF_PREMIER)).toBe("");
  });

  test("**干扰输入**：单字不算专名（避免「他」「你」这种误命中）", () => {
    const oneChar = { npcs: [{ name: "王" }], scenes: [] };
    expect(topicAnchor("王家的事", oneChar)).toBe("");
  });
});
