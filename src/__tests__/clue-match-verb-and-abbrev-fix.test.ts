// 开发·线索闸门 任务1验收——匹配器两个直接死因 bug。
//
// 背景：analysis/sim/2026-08-31-barn-action-anchor-abort.md，拖车房拿到
// 手枪后连续三次搜索全部 deny，一次骰子都没掷：
//   回合 6："陈岳仔细检查卫生间的洗漱用品和排水口，寻找异常药物或匆忙
//           丢弃的东西。" —— bug 2：uniqueAbbrevs 切穿"卫生间"内部词边界
//   回合 7："陆川仔细翻查餐桌下面和披萨盒的夹层，看有没有夹着纸条或
//           地址。" —— bug 1：SEARCH_VERB 表没有「翻查」
//
// 两句都是实跑原文，不自己编；候选用真实 BARN_OF_PREMIER 数据（加比的
// 拖车房场景，3 条线索）。
//
// bun test src/__tests__/clue-match-verb-and-abbrev-fix.test.ts

import { describe, it, expect } from "bun:test";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { decideClueMatch, matchSceneClues, type ClueMatchCandidate } from "../investigation/clue-match";

function toCandidate(clue: { id: string; name: string; findMethods: { description: string }[] }): ClueMatchCandidate {
  return { id: clue.id, texts: [clue.name, ...clue.findMethods.map((f) => f.description)] };
}

const trailer = BARN_OF_PREMIER.scenes.find((s) => s.id === "gabi_trailer")!;
const group = trailer.clues.map(toCandidate);

const ROUND_6 = "陈岳仔细检查卫生间的洗漱用品和排水口，寻找异常药物或匆忙丢弃的东西。";
const ROUND_7 = "陆川仔细翻查餐桌下面和披萨盒的夹层，看有没有夹着纸条或地址。";

describe("实跑原文：回合 6/7 不再 deny，正确解析到对应线索", () => {
  it("回合 6（卫生间，bug 2）resolve 到 clue_drugs", () => {
    expect(decideClueMatch(ROUND_6, group)).toEqual({ kind: "resolve", clueId: "clue_drugs" });
  });

  it("回合 7（餐桌，bug 1「翻查」）resolve 到 clue_card", () => {
    expect(decideClueMatch(ROUND_7, group)).toEqual({ kind: "resolve", clueId: "clue_card" });
  });
});

describe("bug 1：动词表补「翻查」——不同的调查动词都能触发同一个位置信号", () => {
  // 用真实拖车房数据（clue_card 的描述是"宣言仔细检查餐桌：可以发现在
  // 披萨盒下面有一张小卡片"，去动词后剩"宣言仔细餐桌"，唯一后缀是
  // "餐桌"）——不用自己造的极短候选，那种候选的截断算法边界与本轮
  // 真正要修的形状不一样（见 uniqueAbbrevList 那段实现注释）。
  it.each(["翻查", "翻看", "扒开", "掀开", "摸索", "找找", "瞧瞧"])(
    "「%s餐桌」命中 clue_card（新补的近亲动词）",
    (verb) => {
      expect(matchSceneClues(`${verb}餐桌`, group).hit).toBe("clue_card");
    },
  );
});

describe("bug 2：uniqueAbbrevs 不再切穿名词内部——「卫生间」不会被切成「生间」", () => {
  const candidates: ClueMatchCandidate[] = [
    { id: "clue_drugs", texts: ["毒品", "侦查卫生间/仔细检查洗漱用具"] },
    { id: "clue_pistol", texts: ["黑袋子中的手枪", "侦查休息区/仔细检查床底"] },
    { id: "clue_card", texts: ["奇怪的卡片", "侦查餐厅/宣言仔细检查餐桌：可以发现在披萨盒下面有一张小卡片"] },
  ];

  it("玩家用不同于描述里的动词（「检查」而非「侦查」）依旧命中卫生间那条线索", () => {
    // 这正是原始 bug 的触发条件——玩家换了个动词，导致精确子串匹配
    // （原文两个方向的 keys.filter）都对不上，必须靠简称才能命中；
    // 简称若切穿了词内部（"生间"），邻接判定就会失败。
    const r = matchSceneClues("检查卫生间", candidates);
    expect(r.hit).toBe("clue_drugs");
  });

  it("trace 里能看到完整的「卫生间」简称候选——注释声称过这个行为，现在是真的", () => {
    // ⚠ 不断言"生间"完全消失：uniqueAbbrevs 本体没有改（回归红线），
    // 它仍然会算出这个截断片段；但它现在只是候选列表里一个不起作用的
    // 多余项——hasSearchIntent/isRejectedMention 两道检查都不会让它单独
    // 促成命中（上面「否定语境」那条测试已经钉住这一点），真正决定匹配
    // 结果的是同时存在的完整名词「卫生间」。
    const r = matchSceneClues("检查卫生间", candidates);
    const drugsCandidate = r.trace.candidates.find((c) => c.id === "clue_drugs")!;
    expect(drugsCandidate.keys).toContain("卫生间");
  });

  it("回归：否定/已完成语境仍然正确排除（截短简称没有削弱这个判断）", () => {
    const r = matchSceneClues("侦查卫生间已经搜过了", candidates);
    expect(r.hit).not.toBe("clue_drugs");
  });
});
