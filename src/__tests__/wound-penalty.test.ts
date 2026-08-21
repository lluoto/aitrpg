// 伤势惩罚骰：骰子数量要真的起作用，伤势要真的留存。
//
// 背景：`woundPenaltyDice()` 在 combat/wound-effects.ts 里躺了很久，
// 全仓零调用 —— 分级算得出来，但从没接到检定上。接线的同时发现
// `penaltyDie()` 写死投 2 颗十位骰，**1 个和 2 个惩罚骰掷出来一模一样**，
// 数量根本表达不出来。这两件事各有一组测试守着。

import { describe, test, expect, afterEach } from "bun:test";
import { bonusDie, penaltyDie } from "../rules/coc-engine";
import { worseWound } from "../play-module";

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
