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
   * ⚠ 真实核对出的反例，不是本轮制造的：requiredScenes 引用的场景 id
   * （目前只有 True End 一条，"maintenance_room"）与 GameSession 实际注册
   * 的场景 id **不是同一套**。bridgeBarnOfPremierClues() 只桥接了线索
   * （clue.id 直接复用），从未桥接场景——GameSession 加载模组时注册的场景
   * 来自 mythos-module.ts 的 PREMIERS_BARN_MODULE（中文展示名当 id，如
   * "维修间"），不是 barn-of-premier.ts 的 BARN_OF_PREMIER（ASCII id，如
   * "maintenance_room"）。两者说的是同一个地点，id 却完全不同——这正是
   * todo-19"两份谷仓模组表示"的一个具体后果，本轮范围不含收敛它
   * （"不在本轮范围"明确排除拆 WorldState/收敛四处重复存储）。
   * 后果：True End 目前在 GameSession 的自由跑团路径下**不可达**，
   * 已记入 docs/todo.json 新条目。这条测试如实记录这个事实，
   * 不假装它不存在。
   */
  it("**已知缺口**：requiredScenes 引用的 ASCII id 与实际注册的中文场景 id 不是同一套", () => {
    const allRequiredSceneIds = new Set<string>();
    for (const en of END_NARRATIONS) {
      for (const id of en.condition.requiredScenes ?? []) allRequiredSceneIds.add(id);
    }
    expect(allRequiredSceneIds.size).toBeGreaterThan(0);

    const registeredIds = new Set(session.world.listScenes().map((s) => s.id));
    for (const sceneId of allRequiredSceneIds) {
      // 如实记录：不在真相源里——不是我们没找对查询方式，是两套数据本来就没对齐。
      expect(registeredIds.has(sceneId)).toBe(false);
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
