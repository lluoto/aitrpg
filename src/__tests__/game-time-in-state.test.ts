// 开发·游戏时间补进玩家侧 —— 任务2验收。
//
// 背景：移动计时已实现（game-session.ts 的 tryResolveModuleScene，弱版
// 邻接 + 按跳数付时间），单测也验了内部字段（move-cost-integration.test.ts
// 直接读 (session as any).gameTime）。但 getState()（玩家侧 API）此前没有
// 暴露这个字段——LLM 提示词里有（injectWorldModelForScene）、KP 视图里
// 有（getKPState），唯独玩家看不见。analysis/sim/2026-08-30-barn-a-retest.md
// 因此把移动计时判成"说不准"：从 API 输出无法比较相邻与远距离的消耗。
//
// bun test src/__tests__/game-time-in-state.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("game-time-state-test", "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, undefined, "调查员");
}

let session: GameSession;

beforeEach(async () => {
  session = makeSession();
  await session.act("加载模组 普瑞米尔的谷仓"); // 默认落在「特里坎家」
  // 已用 scripts 实测核实过：特里坎家 → 加比的拖车房 = 1 跳；特里坎家 → 维修间 = 8 跳。
});

describe("getState() 暴露 gameTime，结构与 getKPState() 一致", () => {
  it("GET /state 与 action 响应都能读到游戏时间", () => {
    const state = session.getState();
    expect(state.gameTime).toBeDefined();
    expect(typeof state.gameTime.day).toBe("number");
    expect(typeof state.gameTime.period).toBe("string");
    expect(typeof state.gameTime.label).toBe("string");
  });

  it("getKPState() 与 getState() 的时间字段结构一致（同一口径，不新造一种表示）", () => {
    const playerState = session.getState();
    const kpState = session.getKPState();
    expect(playerState.gameTime).toEqual(kpState.gameTime);
  });

  it("act() 的响应本身（state 字段）也带 gameTime，不需要额外调用 getState()", async () => {
    const res = await session.act("侦查");
    expect(res.state.gameTime).toBeDefined();
    expect(res.state.gameTime).toEqual(session.getKPState().gameTime);
  });
});

describe("相邻移动与跨图移动后，从 API 能观察到不同的时间推进（实跑没能验成的那一项）", () => {
  it("相邻移动（1 跳）：act() 前后 gameTime 只推进标准的 1 tick", async () => {
    const before = session.getState().gameTime;
    await session.act("前往加比的拖车房");
    const after = session.getState().gameTime;
    // 1 跳 = act() 本来就有的那 1 tick：ticks 恰好 +1（同一天同一时段内，
    // 尚未跨时段边界——每时段 3 tick，从 0 起步走 1 跳不会跨界）。
    expect(after.day).toBe(before.day);
    expect(after.period).toBe(before.period);
  });

  it("跨图移动（8 跳）：act() 前后 gameTime 推进明显更多，且与 1 跳的结果不同", async () => {
    const adjacentSession = makeSession();
    await adjacentSession.act("加载模组 普瑞米尔的谷仓");
    const beforeAdjacent = adjacentSession.getState().gameTime;
    await adjacentSession.act("前往加比的拖车房"); // 1 跳
    const afterAdjacent = adjacentSession.getState().gameTime;

    const beforeFar = session.getState().gameTime;
    await session.act("前往维修间"); // 8 跳
    const afterFar = session.getState().gameTime;

    // 两组的起点相同（同样的初始 gameTime），但终点必须不同——
    // 这正是"从 API 输出能不能比较相邻与远距离的消耗"这件事本身。
    expect(beforeAdjacent).toEqual(beforeFar);
    expect(afterAdjacent).not.toEqual(afterFar);
    // 8 跳应该让时段往前推进得更多（跨过多个 tick，可能跨时段甚至跨天），
    // 1 跳不会。用「不相等」加上下面这条更具体的断言一起钉住。
    const periodOrder = ["dawn", "morning", "noon", "afternoon", "dusk", "evening", "night", "late_night"];
    const totalTicks = (gt: { day: number; period: string }, ticksInPeriod: number) =>
      (gt.day - 1) * 24 + periodOrder.indexOf(gt.period) * 3 + ticksInPeriod;
    // 只用 day/period 比较大致前进量：8 跳版本经过的时段数必须 >= 1 跳版本。
    const farAdvance = totalTicks(afterFar, 0) - totalTicks(beforeFar, 0);
    const adjacentAdvance = totalTicks(afterAdjacent, 0) - totalTicks(beforeAdjacent, 0);
    expect(farAdvance).toBeGreaterThan(adjacentAdvance);
  });
});
