// 战斗攻击掷的是常规难度，不是困难。
//
// 起因：实跑两局，十几次攻击**一次都没打中**。看播报才发现 ——
//
//     ➜ 亚瑟 【格斗(肉搏)】 25% 困难→12 → d100=44 → 失败
//
// `combat.ts` 里写死了 `"hard"`，**没有任何注释说明为什么**。
// CoC 7e 里普通近战/射击掷的是常规难度（对手闪避/反击另掷，构成对抗），
// hard 是留给特殊情况的。用 hard 等于把每个人的战斗技能砍半：
// 25% 的调查员实际只有 12%。
//
// 这与「重伤必定流血」是同一类偏差：把规则改严了，却没在任何地方写明
// 这是有意的设定。真要提高战斗难度，该调的是敌人属性或环境惩罚骰，
// 而不是偷偷把玩家的技能对折。

import { describe, test, expect } from "bun:test";
import { CoCEngine } from "../rules/coc-engine";

/** 钉住掷骰跑一次技能检定 */
function rollWith(value: number, diff: "regular" | "hard" | "extreme", roll: number) {
  const real = Math.random;
  try {
    Math.random = () => (roll - 1) / 100;
    return CoCEngine.skillCheck(value, diff);
  } finally { Math.random = real; }
}

describe("常规难度的阈值就是技能值本身", () => {
  test("**错误行为的红线**：技能 25、掷 24 必须算成功", () => {
    // 用 hard 的话阈值是 12，24 就成了失败 —— 那正是改之前的行为。
    const r = rollWith(25, "regular", 24);
    expect(r.roll).toBe(24);
    expect(r.isSuccess).toBe(true);
  });

  test("**正确**：掷 26 超过技能值，失败", () => {
    expect(rollWith(25, "regular", 26).isSuccess).toBe(false);
  });

  test("**干扰输入**：困难难度确实是半值 —— 规则本身没被改坏", () => {
    // 这条不是在给 hard 平反，是确认「常规 ≠ 困难」这件事仍然成立：
    // 战斗改回常规是选择用哪一档，不是把档位本身弄没了。
    expect(rollWith(25, "hard", 12).isSuccess).toBe(true);
    expect(rollWith(25, "hard", 13).isSuccess).toBe(false);
  });

  // ⚠ 这条一开始是红的，而且红出了一个**引擎 bug**：
  //   `skillCheck` 的成功等级链里有一支写成
  //       successLevel = difficulty === "regular" ? "hard" : "regular";
  //   ——**不看要求的难度**。于是极难检定掷 6（阈值只有 5）落进「≤ 半值」那一支，
  //   被判成 regular 成功。**极难难度形同虚设**：25% 的技能在极难下
  //   本该只有 5% 通过，实际有 12%。
  //   hard 没出事纯属碰巧 —— 它的阈值正好等于半值。
  //
  //   按 CoC 的模型重写了：掷一次得等级（只看骰值落在技能的哪一段），
  //   再拿等级比要求的难度。
  test("**错误行为的红线**：极难是五分之一，不能落回半值", () => {
    expect(rollWith(25, "extreme", 5).isSuccess).toBe(true);
    expect(rollWith(25, "extreme", 6).isSuccess).toBe(false);
    expect(rollWith(25, "extreme", 12).isSuccess).toBe(false); // 半值，改之前这里是「成功」
  });

  test("**正确**：成功等级只看骰值落在技能哪一段，与要求的难度无关", () => {
    // 等级要留着 —— 它决定伤害加成之类的后续。变的是「够不够这次难度」。
    expect(rollWith(25, "extreme", 12).successLevel).toBe("hard");
    expect(rollWith(25, "regular", 12).successLevel).toBe("hard");
    expect(rollWith(25, "hard", 12).successLevel).toBe("hard");
  });
});

describe("这个差别有多大", () => {
  test("25% 的战斗技能：常规能中四分之一，困难只剩八分之一", () => {
    // 把差距量出来，免得下次有人想「改回 hard 也差不多」。
    let regular = 0, hard = 0;
    for (let roll = 1; roll <= 100; roll++) {
      if (rollWith(25, "regular", roll).isSuccess) regular++;
      if (rollWith(25, "hard", roll).isSuccess) hard++;
    }
    expect(regular).toBe(25);
    expect(hard).toBe(12);
  });
});
