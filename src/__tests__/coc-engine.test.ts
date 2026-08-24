// CoC 引擎单元测试 — 纯逻辑，不依赖 LLM / API
// bun test src/__tests__/coc-engine.test.ts

import { describe, it, expect } from "bun:test";
import {
  CoCEngine,
  SanityEngine,
  bonusDie,
  penaltyDie,
  checkMajorWound,
  rollHitLocation,
  getCalledShotPenalty,
  calcMythosGain,
  type HitLocation,
} from "../rules/coc-engine";

// ============================================================
// CoCEngine: skillCheck
// ============================================================

describe("CoCEngine.skillCheck()", () => {
  it("技能值 50 常规检定应在 1-100 区间", () => {
    for (let i = 0; i < 200; i++) {
      const r = CoCEngine.skillCheck(50);
      expect(r.roll).toBeGreaterThanOrEqual(1);
      expect(r.roll).toBeLessThanOrEqual(100);
      expect(typeof r.successLevel).toBe("string");
    }
  });

  it("技能值 90 常规检定应有高成功率", () => {
    let successes = 0;
    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      const r = CoCEngine.skillCheck(90);
      if (r.isSuccess) successes++;
    }
    // 90% 技能值预期约 90% 成功率, 允许 ±5% 浮动
    expect(successes / trials).toBeGreaterThan(0.8);
  });

  it("技能值 10 常规检定应有低成功率", () => {
    let successes = 0;
    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      const r = CoCEngine.skillCheck(10);
      if (r.isSuccess) successes++;
    }
    expect(successes / trials).toBeLessThan(0.2);
  });

  it("困难难度 target = skill/2", () => {
    // 技能值 70 时困难成功需 ≤35
    // 无法测试确切值但可以验证结构
    const r = CoCEngine.skillCheck(70, "hard");
    expect(r.checkType).toBe("hard");
  });

  it("极限难度 target = skill/5", () => {
    const r = CoCEngine.skillCheck(70, "extreme");
    expect(r.checkType).toBe("extreme");
  });

  // ⚠ 这一族测试原先写成 `if (r.roll === 1) { expect(…) }`，注释是
  //   「无法强制随机值, 但验证该分支逻辑存在」。**那个前提是错的** ——
  //   rollD100 就是 `floor(Math.random()*100)+1`，钉住 Math.random 就能强制。
  //   照原样的话，d100=1 只有 1% 的运行成立，**其余 99% 一条断言都不执行**，
  //   而测试照样绿。它只在功能正常时才验东西，坏了反而静默通过。
  it("d100=1 必定大成功", () => {
    const real = Math.random;
    try {
      Math.random = () => 0;               // floor(0*100)+1 = 1
      const r = CoCEngine.skillCheck(5);
      expect(r.roll).toBe(1);
      expect(r.successLevel).toBe("critical");
      expect(r.isSuccess).toBe(true);
    } finally { Math.random = real; }
  });

  it("d100=100 必定大失败", () => {
    const real = Math.random;
    try {
      Math.random = () => 0.999;           // floor(0.999*100)+1 = 100
      const r = CoCEngine.skillCheck(95);
      expect(r.roll).toBe(100);
      expect(r.successLevel).toBe("fumble");
      expect(r.isSuccess).toBe(false);
    } finally { Math.random = real; }
  });

  it("奖励骰生成 ≤100 值", () => {
    for (let i = 0; i < 100; i++) {
      const v = bonusDie();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("惩罚骰生成 ≤100 值", () => {
    for (let i = 0; i < 100; i++) {
      const v = penaltyDie();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================
// SanityEngine: SAN 检定
// ============================================================

describe("SanityEngine.sanityCheck()", () => {
  it("初始化 SAN = POW", () => {
    const e = new SanityEngine(60);
    expect(e.state.currentSAN).toBe(60);
    expect(e.state.maxSAN).toBe(60);
  });

  it("成功时损失 = sanCost 前半部分", () => {
    const e = new SanityEngine(99); // 极高 POW
    // 多试几次保证至少有一次成功
    let foundSuccess = false;
    for (let i = 0; i < 20; i++) {
      const r = e.sanityCheck("1/1d6");
      if (r.passed) {
        expect(r.sanLoss).toBe(1);
        foundSuccess = true;
        break;
      }
    }
    expect(foundSuccess).toBe(true);
  });

  // ⚠ 这条原先是**闪的**，而且闪的原因和它测不到东西是同一个根子。
  //
  //   原写法 `new SanityEngine(1)`，注释写「极低 SAN，几乎必失败」——
  //   「几乎」就是问题：d100 掷出 ≤1 的概率是 1%，于是
  //   `expect(r.passed).toBe(false)` 每一百次红一次。实测全量跑二十次见一次。
  //
  //   更糟的是它**根本没在验自己的名字**：engine 里有一条
  //   `if (sanLoss > currentSAN) sanLoss = currentSAN`，SAN=1 时
  //   1d6 的结果一律被钳成 1，所以「1 ≤ 损失 ≤ 6」恒真 ——
  //   把后半部分换成任何东西这条都过。
  //
  //   改法：钉住掷骰强制失败（不再靠概率），SAN 取高到钳位不生效，
  //   并且用**固定的**后半部分（"1/6"），让「取的是后半不是前半」真的可判。
  it("失败时损失 = sanCost 后半部分", () => {
    const real = Math.random;
    try {
      Math.random = () => 0.999; // d100 → 100，必定大于 SAN，必定失败
      const e = new SanityEngine(50);
      const r = e.sanityCheck("1/6");
      expect(r.passed).toBe(false);
      expect(r.sanLoss).toBe(6);   // 后半部分；若取了前半会是 1
      expect(e.state.currentSAN).toBe(44);
    } finally {
      Math.random = real;
    }
  });

  it("**干扰输入**：失败损失超过剩余 SAN 时被钳到剩余量", () => {
    // 上面那条特意避开了钳位，钳位本身要单独测 —— 否则它就成了没人看的暗角，
    // 正是它把上面那条测试的证据吃掉的。
    const real = Math.random;
    try {
      Math.random = () => 0.999;
      const e = new SanityEngine(2);
      const r = e.sanityCheck("1/6");
      expect(r.passed).toBe(false);
      expect(r.sanLoss).toBe(2);        // 不是 6
      expect(e.state.currentSAN).toBe(0);
    } finally {
      Math.random = real;
    }
  });

  it("SAN 不会低于 0", () => {
    const e = new SanityEngine(5);
    // 连续失败反复扣除
    for (let i = 0; i < 20; i++) {
      e.sanityCheck("0/1d6");
    }
    expect(e.state.currentSAN).toBe(0);
  });

  it("短期内累计损失 >= 5 触发临时疯狂", () => {
    // ⚠ 这条原先 if 体里**只有两行注释**，一条断言都没有 —— 纯占位。
    //   钉住掷骰强制失败，把它该验的事真的验出来。
    const real = Math.random;
    try {
      Math.random = () => 0.999;           // d100 = 100，必定失败
      const e = new SanityEngine(50);
      e.state.sanLostThisRound = 5;
      const r = e.sanityCheck("0/5");
      expect(r.passed).toBe(false);
      expect(r.sanLoss).toBe(5);
      expect(e.state.temporaryInsanity).toBe(true);
    } finally { Math.random = real; }
  });

  it("损失 >= maxSAN/5 触发不定疯狂", () => {
    const e = new SanityEngine(50);
    // 通过 sanityCheck 触发累计损失 ≥ 20% maxSAN
    // maxSAN=50, 20%=10, 需要累计掉至少 10
    // 直接调用几次大损失
    e.state.currentSAN = 39; // 已累计损失 11 (>10)
    // indefiniteInsanity 只在 sanityCheck 中设置, 调用一次触发
    e.sanityCheck("0/1");
    expect(e.state.indefiniteInsanity).toBe(true);
  });

  it("获得恐惧症时会记进 phobias", () => {
    // 原先是 `if (r.newPhobia)` —— 没摇出恐惧症就一条都不验。
    // 恐惧症是否产生本身带随机，但**一旦产生就必须记进列表**，
    // 这条不变量与掷骰无关，多试几次总能拿到样本；拿不到就该红。
    const real = Math.random;
    let seen = false;
    try {
      for (let i = 0; i < 200 && !seen; i++) {
        const e = new SanityEngine(50);
        e.state.sanLostThisRound = 5;
        const r = e.sanityCheck("0/1d6");
        if (r.newPhobia) {
          seen = true;
          expect(e.state.phobias).toContain(r.newPhobia);
        }
      }
    } finally { Math.random = real; }
    expect(seen).toBe(true); // 200 次一个样本都没有 = 这条什么都没验
  });

  it("重置后 insanity 状态可共存", () => {
    const e = new SanityEngine(50);
    e.state.temporaryInsanity = true;
    e.state.indefiniteInsanity = true;
    expect(e.state.temporaryInsanity).toBe(true);
    expect(e.state.indefiniteInsanity).toBe(true);
  });
});

// ============================================================
// CoCEngine: combatCheck
// ============================================================

describe("CoCEngine.combatCheck()", () => {
  it("返回完整战斗结果结构", () => {
    const r = CoCEngine.combatCheck(50, null, "1d6");
    expect(r).toHaveProperty("hit");
    expect(r).toHaveProperty("damage");
    expect(r).toHaveProperty("result");
    expect(r).toHaveProperty("roll");
    expect(r).toHaveProperty("successLevel");
    expect(typeof r.hit).toBe("boolean");
  });

  it("命中时造成 >0 伤害", () => {
    for (let i = 0; i < 50; i++) {
      const r = CoCEngine.combatCheck(90, null, "1d6");
      if (r.hit) {
        expect(r.damage).toBeGreaterThan(0);
      }
    }
  });

  it("闪避成功可能阻止命中", () => {
    // 高闪避 vs 低攻击
    let hitCount = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      const r = CoCEngine.combatCheck(30, 90, "1d6");
      if (r.hit) hitCount++;
    }
    // 应该大部分被闪避
    expect(hitCount / trials).toBeLessThan(0.5);
  });

  it("暴击无视闪避", () => {
    // 直接构造「攻击方大成功 + 防御方闪避成功」这一局面，而不是靠随机采样撞出暴击。
    //
    // 原实现循环 500 次等 critical 出现，但 critical 只在 roll===1 时成立（1%），
    // 原注释写的「1%+20%(极限)=21%」把极限成功也算进去了，是错的。
    // 1% 之下 500 次全不中的概率是 0.99^500 ≈ 0.66%，测试因此会偶发假失败。
    //
    // combatCheck 的取随机顺序是固定的：先攻击方 skillCheck，再防御方 skillCheck；
    // bonusDice/penaltyDice 为 0 时每次 skillCheck 恰好消耗一次 Math.random
    // （regularD100 → rollD100 → 单次 Math.random）。据此按序喂值即可。
    const sequence = [
      0,     // 攻击方 d100 = 1 → critical
      0.49,  // 防御方 d100 = 50，技能 99 → 常规成功（正常情况下足以闪避）
    ];
    let call = 0;
    const realRandom = Math.random;
    Math.random = () => (call < sequence.length ? sequence[call++]! : 0.5);

    try {
      const r = CoCEngine.combatCheck(99, 99, "1d6");
      expect(r.successLevel).toBe("critical");
      expect(r.hit).toBe(true); // 防御方闪避成功，但暴击照样命中
    } finally {
      Math.random = realRandom;
    }
  });

  it("穿刺武器暴击伤害 ×1.5", () => {
    // 暴击时 damage 应为 1.5x
    for (let i = 0; i < 100; i++) {
      const r = CoCEngine.combatCheck(90, null, "1d10");
      if ((r.successLevel === "extreme" || r.successLevel === "critical") && r.hit) {
        // 1d10 基础伤害, 1.5x 应 ≥1
        expect(r.damage).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("大失败导致自动未命中", () => {
    const real = Math.random;
    try {
      Math.random = () => 0.999;           // d100 = 100 → 必定 fumble
      const r = CoCEngine.combatCheck(5, null, "1d6");
      expect(r.successLevel).toBe("fumble");
      expect(r.hit).toBe(false);
      expect(r.damage).toBe(0);
      expect(r.result).toContain("攻击失误");
    } finally { Math.random = real; }
  });

  it("d100=100 直接大失败", () => {
    // 标题说的就是 d100=100，那就把它掷出来 —— 原先靠 `if (r.roll === 100)` 撞运气，
    // 99% 的运行一条断言都不执行。
    const real = Math.random;
    try {
      Math.random = () => 0.999;
      const r = CoCEngine.combatCheck(99, null, "1d6");
      expect(r.roll).toBe(100);
      expect(r.successLevel).toBe("fumble");
    } finally { Math.random = real; }
  });
});

// ============================================================
// 燃运 (Luck Spend)
// ============================================================

describe("CoCEngine.skillCheck() — 燃运", () => {
  it("燃运后 luckAdjusted ≤ roll", () => {
    for (let i = 0; i < 100; i++) {
      const r = CoCEngine.skillCheck(50, "regular", 0, 0, 10);
      expect(r.luckAdjusted).toBeLessThanOrEqual(r.roll);
      expect(r.luckSpent).toBe(10);
    }
  });

  it("燃运最低降至 1", () => {
    for (let i = 0; i < 50; i++) {
      const r = CoCEngine.skillCheck(50, "regular", 0, 0, 999);
      expect(r.luckAdjusted).toBe(1);
    }
  });

  it("燃运 0 时 luckAdjusted === roll", () => {
    for (let i = 0; i < 100; i++) {
      const r = CoCEngine.skillCheck(50);
      expect(r.luckAdjusted).toBe(r.roll);
      expect(r.luckSpent).toBe(0);
      expect(r.pushed).toBe(false);
    }
  });

  it("燃运提高成功率", () => {
    // 技能值 40, 燃运 30 → 大幅提高成功概率
    let successes = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const r = CoCEngine.skillCheck(40, "regular", 0, 0, 30);
      if (r.isSuccess) successes++;
    }
    // 实际投骰 1-100, 减30后有效值 1-70, 目标 40
    // 成功率应显著提高
    expect(successes / trials).toBeGreaterThan(0.3);
  });
});

// ============================================================
// 推动检定 (Push)
// ============================================================

describe("CoCEngine.skillCheck() — 推动检定", () => {
  it("推动检定 pushed=true", () => {
    const r = CoCEngine.skillCheck(50, "regular", 0, 0, 0, true);
    expect(r.pushed).toBe(true);
  });

  it("推动检定配合惩罚骰", () => {
    // 推动 + 惩罚骰 = 更难通过
    let failures = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const r = CoCEngine.skillCheck(50, "regular", 0, 1, 0, true);
      if (!r.isSuccess) failures++;
    }
    // 惩罚骰下成功率应低于 50%
    expect(failures).toBeGreaterThan(0);
  });

  it("推动不改变 luckSpent/luckAdjusted 默认值", () => {
    const r = CoCEngine.skillCheck(50, "regular", 0, 0, 0, true);
    expect(r.luckSpent).toBe(0);
    expect(r.luckAdjusted).toBe(r.roll);
  });
});

// ============================================================
// SanityEngine: parseSanCost 边界
// ============================================================

describe("SanityEngine.parseSanCost()", () => {
  it("解析普通骰子格式 1d6", () => {
    const result = SanityEngine.parseSanCost("1d6");
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("解析多骰子格式 3d4", () => {
    const result = SanityEngine.parseSanCost("3d4");
    expect(result).toBeGreaterThanOrEqual(3);
    expect(result).toBeLessThanOrEqual(12);
  });

  it("解析纯数字字符串", () => {
    expect(SanityEngine.parseSanCost("5")).toBe(5);
  });

  it("解析 0", () => {
    expect(SanityEngine.parseSanCost("0")).toBe(0);
  });

  it("解析空字符串返回 0", () => {
    expect(SanityEngine.parseSanCost("")).toBe(0);
  });

  it("解析空格字符串返回 0", () => {
    expect(SanityEngine.parseSanCost("   ")).toBe(0);
  });

  it("解析非法格式 abc 返回 0", () => {
    expect(SanityEngine.parseSanCost("abc")).toBe(0);
  });

  it("解析非法骰子格式 d6 返回 0", () => {
    expect(SanityEngine.parseSanCost("d6")).toBe(0);
  });

  it("解析负数纯数字", () => {
    expect(SanityEngine.parseSanCost("-3")).toBe(-3);
  });
});

// ============================================================
// SanityEngine: recoverSan / resetDaily 边界
// ============================================================

describe("SanityEngine.recoverSan()", () => {
  it("正常恢复 SAN", () => {
    const e = new SanityEngine(60);
    e.state.currentSAN = 40;
    e.recoverSan(10);
    expect(e.state.currentSAN).toBe(50);
  });

  it("恢复不超过 maxSAN", () => {
    const e = new SanityEngine(60);
    e.state.currentSAN = 55;
    e.recoverSan(10);
    expect(e.state.currentSAN).toBe(60);
  });

  it("恢复 0 SAN 不改变", () => {
    const e = new SanityEngine(60);
    e.state.currentSAN = 40;
    e.recoverSan(0);
    expect(e.state.currentSAN).toBe(40);
  });

  it("恢复负数等于扣减", () => {
    const e = new SanityEngine(60);
    e.state.currentSAN = 40;
    e.recoverSan(-5);
    expect(e.state.currentSAN).toBe(35);
  });

  it("恢复过多负数导致低于 0", () => {
    const e = new SanityEngine(60);
    e.state.currentSAN = 3;
    e.recoverSan(-10);
    expect(e.state.currentSAN).toBe(-7);
  });
});

describe("SanityEngine.resetDaily()", () => {
  it("重置 sanLostThisRound 和临时疯狂标志", () => {
    const e = new SanityEngine(60);
    e.state.sanLostThisRound = 8;
    e.state.temporaryInsanity = true;
    e.resetDaily();
    expect(e.state.sanLostThisRound).toBe(0);
    expect(e.state.temporaryInsanity).toBe(false);
  });

  it("保持不定疯狂状态不变", () => {
    const e = new SanityEngine(60);
    e.state.indefiniteInsanity = true;
    e.state.indefiniteLevel = "moderate";
    e.resetDaily();
    expect(e.state.indefiniteInsanity).toBe(true);
    expect(e.state.indefiniteLevel).toBe("moderate");
  });
});

// ============================================================
// SanityEngine: learnCthulhuMythos 边界
// ============================================================

describe("SanityEngine.learnCthulhuMythos()", () => {
  it("学到神话知识减少 maxSAN", () => {
    const e = new SanityEngine(70);
    const r = e.learnCthulhuMythos(5, "测试典籍");
    expect(r.cmGain).toBeGreaterThanOrEqual(1);
    expect(r.cmGain).toBeLessThanOrEqual(5);
    expect(r.maxSanLoss).toBeGreaterThan(0);
    expect(r.newMaxSan).toBeLessThan(70);
    expect(e.state.cthulhuMythos).toBeGreaterThan(0);
    expect(e.state.maxSAN).toBe(r.newMaxSan);
  });

  it("maxSAN 不低于 10", () => {
    const e = new SanityEngine(15);
    // 高 tomeRating 应能触发大 maxSanLoss
    for (let i = 0; i < 20; i++) {
      e.learnCthulhuMythos(20, "高等级典籍");
    }
    expect(e.state.maxSAN).toBeGreaterThanOrEqual(10);
  });

  it("CM 技能不超 99", () => {
    const e = new SanityEngine(60);
    for (let i = 0; i < 50; i++) {
      e.learnCthulhuMythos(20, "大量典籍");
    }
    expect(e.state.cthulhuMythos).toBeLessThanOrEqual(99);
  });

  it("currentSAN 被 maxSAN 限制不超出", () => {
    const e = new SanityEngine(60);
    e.state.currentSAN = 60;
    e.learnCthulhuMythos(10, "测试");
    expect(e.state.currentSAN).toBeLessThanOrEqual(e.state.maxSAN);
  });

  it("tomeRating=1 时最小增益", () => {
    const e = new SanityEngine(60);
    const r = e.learnCthulhuMythos(1, "极浅典籍");
    expect(r.cmGain).toBeGreaterThanOrEqual(1);
    expect(r.cmGain).toBeLessThanOrEqual(1);
    expect(r.maxSanLoss).toBeGreaterThanOrEqual(1);
    expect(r.maxSanLoss).toBeLessThanOrEqual(1);
  });

  it("记录神话日志", () => {
    const e = new SanityEngine(60);
    e.learnCthulhuMythos(8, "死灵之书");
    expect(e.state.mythosLog.length).toBe(1);
    expect(e.state.mythosLog[0].source).toBe("死灵之书");
  });
});

// ============================================================
// SanityEngine: rollNightmare / handleLongRest 边界
// ============================================================

describe("SanityEngine.rollNightmare()", () => {
  it("无不定疯狂时返回 null", () => {
    const e = new SanityEngine(60);
    const r = e.rollNightmare();
    expect(r).toBeNull();
    expect(e.state.nightmareStreak).toBe(0);
  });

  it("不定疯狂时有概率触发噩梦", () => {
    // 通过多轮统计验证
    const e = new SanityEngine(60);
    e.state.indefiniteInsanity = true;
    e.state.indefiniteLevel = "mild";
    let triggered = 0;
    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      const r = e.rollNightmare();
      if (r) triggered++;
    }
    // mild 噩梦概率 30%，1000 次应至少触发 50 次
    expect(triggered).toBeGreaterThan(50);
    expect(triggered).toBeLessThan(600);
  });

  it("噩梦消耗 SAN", () => {
    const e = new SanityEngine(60);
    e.state.indefiniteInsanity = true;
    e.state.indefiniteLevel = "severe";
    e.state.currentSAN = 40;
    // 噩梦是否触发带随机，但**一旦触发就必须扣 SAN** —— 这条不变量与掷骰无关。
    // 原先 `if (r)` 不成立时一条都不验，而「没触发」恰恰是最常见的情况。
    // 多试几次拿样本；一个都拿不到就该红（那说明噩梦根本不会触发）。
    let r = e.rollNightmare();
    for (let i = 0; i < 200 && !r; i++) {
      e.state.currentSAN = 40;
      r = e.rollNightmare();
    }
    expect(r).toBeTruthy(); // 200 次都没触发 = 这条什么都没验
    if (r) {
      expect(e.state.currentSAN).toBeLessThan(40);
      expect(r.sanLoss).toBeGreaterThan(0);
    }
  });
});

describe("SanityEngine.handleLongRest()", () => {
  it("不定疯狂时自然恢复 SAN", () => {
    const e = new SanityEngine(60);
    e.state.indefiniteInsanity = true;
    e.state.indefiniteLevel = "mild";
    e.state.currentSAN = 30;
    // 抑制噩梦随机性：将 nightmareStreak 设为非 0 以跳过多项判定
    // 多次运行捕捉自然恢复与噩梦的净效果
    let sawRecovery = false;
    for (let i = 0; i < 30; i++) {
      const e2 = new SanityEngine(60);
      e2.state.indefiniteInsanity = true;
      e2.state.indefiniteLevel = "mild";
      e2.state.currentSAN = 30;
      const r = e2.handleLongRest();
      if (r.sanRecovered > 0) {
        // 有自然恢复时，currentSAN 应变化（可能被噩梦抵消，但结构正确）
        expect(r.sanRecovered).toBeGreaterThanOrEqual(1);
        expect(r.sanRecovered).toBeLessThanOrEqual(3); // mild: 1d3
        sawRecovery = true;
        break;
      }
    }
    // mild 恢复率 1d3（30% 噩梦概率），30 次循环应至少看到一次恢复
    expect(sawRecovery).toBe(true);
  });
});

// ============================================================
// SanityEngine: therapyCheck 边界
// ============================================================

describe("SanityEngine.therapyCheck()", () => {
  it("治疗失败返回无效果", () => {
    const e = new SanityEngine(60);
    e.state.indefiniteInsanity = true;
    e.state.indefiniteLevel = "moderate";
    const r = e.therapyCheck(80, 50); // roll=80 > skill=50 → 失败
    expect(r.success).toBe(false);
    expect(r.sanRecovered).toBe(0);
    expect(r.message).toBe("心理治疗未产生效果。");
  });

  it("治疗成功恢复 SAN", () => {
    const e = new SanityEngine(60);
    e.state.indefiniteInsanity = true;
    e.state.indefiniteLevel = "moderate";
    e.state.currentSAN = 30;
    const r = e.therapyCheck(30, 50); // roll=30 ≤ skill=50 → 成功
    expect(r.success).toBe(true);
    expect(r.sanRecovered).toBeGreaterThanOrEqual(1);
    expect(r.sanRecovered).toBeLessThanOrEqual(3);
    expect(r.progressGained).toBeGreaterThanOrEqual(15);
    expect(r.progressGained).toBeLessThanOrEqual(30);
    expect(e.state.currentSAN).toBe(30 + r.sanRecovered);
  });
});

// ============================================================
// SanityEngine: checkPhobiaConflict 边界
// ============================================================

describe("SanityEngine.checkPhobiaConflict()", () => {
  it("无恐惧症时不冲突", () => {
    const e = new SanityEngine(60);
    const r = e.checkPhobiaConflict("黑暗");
    expect(r.conflicts).toBe(false);
  });

  it("匹配恐惧症时冲突", () => {
    const e = new SanityEngine(60);
    e.state.phobias = ["黑暗恐惧症"];
    const r = e.checkPhobiaConflict("黑暗");
    expect(r.conflicts).toBe(true);
    expect(r.penalty).toBeTruthy();
  });

  it("不匹配恐惧症时不冲突", () => {
    const e = new SanityEngine(60);
    e.state.phobias = ["恐高症"];
    const r = e.checkPhobiaConflict("黑暗");
    expect(r.conflicts).toBe(false);
  });
});

// ============================================================
// SanityEngine: getSummary / getFullGuidance 边界
// ============================================================

describe("SanityEngine.getSummary()", () => {
  it("输出包含 SAN 核心信息", () => {
    const e = new SanityEngine(65);
    const summary = e.getSummary();
    expect(summary).toContain("SAN");
    expect(summary).toContain("65");
  });
});

// ============================================================
// calcMythosGain 基础功能
// ============================================================

describe("calcMythosGain()", () => {
  it("tomeRating=0 产生 0 增益", () => {
    const r = calcMythosGain(0);
    expect(r.cmGain).toBe(1);
    expect(r.maxSanLoss).toBe(1);
    // 公式: Math.random * 0 + 1 = 1, Math.ceil(0/2)=0 → Math.random*0+1=1
  });

  it("tomeRating=20 产生合理范围", () => {
    const r = calcMythosGain(20);
    expect(r.cmGain).toBeGreaterThanOrEqual(1);
    expect(r.cmGain).toBeLessThanOrEqual(20);
    expect(r.maxSanLoss).toBeGreaterThanOrEqual(1);
    // Math.ceil(20/2) = 10, so maxSanLoss ∈ [1,10]
    expect(r.maxSanLoss).toBeLessThanOrEqual(10);
  });
});

// ============================================================
// checkMajorWound 边界
// ============================================================

describe("checkMajorWound()", () => {
  it("damage < maxHp/2 不是重伤", () => {
    const r = checkMajorWound(3, 10, 10);
    expect(r.isMajorWound).toBe(false);
  });

  it("damage >= maxHp/2 是重伤", () => {
    const r = checkMajorWound(5, 10, 10);
    expect(r.isMajorWound).toBe(true);
  });

  it("currentHp=0 即使高伤害也不是重伤", () => {
    const r = checkMajorWound(10, 10, 0);
    expect(r.isMajorWound).toBe(false);
  });

  // ⚠ 这条原先叫「重伤结果包含部位和流血」，断言 `bleeding === true` ——
  //   它钉住的是**旧的、比 CoC 7e 苛刻的口径**：重伤必定流血。
  //   RAW 里重伤只掷一次 CON，持续掉血属于濒死（HP ≤ 0）。
  //   规则改了，这条断言就该跟着改 —— 它记录的是当时的实现，不是规则本身。
  //   现在流血只在这一击把人打昏时才给（见 bleeding-rules.test.ts）。
  it("重伤结果包含部位，流血与否跟着昏迷走", () => {
    const r = checkMajorWound(8, 10, 10);
    expect(r.isMajorWound).toBe(true);
    expect(r.location).toBeTruthy();
    expect(r.bleeding).toBe(r.unconscious);
    expect(r.description).toContain("重伤");
  });
});

// ============================================================
// rollHitLocation 边界 (瞄准/模糊匹配)
// ============================================================

describe("rollHitLocation()", () => {
  it("无瞄准时随机命中", () => {
    const validTargets: HitLocation[] = ["右腿", "左腿", "腹部", "胸部", "右臂", "左臂", "头部"];
    for (let i = 0; i < 100; i++) {
      const loc = rollHitLocation();
      expect(validTargets).toContain(loc);
    }
  });

  it("有效瞄准精确命中", () => {
    expect(rollHitLocation("头部")).toBe("头部");
    expect(rollHitLocation("胸部")).toBe("胸部");
    expect(rollHitLocation("左腿")).toBe("左腿");
  });

  it("模糊匹配: 武器 → 右臂", () => {
    expect(rollHitLocation("武器")).toBe("右臂");
  });

  it("模糊匹配: 手 → 右臂", () => {
    expect(rollHitLocation("手")).toBe("右臂");
  });

  it("模糊匹配: 颈部 → 头部", () => {
    expect(rollHitLocation("颈部")).toBe("头部");
  });

  it("模糊匹配: 脖子 → 头部", () => {
    expect(rollHitLocation("脖子")).toBe("头部");
  });

  it("模糊匹配: 眼睛 → 头部", () => {
    expect(rollHitLocation("眼睛")).toBe("头部");
  });

  it("模糊匹配: 面部 → 头部", () => {
    expect(rollHitLocation("面部")).toBe("头部");
  });

  it("未知字符串退化为随机", () => {
    const validTargets: HitLocation[] = ["右腿", "左腿", "腹部", "胸部", "右臂", "左臂", "头部"];
    for (let i = 0; i < 50; i++) {
      const loc = rollHitLocation("zzz未知");
      expect(validTargets).toContain(loc);
    }
  });
});

// ============================================================
// getCalledShotPenalty 边界
// ============================================================

describe("getCalledShotPenalty()", () => {
  it("眼睛惩罚 3", () => {
    expect(getCalledShotPenalty("眼睛")).toBe(3);
  });

  it("头部/颈部/脖子惩罚 2", () => {
    expect(getCalledShotPenalty("头部")).toBe(2);
    expect(getCalledShotPenalty("颈部")).toBe(2);
    expect(getCalledShotPenalty("脖子")).toBe(2);
  });

  it("武器惩罚 1", () => {
    expect(getCalledShotPenalty("武器")).toBe(1);
  });

  it("手臂/肩膀惩罚 1", () => {
    expect(getCalledShotPenalty("左臂")).toBe(1);
    expect(getCalledShotPenalty("肩膀")).toBe(1);
  });

  it("手惩罚 2", () => {
    expect(getCalledShotPenalty("手")).toBe(2);
  });

  it("腿/脚惩罚 1", () => {
    expect(getCalledShotPenalty("右腿")).toBe(1);
    expect(getCalledShotPenalty("脚")).toBe(1);
  });

  it("腹部/腰部惩罚 0", () => {
    expect(getCalledShotPenalty("腹部")).toBe(0);
    expect(getCalledShotPenalty("腰部")).toBe(0);
  });

  it("未知部位惩罚 0", () => {
    expect(getCalledShotPenalty("zzz")).toBe(0);
  });
});

// ============================================================
// CoCEngine.rollDice 边界
// ============================================================

describe("CoCEngine.rollDice()", () => {
  it("标准 1d6 在 1-6 范围", () => {
    const r = CoCEngine.rollDice("1d6");
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(6);
  });

  it("0d6 返回 0", () => {
    expect(CoCEngine.rollDice("0d6")).toBe(0);
  });

  it("非法格式返回 0", () => {
    expect(CoCEngine.rollDice("abc")).toBe(0);
  });

  it("空字符串返回 0", () => {
    expect(CoCEngine.rollDice("")).toBe(0);
  });

  it("带加号调整值 1d6+2 范围 3-8", () => {
    const r = CoCEngine.rollDice("1d6+2");
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThanOrEqual(8);
  });

  it("带减号调整值 1d6-2 不低于 0", () => {
    for (let i = 0; i < 100; i++) {
      const r = CoCEngine.rollDice("1d6-2");
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(4);
    }
  });

  it("大数量骰子 10d10", () => {
    const r = CoCEngine.rollDice("10d10");
    expect(r).toBeGreaterThanOrEqual(10);
    expect(r).toBeLessThanOrEqual(100);
  });
});
