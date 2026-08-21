// 「这个场景还剩什么可查」要真的传到玩家决策里。
//
// 背景：移动决策点一度传空数组给 decideViaLLM 的 availableClues。
// 那不只是 prompt 里少列一段，还会经 scoreActionByContext 给
// 调查类意图**扣 0.3 分** —— 引擎在主动压制「留下来再查查」。
// 对「有线索后玩家自行决定行动」这个设计来说正好是反的。

import { describe, test, expect } from "bun:test";
import { scoreActionByContext } from "../agent/player-agent";

const baseCtx = {
  sceneDescription: "一间普通的房间。",
  round: 1,
  npcCount: 1,
  availableClues: [] as string[],
  knownClues: [] as string[],
  availableActions: [] as string[],
};

const investigate = { intent: "investigate", text: "仔细查看", tags: [] } as any;
const move = { intent: "move", text: "离开", tags: [] } as any;

describe("scoreActionByContext — 可查线索数的影响", () => {
  test("**没有可查线索时，调查类意图被扣分**", () => {
    const none = scoreActionByContext(investigate, { ...baseCtx, availableClues: [] });
    const some = scoreActionByContext(investigate, { ...baseCtx, availableClues: ["调查书桌"] });
    expect(none).toBeLessThan(some);
  });

  test("线索多（>=3）时调查类意图加分", () => {
    const few = scoreActionByContext(investigate, { ...baseCtx, availableClues: ["a"] });
    const many = scoreActionByContext(investigate, {
      ...baseCtx, availableClues: ["a", "b", "c"],
    });
    expect(many).toBeGreaterThan(few);
  });

  test("移动意图不受可查线索数影响", () => {
    // 这条是对照：确认上面的差异确实来自「线索密度」那两行，
    // 不是别的什么把所有分数一起抬高了
    const none = scoreActionByContext(move, { ...baseCtx, availableClues: [] });
    const many = scoreActionByContext(move, { ...baseCtx, availableClues: ["a", "b", "c"] });
    expect(none).toBe(many);
  });

  test("传空数组与传一条，差值就是那 0.3", () => {
    // 钉住具体数值：改动扣分幅度会让这条红，提醒去看是不是有意的
    const none = scoreActionByContext(investigate, { ...baseCtx, availableClues: [] });
    const one = scoreActionByContext(investigate, { ...baseCtx, availableClues: ["x"] });
    expect(one - none).toBeCloseTo(0.3, 5);
  });
});
