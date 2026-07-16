import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COC_HOOKS,
  PULP_COC_HOOKS,
  getRulesetMod,
  registerRulesetMod,
  checkTalentRequirements,
  applyTalentToCombat,
  PULP_TALENTS,
} from "../rules/coc-ruleset-mod";
import type { CombatCheckResult } from "../rules/coc-engine";

// ============================================================
// 默认 CoC 7e Hooks
// ============================================================
describe("默认 CoC 7e Hooks", () => {
  test("calcMaxHP = CON", () => {
    expect(DEFAULT_COC_HOOKS.calcMaxHP!(50)).toBe(50);
    expect(DEFAULT_COC_HOOKS.calcMaxHP!(80)).toBe(80);
    expect(DEFAULT_COC_HOOKS.calcMaxHP!(12)).toBe(12);
  });

  test("重伤阈值 = ceil(maxHP/2)", () => {
    expect(DEFAULT_COC_HOOKS.majorWoundThreshold!(12)).toBe(6);
    expect(DEFAULT_COC_HOOKS.majorWoundThreshold!(15)).toBe(8);
  });

  test("SAN 周恢复 = 1d3", () => {
    for (let i = 0; i < 50; i++) {
      const v = DEFAULT_COC_HOOKS.sanWeeklyRecovery!();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  test("典籍 SAN 乘数 = 1.0", () => {
    expect(DEFAULT_COC_HOOKS.tomeSanMultiplier).toBe(1.0);
  });

  test("最大 SAN = 99 - CM", () => {
    expect(DEFAULT_COC_HOOKS.calcMaxSAN!(50, 10)).toBe(89);
    expect(DEFAULT_COC_HOOKS.calcMaxSAN!(60, 0)).toBe(99);
    expect(DEFAULT_COC_HOOKS.calcMaxSAN!(50, 99)).toBe(0);
  });

  test("每轮闪避 1 次", () => {
    expect(DEFAULT_COC_HOOKS.maxDodgesPerRound).toBe(1);
  });

  test("不允许双武器", () => {
    expect(DEFAULT_COC_HOOKS.allowDualWielding).toBe(false);
  });

  test("技能上限 99", () => {
    expect(DEFAULT_COC_HOOKS.maxSkill).toBe(99);
  });
});

// ============================================================
// Pulp Cthulhu Hooks
// ============================================================
describe("Pulp Cthulhu Hooks", () => {
  test("calcMaxHP = CON + ceil(CON/2)", () => {
    // CON 50 → 50 + 25 = 75
    expect(PULP_COC_HOOKS.calcMaxHP!(50)).toBe(75);
    // CON 80 → 80 + 40 = 120
    expect(PULP_COC_HOOKS.calcMaxHP!(80)).toBe(120);
    // CON 12 → 12 + 6 = 18
    expect(PULP_COC_HOOKS.calcMaxHP!(12)).toBe(18);
    // CON 1 → 1 + 1 = 2
    expect(PULP_COC_HOOKS.calcMaxHP!(1)).toBe(2);
  });

  test("Pulp HP 比标准高 50%", () => {
    for (let con = 10; con <= 90; con += 10) {
      const normal = DEFAULT_COC_HOOKS.calcMaxHP!(con);
      const pulp = PULP_COC_HOOKS.calcMaxHP!(con);
      expect(pulp).toBeGreaterThan(normal);
      // 大约 1.5 倍
      expect(pulp / normal).toBeCloseTo(1.5, 0);
    }
  });

  test("重伤阈值 = ceil(maxHP/4)", () => {
    const pulpHP = PULP_COC_HOOKS.calcMaxHP!(50); // 75
    const threshold = PULP_COC_HOOKS.majorWoundThreshold!(pulpHP);
    expect(threshold).toBe(19); // ceil(75/4)=19
  });

  test("SAN 周恢复 = 1d8 + 2", () => {
    for (let i = 0; i < 50; i++) {
      const v = PULP_COC_HOOKS.sanWeeklyRecovery!();
      expect(v).toBeGreaterThanOrEqual(3); // 1+2
      expect(v).toBeLessThanOrEqual(10); // 8+2
    }
  });

  test("典籍 SAN 乘数 = 0.5", () => {
    expect(PULP_COC_HOOKS.tomeSanMultiplier).toBe(0.5);
  });

  test("每轮可闪避 3 次", () => {
    expect(PULP_COC_HOOKS.maxDodgesPerRound).toBe(3);
  });

  test("允许双武器，-1 惩罚骰", () => {
    expect(PULP_COC_HOOKS.allowDualWielding).toBe(true);
    expect(PULP_COC_HOOKS.dualWieldPenalty).toBe(1);
  });

  test("技能上限 110", () => {
    expect(PULP_COC_HOOKS.maxSkill).toBe(110);
  });
});

// ============================================================
// 规则集注册表
// ============================================================
describe("规则集注册表", () => {
  test("getRulesetMod 返回标准 CoC", () => {
    const mod = getRulesetMod("coc7e");
    expect(mod.id).toBe("coc7e");
    expect(mod.label).toBe("克苏鲁的呼唤 7 版");
  });

  test("getRulesetMod 返回 Pulp", () => {
    const mod = getRulesetMod("pulpcoc");
    expect(mod.id).toBe("pulpcoc");
    expect(mod.label).toBe("Pulp Cthulhu");
  });

  test("未知规则集回退到标准 CoC", () => {
    const mod = getRulesetMod("unknown_ruleset");
    expect(mod.id).toBe("coc7e");
  });

  test("registerRulesetMod 注册自定义规则集", () => {
    registerRulesetMod("test_mod", {
      id: "test_mod",
      label: "测试模组",
      calcMaxHP: () => 999,
    });
    const mod = getRulesetMod("test_mod");
    expect(mod.label).toBe("测试模组");
    expect(mod.calcMaxHP!(50)).toBe(999);
  });
});

// ============================================================
// Pulp 天赋系统
// ============================================================
describe("Pulp 天赋系统", () => {
  test("PULP_TALENTS 有 10 个天赋", () => {
    expect(PULP_TALENTS.length).toBe(10);
  });

  test("所有天赋有完整字段", () => {
    for (const t of PULP_TALENTS) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(["战斗", "调查", "通用", "社交", "生存"]).toContain(t.category);
      expect(t.effect).toBeTruthy();
    }
  });

  test("各分类至少有一个天赋", () => {
    const categories = new Set(PULP_TALENTS.map(t => t.category));
    expect(categories.has("战斗")).toBe(true);
    expect(categories.has("调查")).toBe(true);
    expect(categories.has("通用")).toBe(true);
    expect(categories.has("社交")).toBe(true);
    expect(categories.has("生存")).toBe(true);
  });

  test("checkTalentRequirements - 满足条件", () => {
    const talent = PULP_TALENTS.find(t => t.id === "fighter")!;
    const result = checkTalentRequirements(
      talent,
      { STR: 70, DEX: 50, CON: 65 },
      {},
      [],
    );
    expect(result.satisfied).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  test("checkTalentRequirements - 不满足 STR", () => {
    const talent = PULP_TALENTS.find(t => t.id === "fighter")!;
    const result = checkTalentRequirements(
      talent,
      { STR: 40, DEX: 50, CON: 65 },
      {},
      [],
    );
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some(r => r.includes("STR"))).toBe(true);
  });

  test("checkTalentRequirements - 不满足技能", () => {
    const talent = PULP_TALENTS.find(t => t.id === "medic")!;
    const result = checkTalentRequirements(
      talent,
      { STR: 50, DEX: 50, CON: 50 },
      { "急救": 30 },
      [],
    );
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some(r => r.includes("急救"))).toBe(true);
  });

  test("checkTalentRequirements - 满足技能条件", () => {
    const talent = PULP_TALENTS.find(t => t.id === "medic")!;
    const result = checkTalentRequirements(
      talent,
      { STR: 50, DEX: 50, CON: 50 },
      { "急救": 60 },
      [],
    );
    expect(result.satisfied).toBe(true);
  });

  test("无需求的天赋直接满足", () => {
    const talents = PULP_TALENTS.filter(t => !t.requirements);
    for (const t of talents) {
      const result = checkTalentRequirements(t, {}, {}, []);
      expect(result.satisfied).toBe(true);
    }
  });
});

describe("天赋战斗修正", () => {
  test("斗士天赋近战伤害+2", () => {
    const result: CombatCheckResult = {
      hit: true, damage: 6, result: "命中", roll: 50,
      successLevel: "regular", skillValue: 60,
      hitLocation: "胸部", isImpale: false, isCritical: false,
    };
    const fighter = PULP_TALENTS.find(t => t.id === "fighter")!;
    const modified = applyTalentToCombat(result, [fighter], true);
    expect(modified.damage).toBe(8); // 6 + 2
  });

  test("斗士天赋不影响远程", () => {
    const result: CombatCheckResult = {
      hit: true, damage: 6, result: "命中", roll: 50,
      successLevel: "regular", skillValue: 60,
      hitLocation: "胸部", isImpale: false, isCritical: false,
    };
    const fighter = PULP_TALENTS.find(t => t.id === "fighter")!;
    const modified = applyTalentToCombat(result, [fighter], false);
    expect(modified.damage).toBe(6); // 不受影响
  });

  test("多个天赋可叠加", () => {
    const result: CombatCheckResult = {
      hit: true, damage: 6, result: "命中", roll: 50,
      successLevel: "regular", skillValue: 60,
      hitLocation: "胸部", isImpale: false, isCritical: false,
    };
    const fighter = PULP_TALENTS.find(t => t.id === "fighter")!;
    const tough = PULP_TALENTS.find(t => t.id === "tough")!;
    const modified = applyTalentToCombat(result, [fighter, tough], true);
    expect(modified.damage).toBe(8); // 6 + 2 斗士，tough 不增伤
  });
});

// ============================================================
// 端到端场景
// ============================================================
describe("端到端场景", () => {
  test("标准 CoC 角色 vs Pulp 角色 HP 差距", () => {
    const con = 60;
    const normalHP = DEFAULT_COC_HOOKS.calcMaxHP!(con);
    const pulpHP = PULP_COC_HOOKS.calcMaxHP!(con);
    expect(pulpHP).toBe(90);  // 60 + 30
    expect(normalHP).toBe(60);
    expect(pulpHP).toBe(90);
    expect(pulpHP / normalHP).toBeCloseTo(1.5, 0);
  });

  test("Pulp 角色重伤判定阈值更低但 HP 更多", () => {
    const con = 50;
    const pulpHP = PULP_COC_HOOKS.calcMaxHP!(con); // 75
    const pulpThreshold = PULP_COC_HOOKS.majorWoundThreshold!(pulpHP); // ceil(75/4)=19

    const normalHP = DEFAULT_COC_HOOKS.calcMaxHP!(con); // 50
    const normalThreshold = DEFAULT_COC_HOOKS.majorWoundThreshold!(normalHP); // ceil(50/2)=25

    // Pulp 重伤阈值更低（更容易触发）
    expect(pulpThreshold).toBeLessThan(normalThreshold);
    // 但 Pulp 总 HP 更多
    expect(pulpHP).toBeGreaterThan(normalHP);
  });

  test("Pulp 角色恢复更快", () => {
    // SAN 恢复
    let pulpTotal = 0, normalTotal = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      pulpTotal += PULP_COC_HOOKS.sanWeeklyRecovery!();
      normalTotal += DEFAULT_COC_HOOKS.sanWeeklyRecovery!();
    }
    const pulpAvg = pulpTotal / iterations;
    const normalAvg = normalTotal / iterations;
    expect(pulpAvg).toBeGreaterThan(normalAvg); // 6.5 vs 2
  });

  test("Pulp 侦探角色完整构建", () => {
    const con = 60;
    const hp = PULP_COC_HOOKS.calcMaxHP!(con);
    expect(hp).toBe(90);

    // 天赋：警觉 + 神射手
    const alertTalent = PULP_TALENTS.find(t => t.id === "alert")!;
    const sharpshooter = PULP_TALENTS.find(t => t.id === "sharpshooter")!;

    const checkAlert = checkTalentRequirements(alertTalent, { DEX: 65, STR: 40, CON: 50 }, {}, []);
    expect(checkAlert.satisfied).toBe(true);

    const checkSharpshooter = checkTalentRequirements(sharpshooter, { DEX: 65, STR: 40, CON: 50 }, {}, []);
    expect(checkSharpshooter.satisfied).toBe(true);

    // 双武器 .45 自动手枪 + 猎刀
    expect(PULP_COC_HOOKS.allowDualWielding).toBe(true);
    expect(PULP_COC_HOOKS.dualWieldPenalty).toBe(1);
  });
});
