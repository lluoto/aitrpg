// CoC 7e 调查系统 测试
import { describe, it, expect, beforeAll } from "bun:test";
import { InvestigationEngine, CoCClueCheckDef } from "../investigation/investigation-engine";

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
      expect(successCount).toBeGreaterThan(80);
    });

    it("低技能值大概率失败", () => {
      let failCount = 0;
      for (let i = 0; i < 100; i++) {
        const r = engine.investigateCoC("ritual_site", { occult: 10 }, "p2");
        if (!r.success) failCount++;
      }
      expect(failCount).toBeGreaterThan(50);
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
      const r = engine.investigateCoC("ritual_site", { occult: 5 }, "p_san");
      // 失败概率很高，此时应使用 1d6
      if (!r.success) {
        expect(r.sanCost).toBe("1/1d6");
        expect(r.sanLost).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // 已发现追踪
  // ============================================================
  describe("discovery tracking", () => {
    it("成功调查后被标记为已发现", () => {
      engine.investigateCoC("antique_object", { occult: 95 }, "discoverer");
      expect(engine.isDiscoveredBy("antique_object", "discoverer")).toBe(true);
    });

    it("失败后不标记为已发现", () => {
      engine.investigateCoC("ritual_site", { occult: 5 }, "failer");
      expect(engine.isDiscoveredBy("ritual_site", "failer")).toBe(false);
    });
  });
});
