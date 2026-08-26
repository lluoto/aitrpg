// 政经引擎的 causationId 幂等保护（docs/todo.json 的 todo-17：
// "全链应有 causation_id 防止重复触发"）。
//
// advanceRound() 每次调用会汇总四个子系统（factions/trades/policies/finances）
// 各自的事件——causationId 标的是"这一次触发"，不是"这一条事件"，同一次
// 触发产出的所有事件共享同一个 causationId（见 economy/types.ts 的注释）。
//
// 三侧都要测：行为正确、目标行为错误（重复投递必须不重复结算）、
// 文本相似但合法（不能靠子串误判成同一个 causationId）。

import { describe, test, expect } from "bun:test";
import { PoliticoEconomyEngine } from "../economy/politic-economy-engine";

describe("PoliticoEconomyEngine.advanceRound — causationId 幂等保护", () => {
  test("**正确**：不同 causationId 各自正常推进，round 逐次 +1", () => {
    const engine = new PoliticoEconomyEngine();
    expect(engine.round).toBe(0);

    engine.advanceRound("c1");
    expect(engine.round).toBe(1);

    engine.advanceRound("c2");
    expect(engine.round).toBe(2);

    engine.advanceRound("c3");
    expect(engine.round).toBe(3);
  });

  test("**错误行为的红线**：同一个 causationId 重复投递不能重复结算", () => {
    const engine = new PoliticoEconomyEngine();
    engine.advanceRound("dup");
    const roundAfterFirst = engine.round;

    // 第二次传同一个 causationId：不推进 round，返回空数组
    const second = engine.advanceRound("dup");
    expect(second).toEqual([]);
    expect(engine.round).toBe(roundAfterFirst);

    // 再来一次，结果一样——不是"第二次特殊、第三次又生效"这种半吊子去重
    const third = engine.advanceRound("dup");
    expect(third).toEqual([]);
    expect(engine.round).toBe(roundAfterFirst);
  });

  test("**干扰**：causationId 文本相似但确实不同，不能被子串匹配误判为重复", () => {
    // 如果去重逻辑错误地用了 includes()/startsWith() 而不是精确相等，
    // "eco:s1:round:5" 和 "eco:s1:round:50" 这类前缀重叠的 id 会被
    // 误判成同一个，导致本该发生的推进被吞掉。
    const engine = new PoliticoEconomyEngine();
    engine.advanceRound("eco:s1:round:5");
    expect(engine.round).toBe(1);

    engine.advanceRound("eco:s1:round:50"); // 前缀完全覆盖前一个，但不是同一个 id
    expect(engine.round).toBe(2);

    engine.advanceRound("eco:s1:round:5x"); // 同上，只差一个字符
    expect(engine.round).toBe(3);
  });

  test("**正确**：causationId 会被盖在这一批产出的每一条事件上（多跑几轮凑出至少一条事件）", () => {
    const engine = new PoliticoEconomyEngine();
    let sawAnyEvent = false;
    for (let i = 0; i < 30; i++) {
      const causationId = `probe-${i}`;
      const events = engine.advanceRound(causationId);
      for (const e of events) {
        sawAnyEvent = true;
        expect(e.causationId).toBe(causationId);
      }
    }
    // 不是"可能有事件"这种弱断言——30 轮里一条事件都没有，说明这条测试
    // 从来没有真正验证过 causationId 的盖章逻辑，等于没测。
    expect(sawAnyEvent).toBe(true);
  });

  test("**正确**：重复投递不会让 events 数组之外产生副作用——事件总账也不会重复累加", () => {
    const engine = new PoliticoEconomyEngine();
    // 跑到有事件产出为止
    let causationId = "";
    let firstEvents: ReturnType<PoliticoEconomyEngine["advanceRound"]> = [];
    for (let i = 0; i < 30 && firstEvents.length === 0; i++) {
      causationId = `warmup-${i}`;
      firstEvents = engine.advanceRound(causationId);
    }
    expect(firstEvents.length).toBeGreaterThan(0);
    const totalAfterFirst = engine.events.length;

    // 同一个 causationId 再投递一次：事件总账不能再涨
    engine.advanceRound(causationId);
    expect(engine.events.length).toBe(totalAfterFirst);
  });
});
