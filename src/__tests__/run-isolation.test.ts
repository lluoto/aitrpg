// 一局的状态必须留在这一局里。
//
// 起因：`scripts/diag/diag-fuzz.ts` 的复现自检量出「同 seed 事件流一致、播报文本不一致」，
// 差异全在「这一轮谁开口」那几行。查下去不是随机源，是
// `scene-pipeline.ts` 里一个**模块级** `askCounts` Map 跨局不重置 ——
// 第二局继承了第一局的开口计数。
//
// 两个后果，第二个更要命：
//   1. 同一进程里的第 N 局与第 1 局行为不同 → seed 不能当确定性回归依据
//   2. 接进服务端后多局并发共享同一份计数 → 两局串台
// 这正是当初把播报从模块级数组挪进 `RunContext` 要解决的那类问题。

import { describe, test, expect } from "bun:test";
import { newDedup } from "../play/run-state";
import { pickAsker, type SceneCtx } from "../play/scene-pipeline";
import type { PlayerAgent } from "../agent/player-agent";

/** 只装 pickAsker 会碰的字段 */
function agent(name: string, personality: string): PlayerAgent {
  return {
    name,
    pc: { occupation: "记者", personality, background: "" },
  } as unknown as PlayerAgent;
}

function ctxWith(dedup = newDedup()): SceneCtx {
  const a = agent("甲", "健谈，爱管闲事");
  const b = agent("乙", "沉默寡言，不善言辞");
  return {
    cast: { c1: { hp: 10 }, c2: { hp: 10 } },
    dedup,
    agents: [a, b],
  } as unknown as SceneCtx;
}

describe("newDedup — 每局一份独立状态", () => {
  test("两次 newDedup 的 askCounts 不是同一个对象", () => {
    const a = newDedup();
    const b = newDedup();
    a.askCounts.set("甲", 3);
    expect(b.askCounts.size).toBe(0);
  });
});

describe("pickAsker — 开口计数按局隔离", () => {
  test("**正确**：计数写进本局的 dedup，不写进模块级变量", () => {
    const ctx = ctxWith();
    pickAsker(ctx, "");
    const total = [...ctx.dedup.askCounts.values()].reduce((x, y) => x + y, 0);
    expect(total).toBe(1);
  });

  test("**错误行为的红线**：新的一局必须从零开始数", () => {
    // 变异：把 askCounts 改回模块级 Map，这条立刻红 ——
    // 第二局的计数会从第一局接着往上加。
    const first = ctxWith();
    for (let i = 0; i < 5; i++) pickAsker(first, "");
    expect([...first.dedup.askCounts.values()].reduce((x, y) => x + y, 0)).toBe(5);

    const second = ctxWith(); // 新的一局
    pickAsker(second, "");
    expect([...second.dedup.askCounts.values()].reduce((x, y) => x + y, 0)).toBe(1);
  });

  test("**干扰**：同一局内连着问，计数必须累加（别把隔离做成不计数）", () => {
    const ctx = ctxWith();
    for (let i = 0; i < 4; i++) pickAsker(ctx, "");
    expect([...ctx.dedup.askCounts.values()].reduce((x, y) => x + y, 0)).toBe(4);
  });

  test("**干扰**：两局各有一个同名调查员，计数不得互相污染", () => {
    // 车卡是随机的，两局撞名完全可能。名字当键时这一条尤其要守。
    const a = ctxWith();
    const b = ctxWith();
    for (let i = 0; i < 3; i++) pickAsker(a, "");
    pickAsker(b, "");
    expect([...b.dedup.askCounts.values()].reduce((x, y) => x + y, 0)).toBe(1);
  });

  test("两人都倒下时返回 null，且不记计数", () => {
    const ctx = ctxWith();
    (ctx.cast.c1 as unknown as { hp: number }).hp = 0;
    (ctx.cast.c2 as unknown as { hp: number }).hp = 0;
    expect(pickAsker(ctx, "")).toBeNull();
    expect(ctx.dedup.askCounts.size).toBe(0);
  });
});
