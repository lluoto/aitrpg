// 「见过几次」要真的累加 —— 回访台词换着说全靠它。
//
// 起因：回访台词是**按性格各写死一句**的，玩家来回进同一个场景就一字不差地重复。
// 想让它换着说，得先有个「这是第几次见」的依据 —— 而 NPC 状态里
// 原本只有 `knownByPlayers` 这个布尔，一个计数都没有。
//
// 加了 `metCount` 之后必须验两件事，否则等于没加：
//   1. 它真的每次碰面都加（原先 `meetNpc` 只在首见时调用，永远停在 1）
//   2. 它是**按 NPC 分开**记的，不是全局一个数

import { describe, test, expect } from "bun:test";
import { WorldState } from "../world/state";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const world = () => new WorldState(BARN_OF_PREMIER);

describe("碰面次数", () => {
  test("**正确**：初始是 0，没见过", () => {
    const w = world();
    expect(w.getNpcState("bar_bouncer")?.metCount).toBe(0);
    expect(w.getNpcState("bar_bouncer")?.knownByPlayers).toBe(false);
  });

  test("**错误行为的红线**：每次碰面都要加，不能停在 1", () => {
    // 原先 `meetNpc` 只在首见时被调用，计数永远是 1 —— 回访台词也就永远没依据换。
    const w = world();
    for (let i = 1; i <= 5; i++) {
      w.meetNpc("bar_bouncer");
      expect(w.getNpcState("bar_bouncer")?.metCount).toBe(i);
    }
  });

  test("**干扰输入**：按 NPC 分开记，不是全局一个数", () => {
    const w = world();
    w.meetNpc("bar_bouncer");
    w.meetNpc("bar_bouncer");
    w.meetNpc("police");
    expect(w.getNpcState("bar_bouncer")?.metCount).toBe(2);
    expect(w.getNpcState("police")?.metCount).toBe(1);
    expect(w.getNpcState("tramp")?.metCount).toBe(0);
  });

  test("**干扰输入**：不存在的 NPC 不该炸，也不该凭空造出一个", () => {
    // 光写 `not.toThrow()` 是永真断言 —— 得说清「不炸之后是什么样」。
    const w = world();
    const before = w.getNpcState("bar_bouncer")?.metCount;
    w.meetNpc("查无此人");
    expect(w.getNpcState("查无此人")).toBeUndefined();
    expect(w.getNpcState("bar_bouncer")?.metCount).toBe(before!); // 没波及别人
  });

  test("**正确**：首见同时把 knownByPlayers 立起来", () => {
    const w = world();
    w.meetNpc("police");
    expect(w.getNpcState("police")?.knownByPlayers).toBe(true);
  });
});
