// 流血什么时候造成、每轮掉多少 —— 对 CoC 7e 的口径。
//
// 改之前有两处不符：
//
//   1. **重伤必定流血**（`const bleeding = true`）。
//      而 CoC 7e 里重伤（单次伤害 ≥ 最大 HP 一半）只要求掷一次 CON，失败则昏迷；
//      **持续掉血属于「濒死」**（HP ≤ 0），每轮 1 点直到急救成功。重伤本身不带持续伤害。
//      照原样：12 点体力的调查员挨一次重伤（≥6）已掉到 6 以下，还要再被流血扣三轮 ——
//      一次重伤等于半条命再打个对折。
//
//   2. **文案与实现对不上**。`checkMajorWound` 印给玩家的是
//      「正在流血，每回合失去 1 HP 直到止血」，而实现按最大 HP 的 10% 扣 ——
//      20 点体力的人实际每轮掉 2，玩家照着那句话算不出自己的血。
//
// 改法：流血只在「这一击把人打昏」时给（接近 RAW 的倒下后失血），每轮固定 1 点。

import { describe, test, expect } from "bun:test";
import { checkMajorWound } from "../rules/coc-engine";

/** 钉住掷骰跑一次重伤判定。checkMajorWound 内部依次掷 部位/骨折/昏迷 */
function withRandom<T>(seq: number[], fn: () => T): T {
  const real = Math.random;
  let i = 0;
  Math.random = () => seq[Math.min(i++, seq.length - 1)]!;
  try { return fn(); } finally { Math.random = real; }
}

describe("重伤不再必定流血", () => {
  test("**错误行为的红线**：没被打昏的重伤不带持续流血", () => {
    // 第三个掷骰是昏迷判定（< 0.4 才昏迷），给 0.9 → 不昏迷
    const r = withRandom([0, 0.9, 0.9], () => checkMajorWound(6, 10, 4));
    expect(r.isMajorWound).toBe(true);
    expect(r.unconscious).toBe(false);
    expect(r.bleeding).toBe(false);
    expect(r.description).not.toContain("流血");
  });

  test("**正确**：被打昏时才流血 —— 那已接近 RAW 的倒下后失血", () => {
    const r = withRandom([0, 0.9, 0.1], () => checkMajorWound(6, 10, 4));
    expect(r.unconscious).toBe(true);
    expect(r.bleeding).toBe(true);
    expect(r.description).toContain("流血");
  });

  test("**干扰输入**：够不上重伤时两者都不给", () => {
    const r = withRandom([0, 0.9, 0.1], () => checkMajorWound(3, 10, 7)); // 3 < ceil(10/2)=5
    expect(r.isMajorWound).toBe(false);
    expect(r.bleeding).toBe(false);
    expect(r.unconscious).toBe(false);
  });

  test("**干扰输入**：人已经倒下（currentHp=0）不再算重伤", () => {
    // 这一掷决定的是「会不会昏过去」，人躺下了就没什么可决定的
    const r = withRandom([0, 0.9, 0.1], () => checkMajorWound(9, 10, 0));
    expect(r.isMajorWound).toBe(false);
  });
});

describe("描述里承诺的数字要与实现一致", () => {
  test("**错误行为的红线**：说「每回合失去 1 HP」就不能按百分比扣", () => {
    // 这条盯的是那句印给玩家的话。它一旦改成别的数字，
    // `game-session` 的 PER_TURN_DAMAGE 也得跟着改 —— 两处必须同时动。
    const r = withRandom([0, 0.9, 0.1], () => checkMajorWound(6, 10, 4));
    expect(r.description).toContain("每回合失去 1 HP");
  });
});
