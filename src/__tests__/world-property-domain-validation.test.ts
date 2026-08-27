// WorldProperty.domain 声明了但从不校验——resolvePropertyEffects() 合并完
// 直接返回，越界的值悄悄流出去。这正是 apply-action.ts 头注释自己写的
// 反模式："这类域比没有域更糟：它看起来在校验"。
//
// investigation-fatigue-property.ts 声明 domain={min:-100,max:100}，现有
// 8 个来源已经能拼出 -90（round_7 -30 + bloated -20 + flashlight_only -20
// + dim_light -10 + ... 组合），再加一行数据就可能越界——本文件验证越界
// 现在会被结构化拒绝，不是抛异常，不是静默放行。

import { describe, test, expect } from "bun:test";
import {
  registerWorldProperty, resolvePropertyEffects, _clearWorldPropertyRegistry,
  type AbilityPropertyEffect,
} from "../rules/world-property";

const PROPERTY_ID = "test_domain_property";
const ENUM_PROPERTY_ID = "test_enum_property";

function setupProperties() {
  _clearWorldPropertyRegistry();
  registerWorldProperty({
    id: PROPERTY_ID,
    domain: { kind: "integer", min: -100, max: 100 },
    scale: "personal",
    composition: "additive",
    ruleset: "cosmic-horror",
  });
  registerWorldProperty({
    id: ENUM_PROPERTY_ID,
    domain: { kind: "enum", values: ["low", "medium", "high"] },
    scale: "personal",
    composition: "extremum",
    ruleset: "cosmic-horror",
  });
}

function effect(value: number, propertyId = PROPERTY_ID): AbilityPropertyEffect {
  return { sourceId: `src:${value}`, propertyId, value, scale: "personal" };
}

describe("resolvePropertyEffects — domain 校验", () => {
  test("**正确**：域内的合并结果正常通过", () => {
    setupProperties();
    const r = resolvePropertyEffects([effect(-50), effect(-30)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-80);
  });

  test("**错误行为的红线**：合并结果越过上限必须被拒绝，不能悄悄流出去", () => {
    setupProperties();
    const r = resolvePropertyEffects([effect(60), effect(60)]); // 120 > max(100)
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("value_out_of_domain");
      if (r.reason === "value_out_of_domain") {
        expect(r.value).toBe(120);
        expect(r.domain).toEqual({ kind: "integer", min: -100, max: 100 });
      }
    }
  });

  test("**错误行为的红线**：合并结果越过下限同样必须被拒绝", () => {
    setupProperties();
    const r = resolvePropertyEffects([effect(-60), effect(-60)]); // -120 < min(-100)
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("value_out_of_domain");
  });

  test("**干扰**：边界值本身（恰好 = min、恰好 = max）不能被误伤", () => {
    setupProperties();
    const atMax = resolvePropertyEffects([effect(100)]);
    expect(atMax.ok).toBe(true);
    if (atMax.ok) expect(atMax.value).toBe(100);

    const atMin = resolvePropertyEffects([effect(-100)]);
    expect(atMin.ok).toBe(true);
    if (atMin.ok) expect(atMin.value).toBe(-100);
  });

  test("**干扰**：差一点越界（min-1 / max+1）必须准确拒绝，不能因为「接近边界」就放行或误拒边界本身", () => {
    setupProperties();
    const justOver = resolvePropertyEffects([effect(101)]);
    expect(justOver.ok).toBe(false);

    const justUnder = resolvePropertyEffects([effect(-101)]);
    expect(justUnder.ok).toBe(false);
  });

  test("**正确**：真实场景——investigation_fatigue_penalty 现有 8 个来源拼出的最坏组合 -90 仍在域内", () => {
    // 不依赖 investigation-fatigue-property.ts 的注册（避免耦合两个测试
    // 文件的注册时机），直接用同样的 domain 复现"最坏组合"这个真实数字。
    setupProperties();
    // round_7(-30) + bloated(-20) + flashlight_only(-20) + dim_light(-10)... 凑够 -90
    const worst = resolvePropertyEffects([effect(-30), effect(-20), effect(-20), effect(-20)]);
    expect(worst.ok).toBe(true);
    if (worst.ok) expect(worst.value).toBe(-90);
  });

  test("**错误行为的红线**：新增第 9 个来源把最坏组合推过 -100，必须被拒绝——这正是任务描述的那个场景", () => {
    setupProperties();
    // -90 的最坏组合再加一个 -15 的假想新来源 → -105，越界
    const overflowed = resolvePropertyEffects([effect(-30), effect(-20), effect(-20), effect(-20), effect(-15)]);
    expect(overflowed.ok).toBe(false);
    if (!overflowed.ok) expect(overflowed.reason).toBe("value_out_of_domain");
  });
});

describe("resolvePropertyEffects — enum 域显式拒绝，不默默放行", () => {
  test("**错误行为的红线**：对 enum 域属性调用必须显式拒绝，不能返回一个假装合法的 number", () => {
    setupProperties();
    const r = resolvePropertyEffects([effect(1, ENUM_PROPERTY_ID)]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("enum_domain_not_supported");
      if (r.reason === "enum_domain_not_supported") {
        expect(r.domain.kind).toBe("enum");
      }
    }
  });

  test("**干扰**：enum 拒绝必须发生在 unknown_property 检查通过之后——不能把「域不支持」和「属性不存在」混成同一个拒绝原因", () => {
    setupProperties();
    const enumResult = resolvePropertyEffects([effect(1, ENUM_PROPERTY_ID)]);
    const unknownResult = resolvePropertyEffects([effect(1, "totally_unregistered")]);
    expect(enumResult.ok).toBe(false);
    expect(unknownResult.ok).toBe(false);
    if (!enumResult.ok && !unknownResult.ok) {
      expect(enumResult.reason).not.toBe(unknownResult.reason);
      expect(enumResult.reason).toBe("enum_domain_not_supported");
      expect(unknownResult.reason).toBe("unknown_property");
    }
  });
});
