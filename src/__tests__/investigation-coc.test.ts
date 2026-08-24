// CoC 7e 调查系统 测试
import { describe, it, expect, beforeAll } from "bun:test";
import { InvestigationEngine } from "../investigation/investigation-engine";

describe("InvestigationEngine — CoC 7e", () => {
  let engine: InvestigationEngine;

  beforeAll(() => {
    engine = new InvestigationEngine("./src/rules/investigation.yaml");
  });

  // ============================================================
  // 场景关联
  // ============================================================
  describe("scene clues", () => {
    it("clue antique_object 关联到地下室", () => {
      expect(engine.getSceneClues("地下室")).toContain("antique_object");
    });

    it("corpse_clue 关联到书房", () => {
      expect(engine.getSceneClues("书房")).toContain("corpse_clue");
    });

    it("document 关联到书房", () => {
      expect(engine.getSceneClues("书房")).toContain("document");
    });

    it("ritual_site 关联到地下室", () => {
      expect(engine.getSceneClues("地下室")).toContain("ritual_site");
    });

    it("conversation 关联到客厅", () => {
      expect(engine.getSceneClues("客厅")).toContain("conversation");
    });

    it("unknown scene 返回空列表", () => {
      expect(engine.getSceneClues("不存在的场景")).toEqual([]);
    });

    it("registerSceneClue 动态注册", () => {
      engine.registerSceneClue("阁楼", "document");
      expect(engine.getSceneClues("阁楼")).toContain("document");
      // 去重
      engine.registerSceneClue("阁楼", "document");
      expect(engine.getSceneClues("阁楼").filter(c => c === "document").length).toBe(1);
    });
  });

  // ============================================================
  // CoC investigateCoC
  // ============================================================
  describe("investigateCoC", () => {
    it("未知 clue → 返回默认失败", () => {
      const r = engine.investigateCoC("nonexistent", { occult: 50 }, "p1");
      expect(r.success).toBe(false);
      expect(r.revelation).toBe("你没有找到有用的线索。");
      expect(r.clue).toBeNull();
    });

    it("高技能值大概率成功", () => {
      let successCount = 0;
      for (let i = 0; i < 100; i++) {
        const r = engine.investigateCoC("antique_object", { occult: 90 }, "p1");
        if (r.success) successCount++;
      }
      // 90% 技能 × 100 次：成功次数期望 90，正态下标准差 ~3，>70 几乎不可能失守
      expect(successCount).toBeGreaterThan(70);
    });

    it("低技能值大概率失败", () => {
      let failCount = 0;
      for (let i = 0; i < 100; i++) {
        const r = engine.investigateCoC("ritual_site", { occult: 10 }, "p2");
        if (!r.success) failCount++;
      }
      // 10% 技能 × 100 次：失败次数期望 90，>70 几乎不可能失守
      expect(failCount).toBeGreaterThan(70);
    });

    it("返回有效 successLevel", () => {
      const levels = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const r = engine.investigateCoC("document", { library_use: 70 }, "p3");
        levels.add(r.successLevel);
      }
      expect(levels.size).toBeGreaterThanOrEqual(3); // 至少3种层级出现过
    });

    it("SAN cost 为 1/1d6 时失败 SAN>0", () => {
      // 原先是 `if (!r.success)`，注释写「失败概率很高」——「很高」不是「必定」，
      // 技能 5 也有 5% 成功，那 5% 里这条一条断言都不执行。
      // 钉住掷骰：d100 = 100，必定失败。
      const real = Math.random;
      try {
        Math.random = () => 0.999;
        const r = engine.investigateCoC("ritual_site", { occult: 5 }, "p_san");
        expect(r.success).toBe(false);
        expect(r.sanCost).toBe("1/1d6");
        expect(r.sanLost).toBeGreaterThan(0);
      } finally { Math.random = real; }
    });
  });

  // ============================================================
  // 已发现追踪
  // ============================================================
  describe("discovery tracking", () => {
    it("成功调查后被标记为已发现", () => {
      // 95% 技能仍有 ~5% 失败率，重试直到出现一次成功再断言
      let attempts = 0;
      let r = engine.investigateCoC("antique_object", { occult: 95 }, "discoverer");
      while (!r.success && attempts < 100) {
        engine.resetAttempts("antique_object");
        r = engine.investigateCoC("antique_object", { occult: 95 }, "discoverer");
        attempts++;
      }
      expect(r.success).toBe(true);
      expect(engine.isDiscoveredBy("antique_object", "discoverer")).toBe(true);
    });

    it("失败后不标记为已发现", () => {
      // occult: 5 有 ~2% 概率投出 01/02 成功（CoC 铁律），重试直到出现失败再断言
      let r = engine.investigateCoC("ritual_site", { occult: 5 }, "failer");
      let attempts = 0;
      while (r.success && attempts < 100) {
        engine.resetAttempts("ritual_site"); // 清除偶发成功留下的标记
        r = engine.investigateCoC("ritual_site", { occult: 5 }, "failer");
        attempts++;
      }
      expect(r.success).toBe(false);
      expect(engine.isDiscoveredBy("ritual_site", "failer")).toBe(false);
    });
  });
});
