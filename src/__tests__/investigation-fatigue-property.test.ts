// 世界属性注册表的第一个真实属性：调查疲劳惩罚（investigation_fatigue_penalty）。
// 数据源：forensic_rules.yaml §八「用眼过度——技能惩罚系统」。
//
// 这份测试同时验证两件事：
//   1. 属性本身按声明的 scale/composition 注册正确（C1 的登记项）；
//   2. N×1 的「来源→属性」表（8 个独立来源）通过 resolvePropertyEffects()
//      正确合并——不需要任何"来源 A 遇到来源 B"的特判，这是
//      PLAN.md:745 拒绝的 N² 交互表的反面证据。

import { describe, test, expect } from "bun:test";
import {
  getWorldProperty, resolvePropertyEffects, type AbilityPropertyEffect,
} from "../rules/world-property";
import {
  INVESTIGATION_FATIGUE_PROPERTY_ID, buildFatigueEffects,
} from "../rules/investigation-fatigue-property";

describe("investigation_fatigue_penalty — 属性登记", () => {
  test("**正确**：属性已注册，scale/composition/domain/ruleset 与证伪报告一致", () => {
    const p = getWorldProperty(INVESTIGATION_FATIGUE_PROPERTY_ID);
    expect(p).toBeDefined();
    expect(p!.scale).toBe("personal");
    expect(p!.composition).toBe("additive");
    expect(p!.ruleset).toBe("cosmic-horror");
    expect(p!.domain).toEqual({ kind: "integer", min: -100, max: 100 });
  });
});

describe("resolvePropertyEffects — N×1 来源表的合并", () => {
  test("**正确**：单一来源（第 5 轮疲劳）直接生效", () => {
    const effects = buildFatigueEffects("round_5", []);
    const r = resolvePropertyEffects(effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-20);
  });

  test("**正确**：轮次疲劳 + 环境修正相加——对照原文「医学 65% -20% → 有效医学 45%」的相加口径", () => {
    // round_5(-20) + dim_light(-10) = -30
    const effects = buildFatigueEffects("round_5", ["dim_light"]);
    const r = resolvePropertyEffects(effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-30);
  });

  test("**正确**：正向修正（充足光线）与负向惩罚同时相加，不是「取更差的那个」", () => {
    // round_3(-10) + bright_light(+10) = 0——两者抵消，不是各自独立生效
    const effects = buildFatigueEffects("round_3", ["bright_light"]);
    const r = resolvePropertyEffects(effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  test("**正确**：新增一个来源只是加一行数据——不需要为「round_7 遇上 bloated」这个组合单独写分支", () => {
    // round_7(-30) + bloated(-20) + flashlight_only(-20) = -70。
    // 这条断言本身就是"能力→属性表"设计的证明：三个来源互不知道对方
    // 存在，合并逻辑完全由 additive 这一条 composition 规则驱动。
    const effects = buildFatigueEffects("round_7", ["bloated", "flashlight_only"]);
    const r = resolvePropertyEffects(effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-70);
  });

  test("**干扰**：round_1/round_2（原文明示无惩罚）不在表里，不该产生虚假的 0 值来源", () => {
    // FATIGUE_BY_ROUND 故意不收录 round_1/round_2——不是"忘了写"，
    // 是"没有效果的来源不该占一行数据"（见 investigation-fatigue-property.ts 注释）。
    const effects = buildFatigueEffects("round_1", ["bright_light"]);
    // 只有 bright_light 一个来源生效，round_1 被跳过
    expect(effects.length).toBe(1);
    expect(effects[0]!.sourceId).toBe("env:bright_light");
  });

  test("**干扰**：fresh_corpse/skeletonized 原文明示 0% 影响，不在环境表里，混进来源列表不该报错也不该产生效果", () => {
    const effects = buildFatigueEffects(undefined, ["fresh_corpse", "dim_light", "skeletonized"]);
    expect(effects.length).toBe(1); // 只有 dim_light 生效
    const r = resolvePropertyEffects(effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-10);
  });
});

describe("resolvePropertyEffects — 干扰：未知属性/空输入", () => {
  test("**应报**：引用一个没注册过的属性 id 必须拒绝，不能假装合并出一个值", () => {
    const bogus: AbilityPropertyEffect[] = [
      { sourceId: "x", propertyId: "no_such_property", value: 10, scale: "personal" },
    ];
    const r = resolvePropertyEffects(bogus);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_property");
  });

  test("**应报**：空的来源列表必须拒绝", () => {
    const r = resolvePropertyEffects([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_effects");
  });
});

describe("resolvePropertyEffects — 跨尺度不直接相加，走尺度门", () => {
  test("**错误行为的红线**：混进一个非 personal 尺度的来源，不能被直接加进总和", () => {
    // 调查疲劳是 personal 尺度属性；构造一条声称 regional 尺度的效果，
    // 验证 resolvePropertyEffects 不会把 -20（personal）和 5（regional）
    // 直接相加成 -15——那正是"永远不做跨尺度乘法/加法"要堵的洞。
    const effects: AbilityPropertyEffect[] = [
      { sourceId: "round:round_5", propertyId: INVESTIGATION_FATIGUE_PROPERTY_ID, value: -20, scale: "personal" },
      { sourceId: "env:weird_regional_thing", propertyId: INVESTIGATION_FATIGUE_PROPERTY_ID, value: 5, scale: "regional" },
    ];
    const r = resolvePropertyEffects(effects);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "cross_scale") {
      expect(r.suppression.applicable).toBe(true);
      // 不管方向，总之不是"当没这回事直接相加"
      expect(["actor_dominates", "actor_futile"]).toContain(r.suppression.outcome ?? "");
    } else {
      throw new Error("应该被判成 cross_scale，而不是别的拒绝原因");
    }
  });
});
