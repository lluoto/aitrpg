// 场景 id 桥接 —— 让 True End 不再永远不可达（todo-34）。
//
// 【开发·场景 id 收敛 N11，2026-09-04，随 (g) 步骤 1.2 改写】
// 历史背景：运行时（premiers_barn.ts 经 MythosModuleLoader）注册 26 个
// 场景，id 是中文展示名；BARN_OF_PREMIER.scenes（barn-of-premier.ts）
// 20 个，曾经 id 是 ASCII、name 是中文展示名，两套 id 空间要靠
// GameSession.barnSceneIdMap() 翻译才能对上（实测：0 个 id 直接对上，
// 17 个靠展示名对上，3 个要去掉括号后缀才对上）。
//
// (g) 步骤 1.1 把 `BARN_OF_PREMIER.scenes[].id` 改成了去括号的中文
// 展示名本身，两套 id 从此是同一套；步骤 1.2 顺势删除了
// `barnSceneIdMap()`/`GameSession.stripBracketSuffix` 这层不再需要的
// 翻译代码——`isSceneVisited()` 现在直接查，不再有 premiers_barn 特例
// 分支。这份测试文件因此不再验证"翻译层工作正常"，改为验证"场景 id
// 不需要翻译就能直接互通"，行为预期不变（原来能查到的现在还是能查到）。
//
// bun test src/__tests__/scene-id-bridge.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { BARN_OF_PREMIER, BARN_SUPPORT, END_NARRATIONS } from "../module/barn-of-premier";

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("scene-id-bridge-test", "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, undefined, "调查员");
}

let session: GameSession;

beforeEach(async () => {
  session = makeSession();
  await session.act("加载模组 普瑞米尔的谷仓");
});

describe("(g) 步骤 1.2 验收：全仓再无 barnSceneIdMap() / GameSession.stripBracketSuffix 的翻译调用", () => {
  it("GameSession 实例上不再存在 barnSceneIdMap 这个方法——不是留着没人调，是真的删掉了", () => {
    expect(typeof (session as any).barnSceneIdMap).toBe("undefined");
  });
});

describe("20 个场景 id 全部能直接互通，不需要翻译（穷举，不是抽查）", () => {
  it("BARN_OF_PREMIER.scenes 里每一个 id，走到对应场景后 isSceneVisited(id) 都为 true", () => {
    expect(BARN_OF_PREMIER.scenes.length).toBe(21); // 判据本身要测在真实数据量上，不是空跑

    for (const scene of BARN_OF_PREMIER.scenes) {
      // 运行时场景确实存在（否则下面的移动会静默失败，断言会落空）——
      // scene.id 现在直接就是运行时场景名，不需要再另外去括号。
      expect(session.world.getScene(scene.id)).not.toBeNull();

      (session as any).movePlayerToScene(scene.id);
      expect(session.isSceneVisited(scene.id)).toBe(true);
    }
  });

  it("走到「维修间」后，isSceneVisited(\"维修间\") 为 true（验收原文的具体例子）", () => {
    (session as any).movePlayerToScene("维修间");
    expect(session.isSceneVisited("维修间")).toBe(true);
  });

  it("没去过的场景仍然是 false——桥接不是让一切都变成 true", () => {
    expect(session.isSceneVisited("维修间")).toBe(false);
    expect(session.isSceneVisited("中控室")).toBe(false);
  });
});

describe("True End 可达（构造真实状态：读懂日记老文件 + 见到缸中脑 + 到过维修间）", () => {
  // 开发·摄取管线校准 阶段3：True End 的条件从 [diary, old_doc] 改成
  // [old_doc, final_brain_jars]——diary 仍然标记，是因为阶段1 的前置门
  // 保证了 old_doc 不可能脱离 diary 被发现，这里标记它只是构造一个
  // 真实可达的状态，不是求值条件本身需要它。
  it("发现 clue_bedroom_old_doc、clue_final_brain_jars，且到过维修间 → True End", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    session.investigation.markDiscovered("clue_final_brain_jars", "p1");
    (session as any).movePlayerToScene("维修间");

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).toBe("true");
  });

  it("同样的线索但没去过维修间 → 不是 True End（requiredScenes 条件真的在生效，不是摆设）", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    session.investigation.markDiscovered("clue_final_brain_jars", "p1");
    // 不移动——requiredScenes: ["维修间"] 不满足。

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).not.toBe("true");
  });

  it("只有 old_doc、没见到缸中脑 → 不是 True End（缺 final_brain_jars 也不行，两个条件都要）", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    (session as any).movePlayerToScene("维修间");
    // 不标记 clue_final_brain_jars。

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).not.toBe("true");
  });

  it("端到端：通过确认离开流程也能拿到 True End 正文（不是只在直接调 evaluateEnding 时work）", async () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    session.investigation.markDiscovered("clue_final_brain_jars", "p1");
    (session as any).movePlayerToScene("维修间");

    const trueEndNarration = END_NARRATIONS.find((e) => e.id === "true")!;
    await session.act("我们决定离开这里，结束这次调查");
    const res = await session.act("确定");

    expect(session.dead).toBe(true);
    expect(res.narrative).toBe(trueEndNarration.lines.join("\n"));
  });
});

describe("Near-Truth End 可达（见到缸中脑，但没读懂老文件）", () => {
  it("发现 clue_final_brain_jars、到过维修间，但没有 clue_bedroom_old_doc → Near-Truth End", () => {
    (session as any).movePlayerToScene("维修间");
    session.investigation.markDiscovered("clue_final_brain_jars", "p1");
    // 不标记 clue_bedroom_old_doc。

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).toBe("near_truth");
  });

  it("一旦也读懂了老文件，就该升级成 True End，不再是 Near-Truth（priority 真的在生效）", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    session.investigation.markDiscovered("clue_final_brain_jars", "p1");
    (session as any).movePlayerToScene("维修间");

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).toBe("true");
    expect(ending?.id).not.toBe("near_truth");
  });
});

describe("Bad End 仍然不可达（原因不同：bad_lever_pulled 无生产者，与场景 id 无关）", () => {
  it("即使到过维修间、发现了 True End 的线索，没有 bad_lever_pulled 就不会是 Bad End", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    session.investigation.markDiscovered("clue_final_brain_jars", "p1");
    (session as any).movePlayerToScene("维修间");

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).not.toBe("bad");
  });
});
