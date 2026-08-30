// 场景 id 桥接 —— 让 True End 不再永远不可达（todo-34）。
//
// 背景：运行时（premiers_barn.ts 经 MythosModuleLoader）注册 26 个场景，
// id 是中文展示名；BARN_OF_PREMIER.scenes（barn-of-premier.ts）20 个，
// id 是 ASCII，name 是中文展示名。实测：0 个 id 直接对上，17 个靠展示名
// 对上，3 个完全对不上——全是带括号后缀的（farm_periphery/农场外围（陷阱
// 区）、barn_interior/建筑内（谷仓大厅）、maintenance_room/维修间（终局
// 场景）），去掉尾部「（…）」即可对齐。修法已经在 bridgeBarnOfPremierClues
// 里用过一次（线索桥接），本轮只是把同一个函数用到场景 id 上
// （GameSession.stripBracketSuffix + barnSceneIdMap()），不是新发明。
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

describe("20 个 ASCII 场景 id 全部能映射到运行时 id（穷举，不是抽查）", () => {
  it("BARN_OF_PREMIER.scenes 里每一个 id，走到对应场景后 isSceneVisited(ASCII id) 都为 true", () => {
    expect(BARN_OF_PREMIER.scenes.length).toBe(20); // 判据本身要测在真实数据量上，不是空跑

    for (const scene of BARN_OF_PREMIER.scenes) {
      const runtimeName = scene.name.replace(/（[^）]*）$/, "");
      // 运行时场景确实存在（否则下面的移动会静默失败，断言会落空）。
      expect(session.world.getScene(runtimeName)).not.toBeNull();

      (session as any).movePlayerToScene(runtimeName);
      expect(session.isSceneVisited(scene.id)).toBe(true);
    }
  });

  it("走到「维修间」后，isSceneVisited(\"maintenance_room\") 为 true（验收原文的具体例子）", () => {
    (session as any).movePlayerToScene("维修间");
    expect(session.isSceneVisited("maintenance_room")).toBe(true);
  });

  it("没去过的场景仍然是 false——桥接不是让一切都变成 true", () => {
    expect(session.isSceneVisited("maintenance_room")).toBe(false);
    expect(session.isSceneVisited("control_room")).toBe(false);
  });
});

describe("True End 可达（构造真实状态：找到日记 + 老文件 + 到过维修间）", () => {
  it("发现 clue_bedroom_diary、clue_bedroom_old_doc，且到过维修间 → True End", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
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
    // 不移动——requiredScenes: ["maintenance_room"] 不满足。

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).not.toBe("true");
  });

  it("端到端：通过确认离开流程也能拿到 True End 正文（不是只在直接调 evaluateEnding 时work）", async () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    (session as any).movePlayerToScene("维修间");

    const trueEndNarration = END_NARRATIONS.find((e) => e.id === "true")!;
    await session.act("我们决定离开这里，结束这次调查");
    const res = await session.act("确定");

    expect(session.dead).toBe(true);
    expect(res.narrative).toBe(trueEndNarration.lines.join("\n"));
  });
});

describe("Bad End 仍然不可达（原因不同：bad_lever_pulled 无生产者，与场景 id 无关）", () => {
  it("即使到过维修间、发现了 True End 的线索，没有 bad_lever_pulled 就不会是 Bad End", () => {
    session.investigation.markDiscovered("clue_bedroom_diary", "p1");
    session.investigation.markDiscovered("clue_bedroom_old_doc", "p1");
    (session as any).movePlayerToScene("维修间");

    const ending = BARN_SUPPORT.evaluateEnding(
      (id) => session.isClueFound(id),
      (id) => session.isSceneVisited(id),
    );
    expect(ending?.id).not.toBe("bad");
  });
});
