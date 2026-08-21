// 伤势惩罚骰：骰子数量要真的起作用，伤势要真的留存。
//
// 背景：`woundPenaltyDice()` 在 combat/wound-effects.ts 里躺了很久，
// 全仓零调用 —— 分级算得出来，但从没接到检定上。接线的同时发现
// `penaltyDie()` 写死投 2 颗十位骰，**1 个和 2 个惩罚骰掷出来一模一样**，
// 数量根本表达不出来。这两件事各有一组测试守着。

import { describe, test, expect, afterEach } from "bun:test";
import { bonusDie, penaltyDie } from "../rules/coc-engine";
import { worseWound, isMajorWound } from "../play-module";
import { calcSeverity } from "../combat/wound-effects";

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

/** 用固定序列喂 Math.random。rollD10 = floor(r*10)，个位另取一次 */
function stubRandom(seq: number[]) {
  let i = 0;
  Math.random = () => {
    if (i >= seq.length) throw new Error(`Math.random 被多取了：预期 ${seq.length} 次`);
    return seq[i++]!;
  };
}

describe("penaltyDie — 惩罚骰数量", () => {
  test("1 个惩罚骰 = 掷 2 颗十位骰取劣", () => {
    // 十位: 2, 7 → 取大 7；个位: 0 → 1
    stubRandom([0.2, 0.7, 0.0]);
    expect(penaltyDie(1)).toBe(71);
  });

  test("2 个惩罚骰 = 掷 3 颗十位骰取劣", () => {
    // 十位: 2, 7, 9 → 取大 9；个位: 0 → 1
    //
    // 这条是数量到底认不认的判据。改回写死 2 颗的实现，
    // 第三颗 0.9 会被当成个位读走，结果变成 71 —— 直接红。
    stubRandom([0.2, 0.7, 0.9, 0.0]);
    expect(penaltyDie(2)).toBe(91);
  });

  test("缺省参数与 1 个等价（老调用方行为不变）", () => {
    stubRandom([0.2, 0.7, 0.0]);
    expect(penaltyDie()).toBe(71);
  });
});

describe("bonusDie — 奖励骰数量", () => {
  test("1 个奖励骰 = 掷 2 颗十位骰取优", () => {
    // 十位: 9, 7 → 取小 7；个位: 0 → 1
    stubRandom([0.9, 0.7, 0.0]);
    expect(bonusDie(1)).toBe(71);
  });

  test("2 个奖励骰 = 掷 3 颗十位骰取优", () => {
    // 十位: 9, 7, 2 → 取小 2；个位: 0 → 1
    stubRandom([0.9, 0.7, 0.2, 0.0]);
    expect(bonusDie(2)).toBe(21);
  });
});

describe("calcSeverity — 边界取等号", () => {
  test("**恰好半血是重伤**（CoC Major Wound 是「等于或大于」）", () => {
    // 这条是惩罚骰整套机制看起来没生效的直接原因：
    // 写成 `> 0.50` 时，「10 点体力挨 5 点」这种最常见的一击恰好落在边界外，
    // 被判轻伤 → 不掷体质、不加惩罚骰。实跑三局全卡在这里。
    expect(calcSeverity(5, 10)).toBe("deep");
  });

  test("恰好 3/4 是致命伤", () => {
    expect(calcSeverity(75, 100)).toBe("grievous");
  });

  test("差一点不到半血仍是轻伤", () => {
    expect(calcSeverity(4, 10)).toBe("flesh");
    expect(calcSeverity(49, 100)).toBe("flesh");
  });

  test("四分之一以下是擦伤", () => {
    expect(calcSeverity(2, 10)).toBe("scratch");
  });
});

describe("isMajorWound 与 calcSeverity 是两条规则，别统一", () => {
  test("陷阱截肢用「大于」——恰好半值不截肢", () => {
    // 模组 trap_bear 原文：「伤害**大于**耐久半值有截肢风险」
    expect(isMajorWound(5, 10)).toBe(false);
    expect(isMajorWound(6, 10)).toBe(true);
  });

  test("同一次伤害：不截肢，但算重伤", () => {
    // 5 点打在 10 HP 上：CoC 判重伤（要掷体质、加惩罚骰），
    // 模组的截肢线却没过。两条规则同时成立，不矛盾。
    expect(isMajorWound(5, 10)).toBe(false);
    expect(calcSeverity(5, 10)).toBe("deep");
  });
});

describe("worseWound — 伤势取重不取新", () => {
  test("原先没伤就记新的", () => {
    expect(worseWound(undefined, "flesh")).toBe("flesh");
  });

  test("更重的覆盖更轻的", () => {
    expect(worseWound("flesh", "deep")).toBe("deep");
    expect(worseWound("deep", "grievous")).toBe("grievous");
  });

  test("**后来的轻伤不能盖掉先前的重伤**", () => {
    // 写成无脑覆盖的话，重伤之后擦破点皮，惩罚骰就凭空没了
    expect(worseWound("deep", "flesh")).toBe("deep");
    expect(worseWound("grievous", "scratch")).toBe("grievous");
  });

  test("同级维持原样", () => {
    expect(worseWound("deep", "deep")).toBe("deep");
  });
});
