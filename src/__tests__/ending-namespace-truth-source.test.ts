// 开发 A · 任务 2 验收 —— isClueFound/isSceneVisited 与 END_NARRATIONS 的
// clue id 命名空间是否真的对得上。
//
// 背景：InvestigationEngine 的键历史上是 clueType（如 "corpse"），
// END_NARRATIONS 引用的是 BARN_OF_PREMIER 的 clue id（如
// "clue_bedroom_diary"）。bridgeBarnOfPremierClues()（game-session.ts:3251）
// 用 `clue.id` 原样注册，应该已经让两边对齐，但只是"应该"——这份测试
// 用真实模组数据实际验一遍，而不是靠读代码猜。
//
// bun test src/__tests__/ending-namespace-truth-source.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { BARN_SUPPORT, END_NARRATIONS } from "../module/barn-of-premier";

let session: GameSession;

beforeEach(async () => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("ending-namespace-test", "cosmic-horror", {
    apiKey: "sk-placeholder",
    baseUrl: "http://localhost:9999",
    model: "mock",
    maxTokens: 1024,
    temperature: 0.7,
  }, undefined, "调查员");
  await session.act("加载模组 普瑞米尔的谷仓");
});

describe("命名空间一致性：END_NARRATIONS 引用的每个 clue id，真实发现后 isClueFound 必须为 true", () => {
  it("逐条核对 END_NARRATIONS 里 requiredClues 引用的 id，桥接后都可查", () => {
    const allRequiredClueIds = new Set<string>();
    for (const en of END_NARRATIONS) {
      for (const id of en.condition.requiredClues ?? []) allRequiredClueIds.add(id);
      for (const id of en.condition.excludeClues ?? []) allRequiredClueIds.add(id);
    }
    expect(allRequiredClueIds.size).toBeGreaterThan(0); // 判据本身要有东西可测

    for (const clueId of allRequiredClueIds) {
      // 已知例外：bad_lever_pulled 是 KNOWN_UNREACHABLE（没有任何路径能产生它，
      // 见 end-narration-clue-reachability.test.ts），标记发现只是在验证命名
      // 空间本身、不代表这条线索真的可达，行为与其它 id 一致地测。
      session.investigation.markDiscovered(clueId, "p1");
      expect(session.isClueFound(clueId)).toBe(true);
    }
  });

  /**
   * 【开发·场景 id 收敛 N11，2026-09-04，随 (g) 步骤 1.1 更新】原来这条
   * 测试钉的是"requiredScenes 引用的 ASCII id 与运行时中文场景 id 不同，
   * 但经 barnSceneIdMap() 翻译后可查"——(g) 步骤 1.1 把
   * `BARN_OF_PREMIER.scenes[].id` 从 ASCII 改成了去括号的中文展示名
   * （运行时早就在用的那套），两套 id 现在是**同一个值**，不再需要翻译
   * 就能直接查到。这不是这条测试失败了要去将就，是场景 id 收敛这件事
   * 本身要它变成这样——`session.world.listScenes()` 现在应该能直接
   * 找到 requiredScenes 里的每一个 id，不用先经过 movePlayerToScene
   * 兜一圈再查 isSceneVisited。
   */
  it("requiredScenes 引用的场景 id 现在与运行时注册的场景 id 直接相等（(g) 步骤 1.1 收敛后）", () => {
    const allRequiredSceneIds = new Set<string>();
    for (const en of END_NARRATIONS) {
      for (const id of en.condition.requiredScenes ?? []) allRequiredSceneIds.add(id);
    }
    expect(allRequiredSceneIds.size).toBeGreaterThan(0);

    const registeredIds = new Set(session.world.listScenes().map((s) => s.id));
    for (const sceneId of allRequiredSceneIds) {
      // id 收敛后直接相等——不再需要 barnSceneIdMap() 翻译。
      expect(registeredIds.has(sceneId)).toBe(true);
      // 走到对应场景后 isSceneVisited(sceneId) 依然能查到，行为不变。
      (session as any).movePlayerToScene(sceneId);
      expect(session.isSceneVisited(sceneId)).toBe(true);
    }
  });

  it(
    "**变异检验（真实数据，绕开上面那个已知缺口）**：用只依赖 requiredClues 的" +
      "Good End 验证 isClueFound 真的驱动了结局判定——标记它要求的线索前后，" +
      "evaluateEnding 的结果确实跟着变，不是摆设",
    () => {
      const before = BARN_SUPPORT.evaluateEnding(
        (id) => session.isClueFound(id),
        (id) => session.isSceneVisited(id),
      );
      expect(before?.id).not.toBe("good"); // 什么都没发现，不可能是 Good End

      session.investigation.markDiscovered("clue_control_supplies", "p1");

      const after = BARN_SUPPORT.evaluateEnding(
        (id) => session.isClueFound(id),
        (id) => session.isSceneVisited(id),
      );
      expect(after?.id).toBe("good");
    },
  );
});
