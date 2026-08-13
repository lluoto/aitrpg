// UnifiedCombatResult → CombatResult 的边界转换
// bun test src/__tests__/combat-result-adapter.test.ts

import { describe, it, expect } from "bun:test";
import { toCombatResult, type UnifiedCombatResult } from "../rules/rules-engine";

function unified(over: Partial<UnifiedCombatResult> = {}): UnifiedCombatResult {
  return {
    hit: true,
    damage: 5,
    damageType: "slashing",
    result: "wound",
    critical: false,
    details: "",
    ruleset: "dnd5e",
    ...over,
  };
}

describe("toCombatResult — 字段改名处不能丢值", () => {
  // 叙事层读的是 crit 和 damage_type。规则引擎给的是 critical 和 damageType。
  // 之前没有转换，这两个键在叙事提示词里永远是 undefined —— 暴击播报不出来。
  it("critical 落到 crit", () => {
    expect(toCombatResult(unified({ critical: true })).crit).toBe(true);
    expect(toCombatResult(unified({ critical: false })).crit).toBe(false);
  });

  it("damageType 落到 damage_type", () => {
    expect(toCombatResult(unified({ damageType: "piercing" })).damage_type).toBe("piercing");
  });

  it("命中/伤害/结果原样传递", () => {
    const r = toCombatResult(unified({ hit: false, damage: 0, result: "miss" }));
    expect(r.hit).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.result).toBe("miss");
  });
});

describe("toCombatResult — 投骰与加值", () => {
  it("D&D 走 d20Roll", () => {
    expect(toCombatResult(unified({ d20Roll: 17 })).roll).toBe(17);
  });

  it("CoC 没有 d20 时退到 cocRoll", () => {
    expect(toCombatResult(unified({ cocRoll: 42 })).roll).toBe(42);
  });

  it("两者都没有时为 0 而不是 undefined", () => {
    expect(toCombatResult(unified()).roll).toBe(0);
  });

  it("total = 骰值加上数值型加值，非数值加值不参与求和", () => {
    const r = toCombatResult(unified({
      d20Roll: 10,
      d20Bonuses: [
        { source: "熟练", value: 3 },
        { source: "优势", value: "advantage" },
      ],
    }));
    expect(r.total).toBe(13);
    expect(r.bonuses).toHaveLength(2);
  });
});

describe("toCombatResult — 演出提示与 rule-engine 口径一致", () => {
  it("击杀给特写与最高强度", () => {
    const r = toCombatResult(unified({ result: "kill" }));
    expect(r.camera_hint).toBe("close_up_fatal");
    expect(r.intensity).toBe(0.7);
  });

  it("受伤是中等强度的命中镜头", () => {
    const r = toCombatResult(unified({ result: "wound" }));
    expect(r.camera_hint).toBe("impact");
    expect(r.intensity).toBe(0.4);
  });

  it("未命中是最低强度的落空镜头", () => {
    const r = toCombatResult(unified({ hit: false, result: "miss" }));
    expect(r.camera_hint).toBe("miss");
    expect(r.intensity).toBe(0.1);
  });

  it("穿刺伤害用刺入音效，其余用交击音效", () => {
    expect(toCombatResult(unified({ damageType: "piercing" })).sfx_hint).toBe("blade_pierce");
    expect(toCombatResult(unified({ damageType: "slashing" })).sfx_hint).toBe("weapon_clash");
  });
});
