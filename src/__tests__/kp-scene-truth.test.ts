// KP 切场景后，「此刻这里有谁、有什么可查」必须跟着界面显示的场景走。
//
// KP 切场景只翻 scenes.is_active，玩家实体的 position 原地不动——这是既定设计，
// scene-bgm.test.ts 里专门锁住了这一点。但在场 NPC 过滤与场景线索查找当时读的是
// 玩家位置，于是面板显示教堂、站在里面的却是码头的 NPC，调查也还在旧房间里找。
//
// 两个真相源都保留，各司其职：显示的场景回答「现在演到哪」，玩家实体位置留给
// 实体摆放。凡是回答「此刻这里有什么」的地方都跟前者。
//
// bun test src/__tests__/kp-scene-truth.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

let session: GameSession;

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("kp-scene-truth", "cosmic-horror", LLM, "investigator", "调查员");
  session.world.registerScene("docks", "码头");
  session.world.registerScene("church", "教堂");
  session.setScene("docks");
  // 玩家先正常移动过一次：移动流程会留下一个 id 为 "player" 的 PC 实体
  // （movePlayerToScene 的写法，scene-bgm.test.ts 同样这么造）。
  // 分叉正是从这时起——在此之前 getPlayerPosition() 没有实体可读，
  // 会回落到显示的场景，看不出问题。
  session.world.upsertEntity({
    id: "player", name: "调查员", type: "pc",
    hp: 10, maxHp: 10, ac: 10, status: [], position: "docks",
  });
});

describe("KP 切场景后的在场判定", () => {
  it("新场景里的 NPC 出现在面板上", () => {
    session.world.upsertEntity({
      id: "priest", name: "神父", type: "npc",
      hp: 10, maxHp: 10, ac: 10, status: [], position: "church",
    });

    session.setScene("church");

    expect(session.getState().npcs.map(n => n.name)).toContain("神父");
  });

  it("旧场景里的 NPC 不再出现在面板上", () => {
    session.world.upsertEntity({
      id: "sailor", name: "水手", type: "npc",
      hp: 10, maxHp: 10, ac: 10, status: [], position: "docks",
    });

    session.setScene("church");

    expect(session.getState().npcs.map(n => n.name)).not.toContain("水手");
  });

  it("新场景里的线索可以被调查到", async () => {
    session.investigation.registerSceneClue("church", "ritual_site");
    session.setScene("church");
    const before = session.sanity.state.currentSAN;

    await session.act("调查");

    // ritual_site 的 san_cost 是 "1/1d6"，首次调查无论成败都必定扣 SAN
    expect(session.sanity.state.currentSAN).toBeLessThan(before);
  });
});
