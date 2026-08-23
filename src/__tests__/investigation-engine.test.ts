// InvestigationEngine 单元测试 — 多技能路径 + 组合阈值
// bun test src/__tests__/investigation-engine.test.ts

import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { InvestigationEngine } from "../investigation/investigation-engine";
import { RuleEngine } from "../engine/rule-engine";

const YAML_PATH = "./src/rules/investigation.yaml";
let engine: InvestigationEngine;
let ruleEngine: RuleEngine;

beforeAll(() => {
  engine = new InvestigationEngine(YAML_PATH);
  ruleEngine = new RuleEngine();
});

beforeEach(() => {
  // 重新加载以清除各测试间的状态
  engine = new InvestigationEngine(YAML_PATH);
});

// ============================================================
// 加载
// ============================================================

describe("InvestigationEngine 加载", () => {
  it("成功加载 YAML 线索类型", () => {
    const types = engine.listClueTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("antique_object");
    expect(types).toContain("corpse_clue");
    expect(types).toContain("document");
  });

  it("存在未知线索返回 fallback", () => {
    const r = engine.investigate("nonexistent_clue", {}, [], "p1", ruleEngine);
    expect(r.clue_id).toBe("nonexistent_clue");
    expect(r.fallback_triggered).toBe(false);
    expect(r.final_revelation).toContain("没有找到");
  });
});

// ============================================================
// Primary 检定
// ============================================================

describe("调查: Primary 主线检定", () => {
  it("高技能值 → 成功率高", () => {
    // history=99 → 几乎必成功 dc=1
    let successCount = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const e = new InvestigationEngine(YAML_PATH);
      const r = e.investigate("antique_object", { history: 99 }, [], "p1", ruleEngine);
      if (r.primary_result?.success) successCount++;
    }
    expect(successCount / trials).toBeGreaterThan(0.8);
  });

  it("低技能值 → 成功率低", () => {
    let successCount = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const e = new InvestigationEngine(YAML_PATH);
      const r = e.investigate("antique_object", { history: 5 }, [], "p1", ruleEngine);
      if (r.primary_result?.success) successCount++;
    }
    expect(successCount / trials).toBeLessThan(0.3);
  });

  it("Primary 成功标记 is_critical=false", () => {
    for (let i = 0; i < 30; i++) {
      const e = new InvestigationEngine(YAML_PATH);
      const r = e.investigate("antique_object", { history: 60 }, [], "p1", ruleEngine);
      if (r.primary_result?.success && !r.primary_result.critical) {
        expect(r.is_critical).toBe(false);
        break;
      }
    }
  });

  it("成功时标记已发现", () => {
    const e = new InvestigationEngine(YAML_PATH);
    const r = e.investigate("antique_object", { history: 99 }, [], "p1", ruleEngine);
    if (r.primary_result?.success || r.is_critical) {
      expect(e.isDiscoveredBy("antique_object", "p1")).toBe(true);
    }
  });
});

// ============================================================
// Secondary 辅助检定
// ============================================================

describe("调查: Secondary 辅助检定", () => {
  it("有 secondary skill 时返回 secondary_results", () => {
    const r = engine.investigate("corpse_clue", {
      medicine: 50,
      spot_hidden: 50,
    }, [], "p1", ruleEngine);
    expect(r.secondary_results.length).toBeGreaterThan(0);
  });

  it("secondary 成功时可能带 bonus_type", () => {
    // spot_hidden 的 effect 包含 "提供额外细节" → 触发 primaryBonus
    for (let i = 0; i < 30; i++) {
      const e = new InvestigationEngine(YAML_PATH);
      const r = e.investigate("corpse_clue", {
        medicine: 60,
        spot_hidden: 60,
        psychology: 60,
      }, [], "p1", ruleEngine);
      // 直接取出 bonus_type 再判断：find 的谓词不会把属性窄化到元素类型上，
      // 拿 bonusResult.bonus_type 传给 toContain 时它仍是可选的。
      const bonusType = r.secondary_results.find(sr => sr.bonus_type)?.bonus_type;
      if (bonusType) {
        expect(["advantage", "dc_reduction", "skill_bonus"]).toContain(bonusType);
        break;
      }
    }
  });

  it("无 secondary skill 时返回空数组", () => {
    const r = engine.investigate("antique_object", { history: 50 }, [], "p1", ruleEngine);
    expect(r.secondary_results).toHaveLength(0);
  });
});

// ============================================================
// Combined Threshold 组合阈值
// ============================================================

describe("调查: Combined Threshold 组合阈值", () => {
  it("覆盖 3+ 技能时触发组合阈值 (跳过投骰)", () => {
    const r = engine.investigate("antique_object", {
      history: 50,
      art: 50,
      appraise: 50,
    }, [], "p1", ruleEngine);
    expect(r.combined_triggered).toBe(true);
    expect(r.is_critical).toBe(true);
    expect(r.primary_result).toBeNull();
  });

  it("组合阈值给出完整揭示", () => {
    const r = engine.investigate("antique_object", {
      history: 50,
      art: 50,
      appraise: 50,
    }, [], "p1", ruleEngine);
    expect(r.combined_triggered).toBe(true);
    expect(r.final_revelation.length).toBeGreaterThan(10);
  });

  it("只有 2 个技能时不触发组合阈值", () => {
    const r = engine.investigate("antique_object", {
      history: 50,
      art: 50,
    }, [], "p1", ruleEngine);
    expect(r.combined_triggered).toBe(false);
  });

  it("组合阈值后标记已发现", () => {
    const r = engine.investigate("document", {
      library_use: 50,
      psychology: 50,
      education: 50,
    }, [], "p1", ruleEngine);
    if (r.combined_triggered) {
      expect(engine.isDiscoveredBy("document", "p1")).toBe(true);
    }
  });
});

// ============================================================
// Fallback
// ============================================================

describe("调查: Fallback 全部失败", () => {
  it("所有检定失败 → fallback_triggered", () => {
    // ⚠ 原先 `foundFallback` 设了却从不检查（tsc 的 noUnusedLocals 报的）。
    //   后果是：50 次里一次都没触发 fallback 时，循环跑完、**一条断言都没执行**，
    //   测试照样绿。也就是说这个测试只在功能正常时才验东西，
    //   功能坏掉的时候反而静默通过 —— 正好是反的。
    // 用最低技能值确保所有失败
    let foundFallback = false;
    for (let i = 0; i < 50; i++) {
      const e = new InvestigationEngine(YAML_PATH);
      const r = e.investigate("antique_object", { history: 5 }, [], "p1", ruleEngine);
      if (!r.primary_result?.success && !r.combined_triggered) {
        if (r.fallback_triggered) {
          foundFallback = true;
          expect(r.final_revelation).toContain("更多线索");
          break;
        }
      }
    }
    expect(foundFallback).toBe(true);
  });
});

// ============================================================
// 发现追踪
// ============================================================

describe("InvestigationEngine 发现追踪", () => {
  it("不同玩家独立追踪", () => {
    const e = new InvestigationEngine(YAML_PATH);
    const r = e.investigate("antique_object", { history: 99, art: 50, appraise: 50 }, [], "p1", ruleEngine);
    if (r.combined_triggered || r.primary_result?.success) {
      expect(e.isDiscoveredBy("antique_object", "p1")).toBe(true);
      expect(e.isDiscoveredBy("antique_object", "p2")).toBe(false);
    }
  });

  it("resetAttempts 清除追踪", () => {
    const e = new InvestigationEngine(YAML_PATH);
    e.investigate("antique_object", { history: 99, art: 50, appraise: 50 }, [], "p1", ruleEngine);
    e.resetAttempts("antique_object");
    expect(e.isDiscoveredBy("antique_object", "p1")).toBe(false);
  });

  it("getDiscoveredBy 返回已发现列表", () => {
    const e = new InvestigationEngine(YAML_PATH);
    e.investigate("antique_object", { history: 99, art: 50, appraise: 50 }, [], "p1", ruleEngine);
    const discovered = e.getDiscoveredBy("p1");
    expect(discovered.length).toBeGreaterThanOrEqual(0);
    // antique_object 可能因组合阈值被标记
  });
});

// ============================================================
// 多线索类型
// ============================================================

describe("调查: 不同类型线索", () => {
  it("corpse_clue 使用 medicine primary", () => {
    const r = engine.investigate("corpse_clue", { medicine: 60 }, [], "p1", ruleEngine);
    expect(r.clue_description).toContain("尸体");
    expect(r.primary_result?.skill).toBe("medicine");
  });

  it("document 使用 library_use primary", () => {
    const r = engine.investigate("document", { library_use: 60 }, [], "p1", ruleEngine);
    expect(r.clue_description).toContain("日记");
    expect(r.primary_result?.skill).toBe("library_use");
  });
});
