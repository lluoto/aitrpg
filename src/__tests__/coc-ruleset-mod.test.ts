import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COC_HOOKS,
  getRulesetMod,
  registerRulesetMod,
} from "../rules/coc-ruleset-mod";

// 说明：内置的 Pulp 变体规则与天赋体系已删除（受限规则书内容）。
// 变体规则改由模组 / 用户提供的规则书通过 registerRulesetMod() 注入，
// 因此本文件只锁定默认钩子的抽象机制与注册表行为。

// ============================================================
// 默认 Hooks
// ============================================================
describe("默认 Hooks", () => {
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
// 注册表
// ============================================================
describe("规则集注册表", () => {
  test("getRulesetMod 返回默认规则集", () => {
    const mod = getRulesetMod("cosmic-horror");
    expect(mod.id).toBe("cosmic-horror");
    expect(mod.calcMaxHP!(50)).toBe(50);
  });

  test("未知规则集回落到默认", () => {
    const mod = getRulesetMod("unknown_ruleset");
    expect(mod.id).toBe("cosmic-horror");
  });

  test("registerRulesetMod 注册外部提供的规则集", () => {
    registerRulesetMod("external_ruleset", {
      id: "external_ruleset",
      label: "外部规则书提供",
      calcMaxHP: (con: number) => con * 2,
      maxSkill: 120,
    });
    const mod = getRulesetMod("external_ruleset");
    expect(mod.id).toBe("external_ruleset");
    expect(mod.calcMaxHP!(30)).toBe(60);
    expect(mod.maxSkill).toBe(120);
  });

  test("注册的外部规则集覆盖默认钩子值", () => {
    registerRulesetMod("override_probe", {
      id: "override_probe",
      label: "覆盖探针",
      majorWoundThreshold: (maxHP: number) => Math.ceil(maxHP / 4),
    });
    expect(getRulesetMod("override_probe").majorWoundThreshold!(12)).toBe(3);
    expect(DEFAULT_COC_HOOKS.majorWoundThreshold!(12)).toBe(6);
  });
});
