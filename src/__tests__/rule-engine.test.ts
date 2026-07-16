// RuleEngine 单元测试 — D&D 5e 核心规则
// bun test src/__tests__/rule-engine.test.ts

import { describe, it, expect, beforeAll } from "bun:test";
import { RuleEngine } from "../engine/rule-engine";

let re: RuleEngine;

beforeAll(() => {
  re = new RuleEngine();
});

// ============================================================
// Dice
// ============================================================

describe("RuleEngine.roll()", () => {
  it("1d20 范围 1-20", () => {
    for (let i = 0; i < 200; i++) {
      const r = re.roll("1d20");
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(20);
    }
  });

  it("2d6 范围 2-12", () => {
    for (let i = 0; i < 100; i++) {
      const r = re.roll("2d6");
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(12);
    }
  });

  it("1d6+3 范围 4-9", () => {
    for (let i = 0; i < 100; i++) {
      const r = re.roll("1d6+3");
      expect(r).toBeGreaterThanOrEqual(4);
      expect(r).toBeLessThanOrEqual(9);
    }
  });
});

describe("RuleEngine.rollWithAdvantage()", () => {
  it("返回 2 个骰子和最终结果", () => {
    for (let i = 0; i < 50; i++) {
      const r = re.rollWithAdvantage();
      expect(r.rolls).toHaveLength(2);
      expect(r.result).toBe(Math.max(r.rolls[0], r.rolls[1]));
    }
  });
});

describe("RuleEngine.rollWithDisadvantage()", () => {
  it("取两个中较小值", () => {
    for (let i = 0; i < 50; i++) {
      const r = re.rollWithDisadvantage();
      expect(r.rolls).toHaveLength(2);
      expect(r.result).toBe(Math.min(r.rolls[0], r.rolls[1]));
    }
  });
});

// ============================================================
// abilityMod / spellSaveDC
// ============================================================

describe("RuleEngine.abilityMod()", () => {
  it("10 → 0", () => expect(re.abilityMod(10)).toBe(0));
  it("14 → +2", () => expect(re.abilityMod(14)).toBe(2));
  it("8 → -1", () => expect(re.abilityMod(8)).toBe(-1));
  it("20 → +5", () => expect(re.abilityMod(20)).toBe(5));
  it("3 → -4", () => expect(re.abilityMod(3)).toBe(-4)); // floor((3-10)/2) = floor(-3.5) = -4
  it("1 → -5", () => expect(re.abilityMod(1)).toBe(-5));
  it("30 → +10", () => expect(re.abilityMod(30)).toBe(10));
});

describe("RuleEngine.spellSaveDC()", () => {
  it("prof=2, mod=3 → DC 13", () => expect(re.spellSaveDC(2, 3)).toBe(13));
  it("prof=3, mod=5 → DC 16", () => expect(re.spellSaveDC(3, 5)).toBe(16));
  it("prof=2, mod=-1 → DC 9", () => expect(re.spellSaveDC(2, -1)).toBe(9));
});

// ============================================================
// adjudicateSave
// ============================================================

describe("RuleEngine.adjudicateSave()", () => {
  it("返回完整 SaveResult 结构", () => {
    const r = re.adjudicateSave("dexterity", 15, 14, false);
    expect(r).toHaveProperty("ability", "dexterity");
    expect(r).toHaveProperty("abilityLabel");
    expect(typeof r.roll).toBe("number");
    expect(typeof r.total).toBe("number");
    expect(typeof r.success).toBe("boolean");
    expect(typeof r.critical).toBe("boolean");
    expect(typeof r.fumble).toBe("boolean");
  });

  it("熟练项增加 total（固定投骰值验证逻辑结构）", () => {
    // 不能直接比较两次独立调用(骰子不同), 改验证熟练标记和 mod 结构
    const r = re.adjudicateSave("strength", 15, 14, true);
    expect(r.proficient).toBe(true);
    expect(r.proficiencyBonus).toBe(2);
    expect(r.total).toBe(r.roll + r.mod + r.proficiencyBonus);
    // 不加熟练确保 total 不含 prof bonus
    const r2 = re.adjudicateSave("strength", 15, 14, false);
    expect(r2.proficient).toBe(false);
    expect(r2.proficiencyBonus).toBe(0);
    expect(r2.total).toBe(r2.roll + r2.mod);
  });

  it("属性值影响 mod", () => {
    const low = re.adjudicateSave("constitution", 15, 8, false);
    const high = re.adjudicateSave("constitution", 15, 18, false);
    expect(low.mod).toBe(-1);
    expect(high.mod).toBe(4);
  });

  it("DC 对比正确", () => {
    // DC=5, 属性=14, 不加熟练: roll + 2 ≥ 5 → roll ≥ 3 即成功
    // 概率很高但不绝对, 验证结构
    for (let i = 0; i < 50; i++) {
      const r = re.adjudicateSave("dexterity", 5, 14, false);
      if (r.roll >= 3) expect(r.success).toBe(true);
      else expect(r.success).toBe(false);
    }
  });

  it("高 DC 导致较低成功率", () => {
    let successes = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const r = re.adjudicateSave("intelligence", 25, 10, false); // DC25, mod=0
      if (r.success) successes++;
    }
    // DC25 > d20 最大值(20), 不加熟练不可能成功
    expect(successes).toBe(0);
  });

  it("自然 20 标记 critical", () => {
    for (let i = 0; i < 500; i++) {
      const r = re.adjudicateSave("wisdom", 100, 10, false); // DC 不可能, 排除自然20外
      if (r.roll === 20) {
        expect(r.critical).toBe(true);
        break;
      }
    }
  });

  it("自然 1 标记 fumble", () => {
    for (let i = 0; i < 500; i++) {
      const r = re.adjudicateSave("charisma", 5, 20, true); // 极高成功率, 排除自然1外
      if (r.roll === 1) {
        expect(r.fumble).toBe(true);
        break;
      }
    }
  });

  it("优势时取两个中较大值", () => {
    // 优势取高: 期望值提高
    let advSum = 0;
    let normSum = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      advSum += re.adjudicateSave("strength", 10, 10, false, 2, true, false).roll;
      normSum += re.adjudicateSave("strength", 10, 10, false).roll;
    }
    expect(advSum / trials).toBeGreaterThan(normSum / trials);
  });

  it("劣势时取两个中较小值", () => {
    let disSum = 0;
    let normSum = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      disSum += re.adjudicateSave("strength", 10, 10, false, 2, false, true).roll;
      normSum += re.adjudicateSave("strength", 10, 10, false).roll;
    }
    expect(disSum / trials).toBeLessThan(normSum / trials);
  });

  it("内置武器数据可查询", () => {
    const w = re.getWeapon("shortsword");
    expect(w).toBeDefined();
    expect(w?.dice).toBe("1d6");
    expect(w?.damage_type).toBe("piercing");
  });

  it("内置生物数据可查询", () => {
    const c = re.getCreature("goblin");
    expect(c).toBeDefined();
    expect(c?.ac).toBe(15);
  });
});
