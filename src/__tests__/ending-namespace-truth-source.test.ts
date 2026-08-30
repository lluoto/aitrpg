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
   * requiredScenes 引用的场景 id（目前只有 True End 一条，
   * "maintenance_room"）与 GameSession 实际注册的场景 id **原始数据上
   * 确实不是同一套**（一套 ASCII、一套中文展示名）——这一半仍然真实，
   * 两套模组类型（ModuleData vs MythosModule，todo-19）没统一之前不会变。
   * **但这不再是"缺口"**：isSceneVisited() 现在会先经 barnSceneIdMap()
   * 把 ASCII id 翻译成运行时 id 再查（todo-34 已修，见
   * scene-id-bridge.test.ts 的完整验收），原始数据层面的差异被这层翻译
   * 盖住了，True End 因此变得可达。这条测试改成同时钉住两件事：原始
   * 数据确实不同（翻译存在的理由），但经 isSceneVisited() 查询后能查到
   * （翻译真的在起作用）。
   */
  it("requiredScenes 的 ASCII id 与运行时原始场景 id 不同，但经 isSceneVisited() 桥接后可查（todo-34 已修）", () => {
    const allRequiredSceneIds = new Set<string>();
    for (const en of END_NARRATIONS) {
      for (const id of en.condition.requiredScenes ?? []) allRequiredSceneIds.add(id);
    }
    expect(allRequiredSceneIds.size).toBeGreaterThan(0);

    const registeredIds = new Set(session.world.listScenes().map((s) => s.id));
    // 目前 END_NARRATIONS 里 requiredScenes 只有这一条（"maintenance_room"→
    // "维修间"），这里直接写死对应的运行时场景名；scene-id-bridge.test.ts
    // 覆盖了全部 20 个场景的映射，不依赖这条测试是否穷举。
    for (const sceneId of allRequiredSceneIds) {
      // 原始数据确实不同——翻译存在的理由，不是这条判据的错。
      expect(registeredIds.has(sceneId)).toBe(false);
      // 但走到对应的运行时场景后，isSceneVisited(ASCII id) 必须能查到——
      // 翻译层真的在起作用，不是摆设。
      (session as any).movePlayerToScene("维修间");
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
