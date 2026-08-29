// 开发 A · 任务 2 验收 —— isClueFound / isSceneVisited 两个队伍视图谓词。
//
// 语义：队伍里**任一人**发现过 / 到过就算。这两个谓词从任务 1 迁进真相源
// 的按玩家记录（clue_discoveries / scene_visits）聚合导出，聚合方向不可
// 反过来——按玩家的记录才是权威。
//
// bun test src/__tests__/party-view-predicates.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("party-view-test", "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, "investigator", "调查员");
}

let session: GameSession;

beforeEach(() => {
  session = makeSession();
});

describe("isClueFound —— 队伍里任一人发现过就算", () => {
  it("没人发现过时为 false", () => {
    expect(session.isClueFound("clue_shared")).toBe(false);
  });

  it("即使是别的玩家（不是 activePlayerId）发现的，也算队伍发现了", () => {
    session.investigation.markDiscovered("clue_shared", "p2");
    expect(session.isClueFound("clue_shared")).toBe(true);
    // p2 未必是当前 activePlayerId（默认 p1），验证的正是"任一人"这个语义
    expect(session.activePlayerId).not.toBe("p2");
  });
});

describe("isSceneVisited —— 队伍里任一人到过就算", () => {
  it("没人去过时为 false", () => {
    session.world.registerScene("scene_c", "场景C", "");
    expect(session.isSceneVisited("scene_c")).toBe(false);
  });

  it("移动过去之后为 true", () => {
    session.world.registerScene("scene_c", "场景C", "");
    (session as any).movePlayerToScene("scene_c");
    expect(session.isSceneVisited("scene_c")).toBe(true);
  });
});
