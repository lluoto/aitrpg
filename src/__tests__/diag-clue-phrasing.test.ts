// 判据校准：「玩家这句话对到场景里哪条线索」。
//
// 这份测试测的不是引擎，是判据（照 diag-phrasing.test.ts 的形状）。每条判据
// 都要求三件事同时成立：
//   1. 行为正确的输入 → 判据通过
//   2. 目标行为错误的输入 → 判据失败
//   3. 文本相似但行为合法的干扰输入 → 判据不误报
// 少了第 2 条就是"永远通过"，少了第 3 条就是"永远报警"，两种都等于没测。

import { describe, test, expect } from "bun:test";
import {
  judgeCluePhrase, addCluePhraseResult, newCluePhraseReport, pct, classifyClueFailure,
  type CluePhraseCase, type CluePhraseOutcome,
} from "../diagnostics/clue-phrasing";
import { matchSceneClues, hasSearchIntent, type ClueMatchCandidate } from "../investigation/clue-match";

// ── 判据层：只喂构造出来的结果，不碰引擎 ───────────────────────────

const positive: CluePhraseCase = {
  id: "say-key", kind: "positive", desc: "只说位置关键词",
  said: "侦查卫生间", wantClueId: "clue_drugs",
};
const negative: CluePhraseCase = {
  id: "negate", kind: "negative", desc: "否定一个目标同时指定另一个",
  said: "别搜床底了，去检查卫生间", wantClueId: "clue_drugs", forbidClueId: "clue_pistol",
};
const ambiguous: CluePhraseCase = {
  id: "vague", kind: "ambiguous", desc: "没说具体位置",
  said: "侦查", wantClueId: null,
};

describe("judgeCluePhrase — 正例", () => {
  test("正确：精确命中目标 → 通过", () => {
    const o: CluePhraseOutcome = { chosenClueId: "clue_drugs", ambiguousIds: [] };
    expect(judgeCluePhrase(positive, o).verdict).toBe("pass");
  });

  test("错误：命中了别的线索 → 失败", () => {
    const o: CluePhraseOutcome = { chosenClueId: "clue_pistol", ambiguousIds: [] };
    const j = judgeCluePhrase(positive, o);
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("clue_pistol");
  });

  test("错误：目标碰巧在候选里但没被精确选中（报成歧义）→ 仍失败", () => {
    // 这是「假绿」的入口：只看"候选里有没有它"的话，报成歧义也会被
    // 误判成命中——但歧义意味着还得再问一轮，不是"直接解析出来了"。
    const o: CluePhraseOutcome = { chosenClueId: null, ambiguousIds: ["clue_drugs", "clue_pistol"] };
    expect(judgeCluePhrase(positive, o).verdict).toBe("fail");
  });

  test("正例计入命中率分母", () => {
    expect(judgeCluePhrase(positive, { chosenClueId: "clue_drugs", ambiguousIds: [] }).countsTowardHitRate).toBe(true);
  });
});

describe("judgeCluePhrase — 反例（否定式）", () => {
  test("正确：避开被否定的目标、命中指定的那条 → 通过", () => {
    expect(judgeCluePhrase(negative, { chosenClueId: "clue_drugs", ambiguousIds: [] }).verdict).toBe("pass");
  });

  test("错误：选中了话里明确排除的那个 → 失败", () => {
    const j = judgeCluePhrase(negative, { chosenClueId: "clue_pistol", ambiguousIds: [] });
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("排除");
  });

  test("反例不计入命中率", () => {
    expect(judgeCluePhrase(negative, { chosenClueId: "clue_drugs", ambiguousIds: [] }).countsTowardHitRate).toBe(false);
  });

  test("**用例本身不成立**：被排除的和要找的是同一条线索 → 报用例坏了", () => {
    const broken: CluePhraseCase = {
      id: "self", kind: "negative", desc: "自己排除自己",
      said: "别搜卫生间，去搜卫生间", wantClueId: "clue_drugs", forbidClueId: "clue_drugs",
    };
    const j = judgeCluePhrase(broken, { chosenClueId: "clue_drugs", ambiguousIds: [] });
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("用例本身不成立");
  });
});

describe("judgeCluePhrase — 歧义输入", () => {
  test("正确：引擎诚实报出多个候选 → 通过（选哪个都不算错，因为它没擅自选）", () => {
    expect(judgeCluePhrase(ambiguous, { chosenClueId: null, ambiguousIds: ["clue_drugs", "clue_pistol"] }).verdict).toBe("pass");
  });

  test("错误：明明有歧义，引擎却精确选了一个 → 失败（是蒙对的不是听懂的）", () => {
    const j = judgeCluePhrase(ambiguous, { chosenClueId: "clue_pistol", ambiguousIds: [] });
    expect(j.verdict).toBe("fail");
  });

  test("正确：没给够信号时压根没命中（chosen=null 且 ambiguousIds 为空）也算老实 → 通过", () => {
    // ⚠ 这条判据本身曾经要求 ambiguousIds.length>=2 才算过，被
    // diag-clue-phrasing.ts 实跑抓到假红：裸的"侦查"（没给任何位置提示）
    // 合法的诚实结果就是"压根没命中"，不是"必须报出两个候选"——
    // matchSceneClues() 不负责"有没有给提示"这件事。要求它报多个候选，
    // 等于拿它没有的职责去考它。真正该守的只有"没有擅自精确选中一个"。
    const j = judgeCluePhrase(ambiguous, { chosenClueId: null, ambiguousIds: [] });
    expect(j.verdict).toBe("pass");
  });

  test("歧义输入不进命中率", () => {
    const j = judgeCluePhrase(ambiguous, { chosenClueId: null, ambiguousIds: ["a", "b"] });
    expect(j.countsTowardHitRate).toBe(false);
  });
});

describe("CluePhraseReport — 三类分开统计", () => {
  test("命中率分母只含正例", () => {
    const r = newCluePhraseReport();
    addCluePhraseResult(r, positive, { chosenClueId: "clue_drugs", ambiguousIds: [] });
    addCluePhraseResult(r, negative, { chosenClueId: "clue_drugs", ambiguousIds: [] });
    addCluePhraseResult(r, ambiguous, { chosenClueId: null, ambiguousIds: ["a", "b"] });
    expect(r.hitRate).toEqual({ hit: 1, total: 1 });
    expect(r.negative).toEqual({ hit: 1, total: 1 });
    expect(r.ambiguous).toEqual({ hit: 1, total: 1 });
    expect(pct(r.hitRate)).toBe("100.0%");
  });
});

// ── 失败成因分类 ─────────────────────────────────────────────

describe("classifyClueFailure — 说得出为什么没对上", () => {
  const want: CluePhraseCase = { id: "x", kind: "positive", desc: "", said: "", wantClueId: "clue_drugs" };

  test("一个键都没命中 → no-key（该加同义词/切词方式太窄）", () => {
    expect(classifyClueFailure(want, { chosenClueId: "clue_pistol", ambiguousIds: [], matched: [] })).toBe("no-key");
  });

  test("只命中了别处的键 → rival-only（子串比对认错了人）", () => {
    const o: CluePhraseOutcome = {
      chosenClueId: "clue_pistol", ambiguousIds: [],
      matched: [{ clueId: "clue_pistol", key: "床底" }],
    };
    expect(classifyClueFailure(want, o)).toBe("rival-only");
  });

  test("自己和别处都命中 → ambiguous", () => {
    const o: CluePhraseOutcome = {
      chosenClueId: null, ambiguousIds: ["clue_drugs", "clue_pistol"],
      matched: [{ clueId: "clue_drugs", key: "卫生间" }, { clueId: "clue_pistol", key: "床底" }],
    };
    expect(classifyClueFailure(want, o)).toBe("ambiguous");
  });

  test("命中了自己却没被精确选中 → forced-hit（蒙对的不是听懂的）", () => {
    const o: CluePhraseOutcome = {
      chosenClueId: null, ambiguousIds: ["clue_drugs"],
      matched: [{ clueId: "clue_drugs", key: "卫生间" }],
    };
    expect(classifyClueFailure(want, o)).toBe("forced-hit");
  });
});

// ── 端到端：真的过一遍 matchSceneClues ──────────────────────────

const barnClues: ClueMatchCandidate[] = [
  { id: "clue_pistol", texts: ["黑袋子中的手枪", "侦查休息区/仔细检查床底"] },
  { id: "clue_drugs", texts: ["毒品", "侦查卫生间/仔细检查洗漱用具"] },
  { id: "clue_card", texts: ["奇怪的卡片", "侦查餐厅/宣言仔细检查餐桌：可以发现在披萨盒下面有一张小卡片"] },
];

function run(said: string, candidates: ClueMatchCandidate[]): CluePhraseOutcome {
  const r = matchSceneClues(said, candidates);
  return {
    chosenClueId: r.hit,
    ambiguousIds: r.ambiguous,
    matched: r.trace.matched.map((m) => ({ clueId: m.id, key: m.key })),
  };
}

describe("端到端 — 加比的拖车房三条线索（实跑症状的真实数据）", () => {
  test("「侦查卫生间」精确命中毒品线索", () => {
    const c: CluePhraseCase = { id: "p1", kind: "positive", desc: "位置关键词", said: "侦查卫生间", wantClueId: "clue_drugs" };
    expect(judgeCluePhrase(c, run(c.said, barnClues)).verdict).toBe("pass");
  });

  test("「侦查餐厅」精确命中卡片线索", () => {
    const c: CluePhraseCase = { id: "p2", kind: "positive", desc: "位置关键词", said: "侦查餐厅", wantClueId: "clue_card" };
    expect(judgeCluePhrase(c, run(c.said, barnClues)).verdict).toBe("pass");
  });

  test("「侦查床底」精确命中手枪线索——不带 / 的自由文本 description 内嵌关键词也要能匹配", () => {
    const c: CluePhraseCase = { id: "p3", kind: "positive", desc: "位置关键词", said: "侦查床底", wantClueId: "clue_pistol" };
    expect(judgeCluePhrase(c, run(c.said, barnClues)).verdict).toBe("pass");
  });

  test("**判据不是一味放行**：目标不对时照样失败", () => {
    const c: CluePhraseCase = { id: "p1", kind: "positive", desc: "位置关键词", said: "侦查卫生间", wantClueId: "clue_drugs" };
    expect(judgeCluePhrase(c, { chosenClueId: "clue_pistol", ambiguousIds: [] }).verdict).toBe("fail");
  });

  test("说不沾边的地点 → 三条都不命中（既不是精确命中也不是歧义）", () => {
    const r = matchSceneClues("侦查衣柜", barnClues);
    expect(r.hit).toBeNull();
    expect(r.ambiguous).toEqual([]);
  });
});

describe("hasSearchIntent — 简称必须紧跟调查动词", () => {
  test("**正确**：紧跟调查动词的简称算数", () => {
    expect(hasSearchIntent("侦查卫生间", "卫生间")).toBe(true);
    expect(hasSearchIntent("检查卫生间", "卫生间")).toBe(true);
  });

  test("**错误行为的红线**：光提一嘴不算——「卫生间坏了」不该被当成要搜这里", () => {
    expect(hasSearchIntent("卫生间坏了，得叫人来修", "卫生间")).toBe(false);
  });

  test("**干扰**：动词在更远的地方，不紧邻也不算数", () => {
    expect(hasSearchIntent("我们侦查了一圈，卫生间那边看着挺干净", "卫生间")).toBe(false);
  });
});

// ── 判据本身的变异检验 ──────────────────────────────────────────
//
// 要求：把匹配逻辑改坏（比如退回"取第一条"），确认判据变红；再还原。
// 判据不能区分对错两种情形就不算数。这里不改生产代码，直接构造一个
// "取第一条"的 mock Outcome 喂给判据，模拟改坏之后的行为。

describe("变异检验 — 判据能不能抓住「退回取第一条」这种改坏", () => {
  test("模拟退回旧行为（不管说什么都给候选里第一条）→ 判据必须报失败", () => {
    // 旧行为：不管玩家说什么，永远给 candidates[0]（这里是 clue_pistol）。
    const alwaysFirst = (_said: string): CluePhraseOutcome => ({ chosenClueId: "clue_pistol", ambiguousIds: [] });

    const cases: CluePhraseCase[] = [
      { id: "p1", kind: "positive", desc: "位置关键词", said: "侦查卫生间", wantClueId: "clue_drugs" },
      { id: "p2", kind: "positive", desc: "位置关键词", said: "侦查餐厅", wantClueId: "clue_card" },
    ];
    for (const c of cases) {
      const j = judgeCluePhrase(c, alwaysFirst(c.said));
      expect(j.verdict).toBe("fail");
    }
  });

  test("对照：真实实现（matchSceneClues）在同一批用例上必须通过——证明判据不是无差别报红", () => {
    const cases: CluePhraseCase[] = [
      { id: "p1", kind: "positive", desc: "位置关键词", said: "侦查卫生间", wantClueId: "clue_drugs" },
      { id: "p2", kind: "positive", desc: "位置关键词", said: "侦查餐厅", wantClueId: "clue_card" },
    ];
    for (const c of cases) {
      expect(judgeCluePhrase(c, run(c.said, barnClues)).verdict).toBe("pass");
    }
  });

  test("模拟「歧义时随手选第一个候选」的改坏 → ambiguous 类用例必须报失败", () => {
    const pickFirstOnAmbiguity = (): CluePhraseOutcome => ({ chosenClueId: "clue_pistol", ambiguousIds: [] });
    const c: CluePhraseCase = { id: "amb", kind: "ambiguous", desc: "没说具体位置", said: "侦查", wantClueId: null };
    expect(judgeCluePhrase(c, pickFirstOnAmbiguity()).verdict).toBe("fail");
  });
});
